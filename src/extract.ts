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


/**
 * Распаковать страницу, сохранённую как MHTML (.mht).
 *
 * Chrome на Android по умолчанию сохраняет страницу именно так: это не HTML,
 * а MIME-архив со всеми картинками внутри. На телефоне других вариантов часто
 * и нет, поэтому разбираем.
 */
export function decodeMhtml(raw: string): string | null {
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch?.[1]) return null;

  const parts = raw.split(`--${boundaryMatch[1]}`);
  for (const part of parts) {
    const split = part.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
    const at = part.indexOf(split);
    if (at < 0) continue;

    const headers = part.slice(0, at).toLowerCase();
    if (!headers.includes("text/html")) continue;

    const body = part.slice(at + split.length);
    if (headers.includes("base64")) {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    }
    if (headers.includes("quoted-printable")) {
      return body
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
    }
    return body;
  }
  return null;
}

/**
 * Похоже ли, что глава закрыта для подписчиков сайта.
 *
 * Такие страницы весят как обычные, но текста на них нет — вместо него
 * предложение заплатить. Отличать их важно не для удобства: по нашей политике
 * платные главы не переводятся вообще, ни за квоту, ни вставленным текстом.
 */
const LOCK_MARKERS =
  /(locked chapter|chapter is locked|unlock this chapter|premium chapter|members only|subscribe to read|advance access|early access|purchase this chapter|coins? to unlock)/i;

export function looksLocked(html: string): boolean {
  const body = html.replace(/<[^>]+>/g, " ");
  return LOCK_MARKERS.test(body);
}

export async function loadChapter(source: string): Promise<Chapter> {
  if (/^https?:\/\//i.test(source)) {
    return fromHtml(await fetchPage(source), source);
  }

  const raw = await readFile(source, "utf8");
  if (/\.mhtml?$/i.test(source)) {
    const html = decodeMhtml(raw);
    if (html === null) {
      throw new Error(
        "Файл выглядит как MHTML, но распаковать его не вышло. " +
          "Пересохраните страницу как обычный HTML.",
      );
    }
    return fromHtml(html, source);
  }
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


/**
 * Найти на странице главы ссылку на следующую.
 *
 * Нужно там, где адреса глав не угадываются: у каждой свой хвост вроде
 * chapter-2-must-kill, а на странице книги висят только первая и последние.
 * Тогда единственный способ собрать главы подряд — идти по «вперёд».
 *
 * Порядок проверок от надёжного к шаткому. Ссылки «назад» отсеиваются явно:
 * перепутать их проще всего, а цена ошибки — уход в начало книги.
 */
const NEXT_TEXT = /^(next|next chapter|next ›|next »|›|»|→|>>|вперёд|далее|следующая)/i;
const PREV_HINT = /prev|назад|предыд|‹|«|←|<</i;

export function findNextLink(html: string, currentUrl: string): string | null {
  const dom = new JSDOM(html, { url: currentUrl });
  const doc = dom.window.document;
  const here = new URL(currentUrl);

  const resolve = (href: string | null): string | null => {
    if (!href) return null;
    try {
      const parsed = new URL(href, currentUrl);
      parsed.hash = "";
      if (parsed.origin !== here.origin) return null;
      if (parsed.toString() === currentUrl.replace(/#.*$/, "")) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  };

  // 1. Разметка, сделанная специально для этого
  const rel = doc.querySelector('link[rel="next"], a[rel="next"]');
  const byRel = resolve(rel?.getAttribute("href") ?? null);
  if (byRel) return byRel;

  const anchors = [...doc.querySelectorAll("a[href]")];

  // 2. Имя класса или идентификатор — но не у ссылки «назад»
  for (const a of anchors) {
    const marks = `${a.className} ${a.id}`.toLowerCase();
    if (!marks.includes("next")) continue;
    if (PREV_HINT.test(marks)) continue;
    const url = resolve(a.getAttribute("href"));
    if (url) return url;
  }

  // 3. Текст самой ссылки
  for (const a of anchors) {
    const text = (a.textContent ?? "").trim();
    if (text === "" || text.length > 24) continue;
    if (PREV_HINT.test(text)) continue;
    if (!NEXT_TEXT.test(text)) continue;
    const url = resolve(a.getAttribute("href"));
    if (url) return url;
  }

  return null;
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
