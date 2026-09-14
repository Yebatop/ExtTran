/**
 * Чтение файлов со списками — и внятный ответ, когда файла нет.
 *
 * Имя файла набирают на телефоне, кириллицей, в темноте. Промахнуться легко,
 * а `ENOENT: no such file or directory` не подсказывает ничего: ни что за
 * файл ждали, ни что лежит рядом. Здесь промах превращается в список того,
 * что в папке есть на самом деле.
 */

import { readFile, readdir } from "node:fs/promises";
import type { Glossary } from "./glossary.js";
import path from "node:path";

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ENOENT"
  );
}

/**
 * Что сказать, когда файла нет, а рядом лежит вот это.
 *
 * Отдельной функцией, потому что это единственная часть, которую можно
 * проверить без файловой системы.
 */
export function missingFileMessage(
  wanted: string,
  kind: string,
  found: string[],
): string {
  const where = path.dirname(wanted) === "." ? "в этой папке" : `в ${path.dirname(wanted)}`;
  if (found.length === 0) {
    return `Не нашёл ${kind} «${path.basename(wanted)}» — и ничего похожего ${where} тоже нет.`;
  }
  const shown = found.slice(0, 8);
  const tail = found.length > shown.length ? `\n  …и ещё ${found.length - shown.length}` : "";
  return (
    `Не нашёл ${kind} «${path.basename(wanted)}». ` +
    `${where.charAt(0).toUpperCase()}${where.slice(1)} есть вот что:\n  ` +
    shown.join("\n  ") +
    tail
  );
}

/** Соседи по папке с тем же расширением, по алфавиту. */
async function neighbours(wanted: string): Promise<string[]> {
  const ext = path.extname(wanted).toLowerCase();
  try {
    const names = await readdir(path.dirname(wanted) || ".");
    return names
      .filter((n) => path.extname(n).toLowerCase() === ext)
      .sort((a, b) => a.localeCompare(b, "ru"));
  } catch {
    return [];
  }
}

/** Прочитать файл, а на отсутствие ответить по-человечески. */
export async function readTextFile(wanted: string, kind: string): Promise<string> {
  try {
    return await readFile(wanted, "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
    throw new Error(missingFileMessage(wanted, kind, await neighbours(wanted)));
  }
}

/**
 * Список глав: по ссылке или пути в строке. Пустые строки и решётки — мимо.
 */
export async function readList(listPath: string, limit?: number): Promise<string[]> {
  const raw = await readTextFile(listPath, "список глав");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new Error(
      `Файл «${listPath}» есть, но в нём нет ни одной ссылки. ` +
        "Список глав собирается командой npm run список.",
    );
  }
  return limit === undefined ? lines : lines.slice(0, limit);
}

/** Глоссарий с диска. Живёт здесь, а не рядом с типами: это чтение файла. */
export async function loadGlossary(path: string): Promise<Glossary> {
  const raw = JSON.parse(await readTextFile(path, "глоссарий")) as Partial<Glossary>;
  return {
    novel: raw.novel ?? "",
    terms: raw.terms ?? [],
    addresses: raw.addresses ?? [],
  };
}
