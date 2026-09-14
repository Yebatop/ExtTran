/**
 * Стенд для замера себестоимости главы.
 *
 * Все цены в макетах стоят на оценке «около 3 ₽ за главу». Оценка взята из
 * расчёта, а не из измерения. Этот стенд превращает её в число.
 *
 * Осторожность с деньгами встроена: по умолчанию гоняется пилот из трёх глав,
 * печатается прикидка полного прогона — и всё. Полный прогон включается ключом
 * --все, и его можно ограничить потолком в рублях.
 *
 * Ни оригиналы, ни переводы в отчёт не попадают: только цифры.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, USD_RUB, isRegister, type Register, type Tier } from "./config.js";
import { loadChapter } from "./extract.js";
import { EMPTY_GLOSSARY, loadGlossary, type Glossary } from "./glossary.js";
import { translateChapter } from "./translate.js";
import { mean, median } from "./stats.js";
import { parseArgv } from "./args.js";

const USAGE = `Замер себестоимости главы.

  npm run замер -- <файл-со-списком-глав> [ключи]

Файл со списком — по одной ссылке или пути к файлу в строке.
Пустые строки и строки, начинающиеся с #, пропускаются.

Ключи:
  --глоссарий <файл>   JSON с терминами (сильно влияет на вход, берите настоящий)
  --регистр <какой>    живой | ровный | возвышенный   (по умолчанию ровный)
  --модели <список>    fast,strong                     (по умолчанию обе)
  --пилот <N>          сколько глав в пилоте           (по умолчанию 3)
  --все                прогнать весь список, а не только пилот
  --предел <рубли>     оборвать прогон, когда потрачено больше
  --отчёт <файл>       куда положить JSON  (по умолчанию out/замер-<дата>.json)

Сначала запустите без --все: увидите цену полного прогона до того, как он начнётся.
`;

interface Row {
  source: string;
  words: number;
  tier: Tier;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  rub: number;
  usd: number;
  seconds: number;
  outcome: "ок" | "отказ" | "ошибка";
  detail?: string;
}

interface TierSummary {
  tier: Tier;
  model: string;
  chapters: number;
  refusals: number;
  errors: number;
  medianRub: number;
  meanRub: number;
  minRub: number;
  maxRub: number;
  rubPer1000Words: number;
  medianWords: number;
  cacheHitChapters: number;
}

function summarise(rows: Row[], tier: Tier): TierSummary {
  const forTier = rows.filter((r) => r.tier === tier);
  const ok = forTier.filter((r) => r.outcome === "ок");
  const rubs = ok.map((r) => r.rub);
  const words = ok.map((r) => r.words);
  const totalRub = rubs.reduce((a, b) => a + b, 0);
  const totalWords = words.reduce((a, b) => a + b, 0);

  return {
    tier,
    model: MODELS[tier].id,
    chapters: ok.length,
    refusals: forTier.filter((r) => r.outcome === "отказ").length,
    errors: forTier.filter((r) => r.outcome === "ошибка").length,
    medianRub: median(rubs),
    meanRub: mean(rubs),
    minRub: rubs.length > 0 ? Math.min(...rubs) : 0,
    maxRub: rubs.length > 0 ? Math.max(...rubs) : 0,
    rubPer1000Words: totalWords > 0 ? (totalRub / totalWords) * 1000 : 0,
    medianWords: median(words),
    cacheHitChapters: ok.filter((r) => r.cacheReadTokens > 0).length,
  };
}

/** Тарифы из макетов: цена за месяц и сколько глав в квоте. */
const PLANS = [
  { name: "Читатель", rub: 490, chapters: 100 },
  { name: "Запойный", rub: 1190, chapters: 300 },
] as const;

