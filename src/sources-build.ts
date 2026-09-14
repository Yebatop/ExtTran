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

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { USER_AGENT } from "./config.js";

const USAGE = `Сборка списка глав.

  npm run список -- --шаблон "https://сайт/книга/глава-{1..50}" --в список.txt

  npm run список -- --оглавление https://сайт/книга --содержит /глава- --в список.txt

Ключи:
  --шаблон <строка>    адрес с диапазоном в фигурных скобках: {147..196}
  --оглавление <url>   страница со списком глав (или сохранённый файл)
  --база <url>         имя сайта, если оглавление читается из файла
  --содержит <кусок>   какие ссылки с неё брать (например /chapter-)
  --в <файл>           куда записать; иначе печатается в консоль
  --сколько <N>        обрезать список до N ссылок

Проверьте получившийся список глазами: на страницах книг попадаются ссылки
на комментарии и на первую главу в трёх местах сразу.
`;

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

/**
 * Ссылки из оглавления — со страницы или из сохранённого файла.
 *
 * Файл нужен не для тестов: если список глав на сайте рисует скрипт, со
 * страницы его не снять, и единственный способ — сохранить её браузером.
 * Тогда для разбора относительных адресов понадобится --база.
 */
async function fromTableOfContents(
  source: string,
  contains: string,
  base?: string,
): Promise<string[]> {
  const isUrl = /^https?:\/\//i.test(source);
  let html: string;

  if (isUrl) {
    const response = await fetch(source, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Оглавление ответило ${response.status} ${response.statusText}.`);
    }
    html = await response.text();
  } else {
    html = await readFile(source, "utf8");
    if (base === undefined) {
      process.stderr.write(
        "Читаем сохранённый файл без --база: относительные адреса разобрать не выйдет.\n" +
          "Если в списке окажутся куски вроде /novel/x/chapter-1 без имени сайта —\n" +
          "добавьте --база https://имя-сайта.\n\n",
      );
    }
  }

  const url = isUrl ? source : (base ?? "https://example.invalid/");
  const dom = new JSDOM(html, { url });
  const anchors = [...dom.window.document.querySelectorAll("a[href]")];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let absolute: string;
    try {
      const parsed = new URL(href, url);
      // Якорь ведёт на ту же страницу: /глава-1#comments это та же глава-1.
      parsed.hash = "";
      absolute = parsed.toString();
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

/**
 * Показать, что набралось. Список без просмотра — источник половины бед:
 * в него легко попадают страницы комментариев, оглавление и ссылки
 * «следующая глава», и выясняется это только на прогоне.
 */
function preview(links: string[]): void {
  const tail = (u: string) => u.replace(/^https?:\/\/[^/]+/, "");
  const show = links.length <= 8 ? links : [...links.slice(0, 5), "…", ...links.slice(-2)];
  process.stderr.write("Что набралось:\n");
  for (const link of show) {
    process.stderr.write(link === "…" ? "  …\n" : `  ${tail(link)}\n`);
  }
  process.stderr.write(
    "\nПробегитесь глазами: адреса должны отличаться только номером главы.\n" +
      "Если среди них видно оглавление, комментарии или что-то постороннее —\n" +
      "уточните --содержит или вычистите файл руками.\n",
  );
  if (links.length < 20) {
    process.stderr.write(
      "\nСсылок мало для книги. Обычно это значит, что список глав на странице\n" +
        "подгружается скриптом или разбит на страницы — тогда со страницы\n" +
        "оглавления его не снять, и адреса придётся собирать иначе.\n",
    );
  }
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

  const base = flags.get("база") ?? flags.get("base");
  let links = pattern
    ? expandPattern(pattern)
    : await fromTableOfContents(
        toc ?? "",
        flags.get("содержит") ?? flags.get("contains") ?? "",
        base,
      );

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
    process.stderr.write(`Ссылок: ${links.length}. Записано в ${out}\n\n`);
    preview(links);
  } else {
    process.stdout.write(body);
    process.stderr.write(`\nСсылок: ${links.length}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
