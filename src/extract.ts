/**
 * Достать текст главы: из файла или со страницы.
 *
 * На чужих сайтах вокруг главы стоит меню, реклама и список глав. Readability
 * отсекает это тем же способом, что и режим чтения в браузере.
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
}

const USER_AGENT =
  "Tolmach/0.1 (переводчик веб-новелл; +https://github.com/Yebatop/ExtTran)";

export async function loadChapter(source: string): Promise<Chapter> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(
        `Сайт ответил ${response.status} ${response.statusText}. ` +
          "Страницу можно сохранить руками и передать файлом.",
      );
    }
    return fromHtml(await response.text(), source);
  }

  const raw = await readFile(source, "utf8");
  if (/\.html?$/i.test(source)) return fromHtml(raw, source);
  const text = normalize(raw);
  return { title: "", text, wordCount: countWords(text), source };
}

function fromHtml(html: string, source: string): Chapter {
  const dom = new JSDOM(html, {
    url: /^https?:\/\//i.test(source) ? source : "https://example.invalid/",
  });
  const article = new Readability(dom.window.document).parse();

  if (!article?.textContent?.trim()) {
    throw new Error(
      "На странице не нашлось связного текста. Обычно это значит, что по ссылке " +
        "оглавление, а не глава, или что текст подгружается скриптом.",
    );
  }

  const text = normalize(article.textContent);
  return {
    title: (article.title ?? "").trim(),
    text,
    wordCount: countWords(text),
    source,
  };
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