function verdict(summary: TierSummary): string[] {
  if (summary.chapters === 0) return [];
  const cost = summary.medianRub;
  const lines: string[] = [];

  for (const plan of PLANS) {
    const revenuePerChapter = plan.rub / plan.chapters;
    const marginFull = (revenuePerChapter - cost) / revenuePerChapter;
    const marginTypical = (plan.rub - cost * plan.chapters * 0.6) / plan.rub;
    const breakEvenChapters = Math.floor(plan.rub / cost);

    lines.push(
      `  ${plan.name} (${plan.rub} ₽ за ${plan.chapters} глав → ${revenuePerChapter.toFixed(2)} ₽ на главу)`,
      `    если выберут квоту целиком: ${(marginFull * 100).toFixed(0)}% маржи`,
      `    при типичных 60% квоты:     ${(marginTypical * 100).toFixed(0)}% маржи`,
      `    в ноль выходим на ${breakEvenChapters} главах в месяц`,
    );
    if (marginFull < 0) {
      lines.push(
        `    ВНИМАНИЕ: читатель, выбирающий квоту целиком, приносит убыток.`,
      );
    }
  }
  return lines;
}

interface Args {
  listPath: string;
  glossary?: string;
  register: Register;
  tiers: Tier[];
  pilot: number;
  all: boolean;
  ceilingRub?: number;
  report?: string;
}

function parseArgs(argv: string[]): Args {
  const { flags, bare, positional } = parseArgv(argv, ["все", "all"]);

  const register = flags.get("регистр") ?? flags.get("register") ?? "ровный";
  if (!isRegister(register)) {
    throw new Error(`Регистр «${register}» не из списка: живой, ровный, возвышенный.`);
  }

  const tierList = (flags.get("модели") ?? flags.get("tiers") ?? "fast,strong")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  for (const t of tierList) {
    if (t !== "fast" && t !== "strong") {
      throw new Error(`Модель «${t}» не из списка: fast, strong.`);
    }
  }

  const args: Args = {
    listPath: positional[0] ?? "",
    register,
    tiers: tierList as Tier[],
    pilot: Number(flags.get("пилот") ?? flags.get("pilot") ?? 3),
    all: bare.has("все") || bare.has("all"),
  };
  const glossary = flags.get("глоссарий") ?? flags.get("glossary");
  if (glossary !== undefined) args.glossary = glossary;
  const ceiling = flags.get("предел") ?? flags.get("ceiling");
  if (ceiling !== undefined) args.ceilingRub = Number(ceiling);
  const report = flags.get("отчёт") ?? flags.get("report");
  if (report !== undefined) args.report = report;
  return args;
}

