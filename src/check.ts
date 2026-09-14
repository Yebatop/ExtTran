/**
 * Проверка сайта перед тем, как тратить деньги.
 *
 *   npm run check -- https://сайт/книга/глава-1        одна страница подробно
 *   npm run check -- --список список.txt               десяток разом, коротко
 *
 * Ключ не нужен: страницы скачиваются, из них пробуют снять текст обоими
 * способами и говорят, годится сайт или нет.
 *
 * Пакетный режим нужен из-за длины глав. Она главный источник разброса в
 * себестоимости, а первая глава книги почти всегда длиннее остальных — мерить
 * по ней всё равно что мерить средний рост по баскетболисту.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import { readFile } from "node:fs/promises";
import { attempts, fetchPage, linkDensity, type ExtractionAttempt } from "./extract.js";
import { MODELS, USD_RUB } from "./config.js";
import { mean, median } from "./stats.js";

const USAGE = `Проверка страниц глав.

  npm run check -- <ссылка-или-файл>        одна страница, подробно
  npm run check -- --список <файл>          весь список, коротко

Скачивает страницы и показывает, снимается ли с них текст главы.
Ключ Anthropic не нужен, денег не тратит.

Ключи пакетного режима:
  --сколько <N>   ограничить число проверяемых глав (по умолчанию 10)
`;

/**
 * Грубая прикидка до замера. Обе величины — предположения, а не измерения:
 * английское слово это примерно 1,3 токена на входе, русский перевод того же
 * абзаца — примерно 2,7 токена на выходе. Настоящие числа даёт `npm run замер`.
 */
const TOKENS_PER_WORD_IN = 1.3;
const TOKENS_PER_WORD_OUT = 2.7;

/** Пауза между запросами в пакетном режиме: не долбить чужой сайт очередью. */
const PAUSE_MS = 1000;

/** Цена и квота тарифа «Читатель» из макетов. */
const PLAN_RUB = 490;
const PLAN_CHAPTERS = 100;

type Verdict = "годится" | "коротко" | "оглавление" | "не годится" | "ошибка";

interface Judgement {
  verdict: Verdict;
  words: number;
  best: ExtractionAttempt | null;
  tries: ExtractionAttempt[];
  density: number;
}

function estimateRub(words: number, tier: "fast" | "strong"): number {
  const model = MODELS[tier];
  const usd =
    (words * TOKENS_PER_WORD_IN * model.inputPerMTok +
      words * TOKENS_PER_WORD_OUT * model.outputPerMTok) /
    1_000_000;
  return usd * USD_RUB;
}

async function loadHtml(source: string): Promise<string> {
  return /^https?:\/\//i.test(source) ? fetchPage(source) : readFile(source, "utf8");
}

function judge(html: string, source: string): Judgement {
  const density = linkDensity(html, source);
  const tries = attempts(html, source);
  const best = tries.reduce<ExtractionAttempt | null>(
    (acc, t) => (acc === null || t.wordCount > acc.wordCount ? t : acc),
    null,
  );

  let verdict: Verdict;
  if (!best || best.wordCount < 100) verdict = "не годится";
  else if (density > 0.5) verdict = "оглавление";
  else if (best.wordCount < 600) verdict = "коротко";
  else verdict = "годится";

  return { verdict, words: best?.wordCount ?? 0, best, tries, density };
}

