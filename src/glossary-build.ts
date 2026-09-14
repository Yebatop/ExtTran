/**
 * Собрать глоссарий из первых глав книги.
 *
 *   npm run глоссарий -- <список-глав> --в глоссарий.json
 *
 * Глоссарий дописывается, а не перезаписывается: если файл уже есть, он
 * читается, дополняется и сохраняется обратно. Термины, помеченные как
 * закреплённые вручную, слияние не трогает.
 *
 * Файл сохраняется после каждой главы — оборванный прогон не теряет работу.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, USD_RUB, type Tier } from "./config.js";
import { describeCeiling, makeCeiling, type Ceiling } from "./cost.js";
import { loadChapter } from "./extract.js";
import { type Glossary, type Term } from "./glossary.js";
import { extractTerms, mergeIntoGlossary } from "./terms.js";
import { parseArgv } from "./args.js";

const USAGE = `Сборка глоссария из глав.

  npm run глоссарий -- <файл-со-списком-глав> --в <глоссарий.json> [ключи]

Просмотр собранного:

  npm run glossary -- --показать глоссарий.json

Печатает термины по разделам и подсвечивает подозрительное. Ключ не нужен.

Ключи:
  --в <файл>        куда писать глоссарий (обязательно; дописывается, если есть)
  --книга <имя>     название книги для заголовка глоссария
  --модель <какая>  strong | fast   (по умолчанию strong)
  --предел <рубли>  оборвать, когда потрачено больше
  --предел-usd <$>  то же, но сразу в долларах — их и списывают
  --глав <N>        ограничить число глав из списка

Десяти-пятнадцати глав обычно хватает, чтобы собрать костяк: дальше новые
термины появляются редко. После прогона файл стоит открыть и пройтись глазами —
модель предлагает, решает человек.
`;

interface Args {
  listPath: string;
  out: string;
  novel?: string;
  tier: Tier;
  ceiling?: Ceiling;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const { flags, positional } = parseArgv(argv);

  const tier = flags.get("модель") ?? flags.get("tier") ?? "strong";
  if (tier !== "fast" && tier !== "strong") {
    throw new Error(`Модель «${tier}» не из списка: strong, fast.`);
  }

  const args: Args = {
    listPath: positional[0] ?? "",
    out: flags.get("в") ?? flags.get("out") ?? "",
    tier,
  };
  const novel = flags.get("книга") ?? flags.get("novel");
  if (novel !== undefined) args.novel = novel;
  const rub = flags.get("предел") ?? flags.get("ceiling");
  const usd = flags.get("предел-usd") ?? flags.get("ceiling-usd");
  const ceiling = makeCeiling(
    rub !== undefined ? Number(rub) : undefined,
    usd !== undefined ? Number(usd) : undefined,
  );
  if (ceiling !== undefined) args.ceiling = ceiling;
  const limit = flags.get("глав") ?? flags.get("limit");
  if (limit !== undefined) args.limit = Number(limit);
  return args;
}

async function readList(listPath: string): Promise<string[]> {
  const raw = await readFile(listPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function readOrCreate(path: string, novel: string): Promise<Glossary> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<Glossary>;
    return {
      novel: raw.novel ?? novel,
      terms: raw.terms ?? [],
      addresses: raw.addresses ?? [],
    };
  } catch {
    return { novel, terms: [], addresses: [] };
  }
}

function sortGlossary(glossary: Glossary): Glossary {
  return {
    novel: glossary.novel,
    terms: [...glossary.terms].sort((a, b) => a.en.localeCompare(b.en, "en")),
    addresses: [...glossary.addresses].sort((a, b) =>
      `${a.from} / ${a.to}`.localeCompare(`${b.from} / ${b.to}`, "ru"),
    ),
  };
}

/**
 * Показать глоссарий по-человечески и подсветить, что стоит перепроверить.
 *
 * Просмотр — обязательный шаг: транскрипцию имён машина угадывает через раз,
 * а исправить её в начале дешевле, чем переписывать три сотни глав. Но сотню
 * терминов глазами по сырому JSON не пройдёшь, тем более с телефона.
 */
function show(glossary: Glossary): void {
  const out: string[] = [];
  const byKind = new Map<string, Term[]>();
  for (const term of glossary.terms) {
    const list = byKind.get(term.kind) ?? [];
    list.push(term);
    byKind.set(term.kind, list);
  }

  out.push(
    glossary.novel ? `${glossary.novel}` : "Глоссарий",
    `${glossary.terms.length} терминов, ${glossary.addresses.length} пар обращений`,
    "",
  );

  for (const [kind, terms] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`${kind.toUpperCase()} — ${terms.length}`);
    for (const t of [...terms].sort((a, b) => a.en.localeCompare(b.en, "en"))) {
      const mark = t.source === "вручную" ? "✓" : " ";
      out.push(`  ${mark} ${t.en.padEnd(30)} ${t.ru}`);
    }
    out.push("");
  }

  if (glossary.addresses.length > 0) {
    out.push("КТО КОМУ КАК");
    for (const a of glossary.addresses) {
      out.push(`    ${a.from} → ${a.to}: ${a.form}`);
    }
    out.push("");
  }

  // Подозрительное
  const notes: string[] = [];

  const byRu = new Map<string, string[]>();
  for (const t of glossary.terms) {
    const list = byRu.get(t.ru.toLowerCase()) ?? [];
    list.push(t.en);
    byRu.set(t.ru.toLowerCase(), list);
  }
  for (const [ru, ens] of byRu) {
    if (ens.length > 1) {
      notes.push(`  одно русское написание на разные термины: «${ru}» ← ${ens.join(", ")}`);
    }
  }

  for (const t of glossary.terms) {
    if (t.ru === t.en) notes.push(`  не переведено: ${t.en}`);
    if (/[а-яё]/i.test(t.en)) notes.push(`  кириллица в английском поле: ${t.en}`);
    if (/^[a-z]/.test(t.en) && !t.en.includes(" ")) {
      notes.push(`  похоже на нарицательное, а не на имя: ${t.en} → ${t.ru}`);
    }
    if (t.note && t.note.split(/\s+/).length > 10) {
      notes.push(`  помета длиннее десяти слов (в глоссарии не место пересказу): ${t.en}`);
    }
  }

  if (notes.length > 0) {
    out.push("СТОИТ ПЕРЕПРОВЕРИТЬ", ...notes.slice(0, 40), "");
    if (notes.length > 40) out.push(`  …и ещё ${notes.length - 40}`, "");
  }

  const pinned = glossary.terms.filter((t) => t.source === "вручную").length;
  out.push(
    `Проверено вручную: ${pinned} из ${glossary.terms.length}.`,
    "Отметить проверенное — поставить строке \"source\": \"вручную\" в файле;",
    "слияние такие строки больше не трогает.",
    "",
  );

  process.stdout.write(out.join("\n"));
}

