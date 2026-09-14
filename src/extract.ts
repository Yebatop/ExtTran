/**
 * Достать текст главы: из файла или со страницы.
 *
 * На чужих сайтах вокруг главы стоит меню, реклама и список глав. Readability
 * отсекает это тем же способом, что и режим чтения в браузере. Но она заточена
 * под статьи, а движки новелльных сайтов бывают устроены причудливо, поэтому
 * есть запасной способ: найти на странице узел с наибольшей плотностью абзацев.
 * Берётся тот результат, который длиннее.
 */

import { readFile } from "node:fs/promises";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { USER_AGENT } from "./config.js";

export interface Chapter {
  title: string;
  text: string;
  /** Слов в оригинале — по ним считается, во сколько глав обойдётся перевод. */
  wordCount: number;
  source: string;
  /** Чем сняли текст — видно в диагностике. */
  method?: "readability" | "плотность абзацев" | "файл";
}

/** Ниже этого числа слов результат Readability считаем неудачей. */
const TOO_SHORT_WORDS = 200;

export async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `Сайт ответил ${response.status} ${response.statusText}. ` +
        "Страницу можно сохранить браузером и передать файлом.",
    );
  }
  return response.text();
}

export async function loadChapter(source: string): Promise<Chapter> {
  if (/^https?:\/\//i.test(source)) {
    return fromHtml(await fetchPage(source), source);
  }

  const raw = await readFile(source, "utf8");
  if (/\.html?$/i.test(source)) return fromHtml(raw, source);
  const text = normalize(raw);
  return {
    title: "",
    text,
    wordCount: countWords(text),
    source,
    method: "файл",
  };
}

export interface ExtractionAttempt {
  title: string;
  text: string;
  wordCount: number;
  method: "readability" | "плотность абзацев";
}

/** Оба способа снятия текста — нужны диагностике, чтобы показать их рядом. */
export function attempts(html: string, source: string): ExtractionAttempt[] {
  const dom = new JSDOM(html, {
    url: /^https?:\/\//i.test(source) ? source : "https://example.invalid/",
  });
  const out: ExtractionAttempt[] = [];

  const article = new Readability(dom.window.document.cloneNode(true) as Document).parse();
  if (article?.textContent?.trim()) {
    const text = normalize(article.textContent);
    out.push({
      title: (article.title ?? "").trim(),
      text,
      wordCount: countWords(text),
      method: "readability",
    });
  }

  const dense = byParagraphDensity(dom.window.document);
  if (dense) out.push(dense);

  return out;
}

function fromHtml(html: string, source: string): Chapter {
  const tries = attempts(html, source);
  if (tries.length === 0) {
    throw new Error(
      "На странице не нашлось связного текста. Обычно это значит, что по ссылке " +
        "оглавление, а не глава, или что текст подгружается скриптом.",
    );
  }

  // Readability точнее в заголовке и чище в разметке, поэтому побеждает,
  // пока даёт разумную длину. Запасной способ вступает, когда она промахнулась.
  const readability = tries.find((t) => t.method === "readability");
  const dense = tries.find((t) => t.method === "плотность абзацев");
  const best =
    readability && readability.wordCount >= TOO_SHORT_WORDS
      ? readability
      : ((dense && readability && dense.wordCount > readability.wordCount
          ? dense
          : (readability ?? dense)) as ExtractionAttempt);

  return {
    title: best.title,
    text: best.text,
    wordCount: best.wordCount,
    source,
    method: best.method,
  };
}

/**
 * Запасной способ: у каждого контейнера считаем, сколько текста лежит в его
 * прямых абзацах, и берём победителя. Меню и сайдбары проигрывают, потому что
 * состоят из ссылок, а не из абзацев.
 */