async function one(source: string): Promise<void> {
  let html: string;
  try {
    html = await loadHtml(source);
  } catch (error) {
    process.stderr.write(
      [
        `Страница не открылась: ${error instanceof Error ? error.message : error}`,
        "",
        "Если сайт закрыт от роботов — сохраните главу браузером",
        "(Ctrl+S, «веб-страница полностью») и проверьте файл:",
        "  npm run check -- ./глава.html",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const bytes = Buffer.byteLength(html, "utf8");
  const { verdict, best, tries, density } = judge(html, source);

  const out: string[] = [
    `Источник: ${source}`,
    `Скачано: ${(bytes / 1024).toFixed(0)} КБ`,
    `Доля текста в ссылках: ${(density * 100).toFixed(0)}%`,
    "",
  ];

  if (tries.length === 0) {
    out.push("Текст снять не удалось ни одним способом.", "");
  } else {
    out.push("Что удалось снять:");
    for (const t of tries) {
      out.push(
        `  ${t.method.padEnd(20)} ${t.wordCount.toLocaleString("ru").padStart(6)} слов` +
          (t.title ? `   заголовок: ${t.title.slice(0, 60)}` : ""),
      );
    }
    out.push("");
  }

  if (verdict === "не годится") {
    out.push(
      "ВЕРДИКТ: не годится.",
      bytes < 20_000
        ? "Страница слишком лёгкая — похоже, текст подгружается скриптом."
        : "Текста на странице много, но связного куска не нашлось.",
      "Сохраните главу браузером и проверьте файл — это обходит и то и другое.",
    );
  } else if (verdict === "оглавление") {
    out.push(
      "ВЕРДИКТ: похоже на оглавление, а не на главу.",
      "Больше половины текста лежит в ссылках. Возьмите адрес конкретной главы.",
    );
  } else if (verdict === "коротко") {
    out.push(
      `ВЕРДИКТ: сомнительно — всего ${best?.wordCount} слов.`,
      "Либо глава короткая, либо снялся только кусок. Сверьте с тем, что видно в браузере.",
    );
  } else {
    out.push(`ВЕРДИКТ: годится. Снято ${best?.wordCount.toLocaleString("ru")} слов.`);
  }

  if (best && verdict !== "не годится" && verdict !== "оглавление") {
    out.push("", "Начало снятого текста (чтобы сверить глазами):", `  ${best.text.slice(0, 120)}…`);
    out.push("", "Грубая прикидка стоимости этой главы:");
    for (const tier of ["fast", "strong"] as const) {
      out.push(
        `  ${MODELS[tier].id.padEnd(22)} около ${estimateRub(best.wordCount, tier).toFixed(2)} ₽`,
      );
    }
    out.push(
      "",
      "Это одна глава, и почти наверняка нетипичная: первая в книге обычно",
      "длиннее прочих. Разброс покажет `npm run check -- --список <файл>`.",
    );
  }

  out.push("");
  process.stdout.write(out.join("\n"));
}

async function batch(listPath: string, limit: number): Promise<void> {
  const raw = await readFile(listPath, "utf8");
  const sources = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .slice(0, limit);

  if (sources.length === 0) throw new Error("В списке нет ни одной главы.");

  process.stderr.write(
    `Проверяем ${sources.length} глав. Ключ не нужен, денег не тратит.\n\n`,
  );

  const words: number[] = [];
  let failures = 0;

  for (const [index, source] of sources.entries()) {
    if (index > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    try {
      const html = await loadHtml(source);
      const { verdict, words: w } = judge(html, source);
      if (verdict === "годится" || verdict === "коротко") words.push(w);
      else failures += 1;
      const mark = verdict === "годится" ? "✓" : verdict === "коротко" ? "~" : "✗";
      process.stderr.write(
        `  ${String(index + 1).padStart(3)}. ${mark} ${w.toLocaleString("ru").padStart(6)} слов  ${verdict}\n`,
      );
    } catch {
      failures += 1;
      process.stderr.write(`  ${String(index + 1).padStart(3)}. ✗ не открылась\n`);
    }
  }

  const out: string[] = ["", "─".repeat(60), ""];

  if (words.length === 0) {
    out.push(
      "Ни одной пригодной главы. Дальше идти незачем — сначала разберитесь с сайтом.",
      "",
    );
    process.stdout.write(out.join("\n"));
    process.exitCode = 1;
    return;
  }

  const med = median(words);
  const avg = mean(words);
  const min = Math.min(...words);
  const max = Math.max(...words);

  out.push(
    `Пригодных глав: ${words.length} из ${sources.length}${failures > 0 ? ` (не открылось или не глава: ${failures})` : ""}`,
    `Медиана длины:  ${Math.round(med).toLocaleString("ru")} слов`,
    `Среднее:        ${Math.round(avg).toLocaleString("ru")} слов`,
    `Разброс:        ${min.toLocaleString("ru")} — ${max.toLocaleString("ru")} слов`,
    "",
  );

  if (avg > 0 && Math.abs(avg - med) / avg > 0.1) {
    out.push(
      "Среднее заметно разошлось с медианой — в выборке есть главы сильно длиннее",
      "или короче прочих. Считать надо по медиане.",
      "",
    );
  }

  out.push("Прикидка себестоимости по медиане:");
  for (const tier of ["fast", "strong"] as const) {
    const perChapter = estimateRub(med, tier);
    out.push(
      `  ${MODELS[tier].id.padEnd(22)} ${perChapter.toFixed(2)} ₽ за главу, ` +
        `${(perChapter * 100).toFixed(0)} ₽ за сотню`,
    );
  }

  const fastPer = estimateRub(med, "fast");
  const revenuePerChapter = PLAN_RUB / PLAN_CHAPTERS;
  const margin = (revenuePerChapter - fastPer) / revenuePerChapter;
  out.push(
    "",
    `Тариф «Читатель» — ${PLAN_RUB} ₽ за ${PLAN_CHAPTERS} глав, то есть ${revenuePerChapter.toFixed(2)} ₽ на главу.`,
    margin < 0
      ? `На быстрой модели это УБЫТОК: себестоимость ${fastPer.toFixed(2)} ₽ выше выручки.`
      : `Маржа при полной выборке квоты: ${(margin * 100).toFixed(0)}%.`,
    "",
    "Всё это прикидка по числу слов, а не замер: она не знает ни про глоссарий",
    "в промпте, ни про кэш, ни про то, насколько русский текст длиннее английского.",
    "Настоящие числа даёт `npm run замер`.",
    "",
  );

  process.stdout.write(out.join("\n"));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`У ключа ${arg} нет значения.`);
      }
      flags.set(arg.slice(2), value);
      i += 1;
    } else {
      positional.push(arg);
    }
  }

  const list = flags.get("список") ?? flags.get("list");
  if (list !== undefined) {
    const limit = Number(flags.get("сколько") ?? flags.get("limit") ?? 10);
    await batch(list, Number.isFinite(limit) && limit > 0 ? limit : 10);
    return;
  }

  const source = positional[0];
  if (source === undefined) {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }
  await one(source);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
