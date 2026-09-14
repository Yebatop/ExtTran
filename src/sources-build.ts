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
import { fetchPage, findNextLink } from "./extract.js";

const USAGE = `Сборка списка глав.

  npm run список -- --шаблон "https://сайт/книга/глава-{1..50}" --в список.txt

  npm run список -- --оглавление https://сайт/книга --содержит /глава- --в список.txt

Ключи:
  --шаблон <строка>    адрес с диапазоном в фигурных скобках: {147..196}
  --цепочкой <url>     идти от этой главы по ссылкам «следующая»
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
function preview(links: string[], fromToc: boolean): void {
  const tail = (u: string) => u.replace(/^https?:\/\/[^/]+/, "");
  const show = links.length <= 8 ? links : [...links.slice(0, 5), "…", ...links.slice(-2)];
  process.stderr.write("Что набралось:\n");
  for (const link of show) {
    process.stderr.write(link === "…" ? "  …\n" : `  ${tail(link)}\n`);
  }
  process.stderr.write(
    "\nПробегитесь глазами: это должны быть главы подряд, без пропусков.\n" +
      "Если среди них видно оглавление, комментарии или что-то постороннее —\n" +
      "вычистите файл руками.\n",
  );

  // Только для оглавления: в шаблоне и цепочке число глав задаёт сам человек,
  // и говорить ему, что их мало, — сбивать с толку.
  if (fromToc && links.length < 20) {
    process.stderr.write(
      "\nСсылок мало для книги. Обычно это значит, что список глав на странице\n" +
        "подгружается скриптом или показаны только первая и последние — тогда\n" +
        "со страницы его не снять. Есть обход: `--цепочкой <адрес первой главы>`\n" +
        "идёт по ссылкам «вперёд» и собирает главы подряд.\n",
    );
  }
}

/**
 * Пройти по книге от указанной главы, следуя ссылкам «вперёд».
 *
 * Медленно — по запросу на главу с паузой, — зато работает там, где адреса
 * не угадываются и списка глав на сайте нет. Для выборки в десяток глав это
 * полминуты, и другого способа часто не остаётся.
 */
async function byChain(start: string, count: number): Promise<string[]> {
  const out: string[] = [start];
  const seen = new Set([start]);
  let current = start;

  for (let i = 1; i < count; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    let html: string;
    try {
      html = await fetchPage(current);
    } catch (error) {
      process.stderr.write(
        `  оборвалось на ${i}-й: ${error instanceof Error ? error.message : error}\n`,
      );
      break;
    }

    const next = findNextLink(html, current);
    if (next === null) {
      process.stderr.write(
        `  ссылка «следующая» не нашлась после ${i}-й главы — дальше идти некуда\n`,
      );
      break;
    }
    if (seen.has(next)) {
      process.stderr.write("  ссылка «следующая» ведёт на уже пройденную главу — остановились\n");
      break;
    }

    out.push(next);
    seen.add(next);
    current = next;
    process.stderr.write(`  ${out.length}. ${next.replace(/^https?:\/\/[^/]+/, "")}\n`);
  }

  return out;
}

/** Записать список и показать, что в нём. */
async function write(
  links: string[],
  out: string | undefined,
  fromToc: boolean,
): Promise<void> {
  if (links.length === 0) {
    throw new Error(
      "Ни одной ссылки не набралось. Если брали с оглавления — попробуйте " +
        "другой кусок адреса в --содержит.",
    );
  }

  const body =
    [
      "# Список глав для Толмача. Сгенерирован автоматически — проверьте глазами.",
      "# Коммитить не надо: это карта чужого сайта, нужная только на время прогона.",
      "",
    ].join("\n") + `${links.join("\n")}\n`;

  if (out !== undefined) {
    await writeFile(out, body, "utf8");
    process.stderr.write(`\nСсылок: ${links.length}. Записано в ${out}\n\n`);
    preview(links, fromToc);
  } else {
    process.stdout.write(body);
    process.stderr.write(`\nСсылок: ${links.length}\n`);
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
  const chain = flags.get("цепочкой") ?? flags.get("chain");

  if (!pattern && !toc && !chain) {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const base = flags.get("база") ?? flags.get("base");
  const want = Number(flags.get("сколько") ?? flags.get("limit") ?? 10);

  if (chain !== undefined) {
    process.stderr.write(
      `Идём от этой главы вперёд, ${Number.isFinite(want) && want > 0 ? want : 10} шт.\n` +
        "  1. (с неё и начинаем)\n",
    );
    const links = await byChain(chain, Number.isFinite(want) && want > 0 ? want : 10);
    await write(links, flags.get("в") ?? flags.get("out"), false);
    return;
  }

  let links = pattern
    ? expandPattern(pattern)
    : await fromTableOfContents(
        toc ?? "",
        flags.get("содержит") ?? flags.get("contains") ?? "",
        base,
      );

  const limit = flags.get("сколько") ?? flags.get("limit");
  if (limit !== undefined) links = links.slice(0, Number(limit));

  await write(links, flags.get("в") ?? flags.get("out"), toc !== undefined);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