async function main(): Promise<void> {
  const raw = parseArgv(process.argv.slice(2));
  const toShow = raw.flags.get("показать") ?? raw.flags.get("show");
  if (toShow !== undefined) {
    show(await readOrCreate(toShow, ""));
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.listPath === "" || args.out === "") {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const sources = await readList(args.listPath);
  const planned = args.limit ? sources.slice(0, args.limit) : sources;
  if (planned.length === 0) throw new Error("В списке нет ни одной главы.");

  const glossary = await readOrCreate(args.out, args.novel ?? "");
  if (args.novel) glossary.novel = args.novel;

  const model = MODELS[args.tier];
  const client = new Anthropic();
  let spentRub = 0;
  let totalAdded = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalAddresses = 0;

  process.stderr.write(
    [
      `Глав к разбору: ${planned.length}`,
      `Уже в глоссарии: ${glossary.terms.length} терминов, ${glossary.addresses.length} пар обращений`,
      `Модель: ${model.id}`,
      args.ceiling ? describeCeiling(args.ceiling) : "",
    ]
      .filter(Boolean)
      .join("\n") + "\n\n",
  );

  for (const [index, source] of planned.entries()) {
    // Останавливаемся ДО главы, которая перелетит через предел, а не после.
    // Цену главы заранее не знаем, поэтому берём среднюю по уже пройденным:
    // иначе потолок систематически превышается на стоимость одной главы.
    if (args.ceiling !== undefined) {
      const done = index;
      const expected = done > 0 ? spentRub / done : 0;
      if (spentRub + expected > args.ceiling.rub) {
        process.stderr.write(
          `\nОстановились на ${spentRub.toFixed(2)} ₽ ($${(spentRub / USD_RUB).toFixed(2)}): ` +
            `следующая глава примерно за ${expected.toFixed(2)} ₽ вывела бы за предел ` +
            `${args.ceiling.rub.toFixed(0)} ₽.\n`,
        );
        break;
      }
    }

    try {
      const chapter = await loadChapter(source);
      const found = await extractTerms({
        chapter,
        known: glossary,
        tier: args.tier,
        client,
      });
      const report = mergeIntoGlossary(glossary, found);
      spentRub += found.spend.rub;
      totalAdded += report.added;
      totalAddresses += report.addressesAdded;

      await writeFile(
        args.out,
        `${JSON.stringify(sortGlossary(glossary), null, 2)}\n`,
        "utf8",
      );

      const sp = found.spend;
      totalIn += sp.inputTokens + sp.cacheReadTokens + sp.cacheWriteTokens;
      totalOut += sp.outputTokens;
      process.stderr.write(
        `  ${index + 1}/${planned.length} ✓ +${report.added} терм., ` +
          `+${report.addressesAdded} обращ.  ` +
          `вход ${(sp.inputTokens + sp.cacheReadTokens + sp.cacheWriteTokens).toLocaleString("ru")}` +
          `${sp.cacheReadTokens > 0 ? ` (из кэша ${sp.cacheReadTokens.toLocaleString("ru")})` : ""}` +
          `, выход ${sp.outputTokens.toLocaleString("ru")}  ${sp.rub.toFixed(2)} ₽\n`,
      );
    } catch (error) {
      process.stderr.write(
        `  ${index + 1}/${planned.length} ✗ ${error instanceof Error ? error.message : error}\n`,
      );
    }
  }

  process.stderr.write(
    [
      "",
      "─".repeat(56),
      `Глоссарий: ${glossary.terms.length} терминов, ${glossary.addresses.length} пар обращений`,
      `Добавлено за прогон: ${totalAdded} терминов, ${totalAddresses} обращений`,
      `Сборка стоила ${spentRub.toFixed(2)} ₽ ($${(spentRub / USD_RUB).toFixed(2)})`,
      `Токенов: вход ${totalIn.toLocaleString("ru")}, выход ${totalOut.toLocaleString("ru")}`,
      totalOut > totalIn / 2
        ? "Выход велик для списка имён — значит, платим за обдумывание."
        : "Расход в основном на вход: это пересылаемый список уже известного.",
      "",
      `Файл: ${args.out}`,
      "",
      "Откройте и пройдитесь глазами: модель предлагает, решает человек.",
      "У проверенных строк поставьте \"source\": \"вручную\" — слияние их больше",
      "не тронет.",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