async function readSources(listPath: string): Promise<string[]> {
  const raw = await readFile(listPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.listPath === "") {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const sources = await readSources(args.listPath);
  if (sources.length === 0) throw new Error("В списке нет ни одной главы.");

  const glossary: Glossary = args.glossary
    ? await loadGlossary(args.glossary)
    : EMPTY_GLOSSARY;

  if (glossary.terms.length === 0) {
    process.stderr.write(
      "Глоссарий пуст. Замер будет заниженным: настоящий глоссарий на сотню\n" +
        "терминов добавляет к каждому запросу заметный вход. Возьмите настоящий.\n\n",
    );
  }

  const planned = args.all ? sources : sources.slice(0, args.pilot);
  const client = new Anthropic();
  const rows: Row[] = [];
  let spentRub = 0;
  let stoppedByCeiling = false;

  process.stderr.write(
    [
      `Глав в списке: ${sources.length}`,
      `Прогоняем: ${planned.length}${args.all ? "" : ` (пилот; полный прогон — ключ --все)`}`,
      `Модели: ${args.tiers.map((t) => MODELS[t].id).join(", ")}`,
      `Регистр: ${args.register}`,
      args.ceilingRub ? `Предел: ${args.ceilingRub} ₽` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  outer: for (const [index, source] of planned.entries()) {
    let chapter;
    try {
      chapter = await loadChapter(source);
    } catch (error) {
      for (const tier of args.tiers) {
        rows.push({
          source,
          words: 0,
          tier,
          model: MODELS[tier].id,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          rub: 0,
          usd: 0,
          seconds: 0,
          outcome: "ошибка",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      process.stderr.write(`  ${index + 1}/${planned.length} ✗ ${source}: не открылась\n`);
      continue;
    }

    for (const tier of args.tiers) {
      if (args.ceilingRub !== undefined && spentRub >= args.ceilingRub) {
        stoppedByCeiling = true;
        break outer;
      }

      const started = Date.now();
      try {
        const result = await translateChapter({
          chapter,
          glossary,
          register: args.register,
          tier,
          client,
        });
        const seconds = (Date.now() - started) / 1000;
        spentRub += result.spend.rub;
        rows.push({
          source,
          words: chapter.wordCount,
          tier,
          model: result.model,
          inputTokens: result.spend.inputTokens,
          outputTokens: result.spend.outputTokens,
          cacheReadTokens: result.spend.cacheReadTokens,
          cacheWriteTokens: result.spend.cacheWriteTokens,
          rub: result.spend.rub,
          usd: result.spend.usd,
          seconds,
          outcome: result.refusal ? "отказ" : "ок",
          ...(result.refusal
            ? { detail: result.refusal.category ?? "причина не названа" }
            : {}),
        });
        process.stderr.write(
          `  ${index + 1}/${planned.length} ${result.refusal ? "⊘" : "✓"} ` +
            `${tier.padEnd(6)} ${chapter.wordCount.toString().padStart(5)} слов  ` +
            `${result.spend.rub.toFixed(2)} ₽  ${seconds.toFixed(0)} с\n`,
        );
      } catch (error) {
        rows.push({
          source,
          words: chapter.wordCount,
          tier,
          model: MODELS[tier].id,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          rub: 0,
          usd: 0,
          seconds: (Date.now() - started) / 1000,
          outcome: "ошибка",
          detail: error instanceof Error ? error.message : String(error),
        });
        process.stderr.write(
          `  ${index + 1}/${planned.length} ✗ ${tier}: ${error instanceof Error ? error.message : error}\n`,
        );
      }
    }
  }

  const summaries = args.tiers.map((tier) => summarise(rows, tier));

  const out: string[] = ["", "─".repeat(64), ""];
  for (const s of summaries) {
    out.push(
      `${s.model}`,
      `  глав измерено      ${s.chapters}${s.refusals > 0 ? `, отказов ${s.refusals}` : ""}${s.errors > 0 ? `, ошибок ${s.errors}` : ""}`,
    );
    if (s.chapters > 0) {
      out.push(
        `  медиана            ${s.medianRub.toFixed(2)} ₽ за главу`,
        `  среднее            ${s.meanRub.toFixed(2)} ₽`,
        `  разброс            ${s.minRub.toFixed(2)} — ${s.maxRub.toFixed(2)} ₽`,
        `  на 1000 слов       ${s.rubPer1000Words.toFixed(2)} ₽`,
        `  медиана длины      ${s.medianWords.toLocaleString("ru")} слов`,
        `  глав с попаданием в кэш  ${s.cacheHitChapters} из ${s.chapters}`,
        "",
        "  Что это значит для тарифов:",
        ...verdict(s),
      );
    }
    out.push("");
  }

  if (!args.all && rows.some((r) => r.outcome === "ок")) {
    const perChapter = mean(rows.filter((r) => r.outcome === "ок").map((r) => r.rub));
    const remaining = sources.length - planned.length;
    const projected = perChapter * args.tiers.length * remaining;
    out.push(
      `Пилот стоил ${spentRub.toFixed(2)} ₽.`,
      `Остальные ${remaining} глав обойдутся примерно в ${projected.toFixed(0)} ₽.`,
      `Полный прогон: добавьте --все (и --предел, если хотите страховку).`,
      "",
    );
  }

  if (stoppedByCeiling) {
    out.push(`Прогон оборван: упёрлись в предел ${args.ceilingRub} ₽.`, "");
  }

  out.push(
    `Всего потрачено: ${spentRub.toFixed(2)} ₽ (курс ${USD_RUB}).`,
    "",
    "Медиана честнее среднего: длина глав у разных авторов различается вдвое,",
    "и одна очень длинная глава перекашивает среднее.",
    "",
  );

  process.stderr.write(out.join("\n"));

  const reportPath =
    args.report ??
    path.join("out", `замер-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        запущено: new Date().toISOString(),
        курс: USD_RUB,
        регистр: args.register,
        терминовВГлоссарии: glossary.terms.length,
        главВСписке: sources.length,
        прогнано: planned.length,
        потраченоРублей: Number(spentRub.toFixed(2)),
        итоги: summaries,
        строки: rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stderr.write(`Отчёт: ${reportPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