function byParagraphDensity(document: Document): ExtractionAttempt | null {
  const candidates = [
    ...document.querySelectorAll("article, main, section, div"),
  ];
  let bestNode: Element | null = null;
  let bestLength = 0;

  for (const node of candidates) {
    const paragraphs = [...node.children].filter((c) => c.tagName === "P");
    if (paragraphs.length < 3) continue;
    const length = paragraphs.reduce(
      (sum, p) => sum + (p.textContent ?? "").trim().length,
      0,
    );
    if (length > bestLength) {
      bestLength = length;
      bestNode = node;
    }
  }

  if (!bestNode || bestLength < 400) return null;

  const text = normalize(
    [...bestNode.children]
      .filter((c) => c.tagName === "P")
      .map((p) => (p.textContent ?? "").trim())
      .filter(Boolean)
      .join("\n\n"),
  );

  const heading = document.querySelector("h1, h2");
  return {
    title: (heading?.textContent ?? "").trim(),
    text,
    wordCount: countWords(text),
    method: "плотность абзацев",
  };
}

/** Доля текста, лежащая в ссылках. У оглавления она близка к единице. */
export function linkDensity(html: string, source: string): number {
  const dom = new JSDOM(html, {
    url: /^https?:\/\//i.test(source) ? source : "https://example.invalid/",
  });
  const body = dom.window.document.body;
  if (!body) return 0;
  const all = (body.textContent ?? "").replace(/\s+/g, " ").trim().length;
  if (all === 0) return 0;
  const inLinks = [...body.querySelectorAll("a")].reduce(
    (sum, a) => sum + (a.textContent ?? "").replace(/\s+/g, " ").trim().length,
    0,
  );
  return inLinks / all;
}

/**
 * Убрать служебную обвязку переводчика.
 *
 * Английский текст на таких сайтах обычно чужой перевод, и сверху к нему
 * прилеплена подпись вроде «Translator: KJ», а снизу просьба поддержать на
 * Patreon. В главу это не входит, читателю не нужно, а токены за это платятся
 * на каждой главе.
 *
 * Срезаем только по краям и только явные шаблоны: в середине текста ничего
 * не трогаем, чтобы не отхватить кусок сцены.
 */
const CREDIT_LINE =
  /^(translator|translation|tl|editor|edited by|proofreader|proofread by|translated by|raw provider|host|t\/?n)\s*[:：]/i;
const SEPARATOR_LINE = /^[\s\u2500-\u257F*_=~—–-]+$/;

/**
 * Подвал узнаём только по явным приметам — по названию площадки поддержки или
 * по обещанию глав вперёд. Ничего вроде «please» тут быть не должно: глава
 * вполне может кончаться репликой «Please, don't», и молча удалить её хуже,
 * чем оставить строчку мусора.
 */
const SUPPORT_LINE =
  /(patreon|ko-?fi|buymeacoffee|boosty|discord|paypal|advanced? chapters?|chapters? ahead|early access)/i;

/** Сколько строк с каждого края вообще можно трогать. */
const HEAD_WINDOW = 8;
const TAIL_WINDOW = 6;

export function stripCredits(text: string): string {
  const lines = text.split("\n");

  let start = 0;
  while (start < lines.length && start < HEAD_WINDOW) {
    const line = (lines[start] ?? "").trim();
    if (line === "" || SEPARATOR_LINE.test(line) || CREDIT_LINE.test(line)) {
      start += 1;
      continue;
    }
    break;
  }

  let end = lines.length;
  while (end > start && lines.length - end < TAIL_WINDOW) {
    const line = (lines[end - 1] ?? "").trim();
    if (line === "" || SEPARATOR_LINE.test(line) || SUPPORT_LINE.test(line)) {
      end -= 1;
      continue;
    }
    break;
  }

  return lines.slice(start, end).join("\n").trim();
}

function normalize(raw: string): string {
  const collapsed = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripCredits(collapsed);
}

function countWords(text: string): number {
  const words = text.match(/[\p{L}\p{N}'’-]+/gu);
  return words ? words.length : 0;
}
