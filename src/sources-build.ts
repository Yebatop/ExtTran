/**
 * Собрать список глав — чтобы не копировать полсотни ссылок руками.
 *
 * Два способа:
 *   по шаблону        — когда адреса глав отличаются одним номером
 *   по оглавлению     — когда на странице книги есть список ссылок
 *
 * Готовый список коммитить не надо: это карта чужого сайта, и нужна она
 * только на время прогона.
 */

import { writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const USAGE = `Сборка списка глав.

  npm run список -- --шаблон "https://сайт/книга/глава-{1..50}" --в список.txt

  npm run список -- --оглавление https://сайт/книга --содержит /глава- --в список.txt

Ключи:
  --шаблон <строка>    адрес с диапазоном в фигурных скобках: {147..196}
  --оглавление <url>   страница со списком глав
  --содержит <кусок>   какие ссылки с неё брать (например /chapter-)
  --в <файл>           куда записать; иначе печатается в консоль
  --сколько <N>        обрезать список до N ссылок

Проверьте получившийся список глазами: на страницах книг попадаются ссылки
на комментарии и на первую главу в трёх местах сразу.
`;

const USER_AGENT =
  "Tolmach/0.1 (переводчик веб-новелл; +https://github.com/Yebatop/ExtTran)";

function expandPattern(pattern: string): string[] {
  const match = pattern.match(/\{(\d+)\.\.(\d+)\}/);
  if (!match) {
    throw new Error(
      "В шаблоне нет диапазона. Он пишется в фигурных скобках: {147..196}.",
    );
  }
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new Error(`Диапазон {${match[1]}..${match[2]}} прочитать не удалось.`);
  }
  if (to - from > 5000) {
    throw new Error("Диапазон больше пяти тысяч — похоже на опечатку.");
  }

  // Ведущие нули в первом числе сохраняем: chapter-007 и chapter-7 —
  // на многих сайтах разные адреса.
  const width = match[1]?.startsWith("0") ? (match[1]?.length ?? 0) : 0;
  const out: string[] = [];
  for (let n = from; n <= to; n += 1) {
    const num = width > 0 ? String(n).padStart(width, "0") : String(n);
    out.push(pattern.replace(match[0], num));
  }
  return out;
}

async function fromTableOfContents(
  url: string,
  contains: string,
): Promise<string[]> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Оглавление ответило ${response.status} ${response.statusText}.`);
  }

  const dom = new JSDOM(await response.text(), { url });
  const anchors = [...dom.window.document.querySelectorAll("a[href]")];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href, url).toString();
    } catch {
      continue;
    }
    if (contains !== "" && !absolute.includes(contains)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push(absolute);
  }

  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`У ключа ${arg} нет значения.`);
    }
    flags.set(arg.slice(2), value);
    i += 1;
  }

  const pattern = flags.get("шаблон") ?? flags.get("pattern");
  const toc = flags.get("оглавление") ?? flags.get("toc");

  if (!pattern && !toc) {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  let links = pattern
    ? expandPattern(pattern)
    : await fromTableOfContents(toc ?? "", flags.get("содержит") ?? flags.get("contains") ?? "");

  const limit = flags.get("сколько") ?? flags.get("limit");
  if (limit !== undefined) links = links.slice(0, Number(limit));

  if (links.length === 0) {
    throw new Error(
      "Ни одной ссылки не набралось. Если брали с оглавления — попробуйте " +
        "другой кусок адреса в --содержит.",
    );
  }

  const header = [
    "# Список глав для Толмача. Сгенерирован автоматически — проверьте глазами.",
    "# Коммитить не надо: это карта чужого сайта, нужная только на время прогона.",
    "",
  ].join("\n");
  const body = `${header}${links.join("\n")}\n`;

  const out = flags.get("в") ?? flags.get("out");
  if (out) {
    await writeFile(out, body, "utf8");
    process.stderr.write(`Ссылок: ${links.length}. Записано в ${out}\n`);
  } else {
    process.stdout.write(body);
    process.stderr.write(`\nСсылок: ${links.length}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
