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

const USER_AGENT =
  "Tolmach/0.1 (переводчик веб-новелл; +https://github.com/Yebatop/ExtTran)";

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

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text: string): number {
  const words = text.match(/[\p{L}\p{N}'’-]+/gu);
  return words ? words.length : 0;
}
