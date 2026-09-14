/**
 * Консольный «Толмач».
 *
 *   npm run tolmach -- перевести <файл-или-ссылка> [ключи]
 *
 * Печатает перевод и сколько он стоил. Второе — главное: пока себестоимость
 * главы не измерена на настоящих текстах, любой разговор о тарифах гадание.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import { writeFile } from "node:fs/promises";
import {
  MODELS,
  TIERS,
  USD_RUB,
  isRegister,
  isTier,
  type Register,
  type Tier,
} from "./config.js";
import { formatSpend } from "./cost.js";
import { loadChapter } from "./extract.js";
import { EMPTY_GLOSSARY, type Glossary } from "./glossary.js";
import { translateChapter } from "./translate.js";
import { parseArgv } from "./args.js";
import { loadGlossary } from "./files.js";

const USAGE = `Толмач — перевод главы веб-новеллы на русский.

  npm run tolmach -- перевести <файл-или-ссылка> [ключи]

Ключи:
  --глоссарий <файл>   JSON с терминами и обращениями
  --регистр <какой>    живой | ровный | возвышенный   (по умолчанию ровный)
  --модель <какая>     fast | middle | strong         (по умолчанию strong)
  --усердие <какое>    low | medium | high            (по умолчанию medium)
  --в <файл>           куда положить перевод; иначе печатается в консоль

Пример:
  npm run tolmach -- перевести samples/chapter-en.txt \\
      --глоссарий samples/glossary.json --регистр возвышенный --модель fast
`;

interface Args {
  command: string;
  source: string;
  glossary?: string;
  register: Register;
  tier: Tier;
  effort: "low" | "medium" | "high";
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const { flags, positional } = parseArgv(argv);

  const command = positional[0] ?? "";
  const source = positional[1] ?? "";

  const register = flags.get("регистр") ?? flags.get("register") ?? "ровный";
  if (!isRegister(register)) {
    throw new Error(
      `Регистр «${register}» не из списка: живой, ровный, возвышенный.`,
    );
  }

  const tier = flags.get("модель") ?? flags.get("tier") ?? "strong";
  if (!isTier(tier)) {
    throw new Error(`Модель «${tier}» не из списка: ${TIERS.join(", ")}.`);
  }

  const effort = flags.get("усердие") ?? flags.get("effort") ?? "medium";
  if (effort !== "low" && effort !== "medium" && effort !== "high") {
    throw new Error(`Усердие «${effort}» не из списка: low, medium, high.`);
  }

  const args: Args = { command, source, register, tier, effort };
  const glossary = flags.get("глоссарий") ?? flags.get("glossary");
  if (glossary !== undefined) args.glossary = glossary;
  const out = flags.get("в") ?? flags.get("out");
  if (out !== undefined) args.out = out;
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command !== "перевести" && args.command !== "translate") {
    process.stdout.write(USAGE);
    process.exitCode = args.command === "" ? 0 : 1;
    return;
  }
  if (args.source === "") {
    throw new Error("Не указано, что переводить: нужен файл или ссылка.");
  }

  const chapter = await loadChapter(args.source);
  const glossary: Glossary = args.glossary
    ? await loadGlossary(args.glossary)
    : EMPTY_GLOSSARY;

  const model = MODELS[args.tier];
  const started = Date.now();

  process.stderr.write(
    [
      chapter.title ? `Глава: ${chapter.title}` : "Глава без заголовка",
      `Слов в оригинале: ${chapter.wordCount.toLocaleString("ru")}`,
      `Терминов в глоссарии: ${glossary.terms.length}`,
      `Регистр: ${args.register}`,
      `Модель: ${model.id}`,
      "",
      "Переводим…",
      "",
    ].join("\n"),
  );

  const result = await translateChapter({
    chapter,
    glossary,
    register: args.register,
    tier: args.tier,
    effort: args.effort,
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (result.refusal) {
    process.stderr.write(
      [
        "Модель отказалась переводить эту главу.",
        `Причина: ${result.refusal.category ?? "не названа"}`,
        result.refusal.explanation ? `Пояснение: ${result.refusal.explanation}` : "",
        "",
        "Это не сбой, а решение модели. Для продукта важно: такие главы будут,",
        "и на них нужен внятный экран, а не молчание.",
        "",
        formatSpend(result.spend, model),
        "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    process.exitCode = 2;
    return;
  }

  if (args.out) {
    await writeFile(args.out, `${result.text}\n`, "utf8");
    process.stderr.write(`Перевод записан в ${args.out}\n\n`);
  } else {
    process.stdout.write(`${result.text}\n\n`);
  }

  const perChapterRub = result.spend.rub;
  process.stderr.write(
    [
      "─".repeat(56),
      formatSpend(result.spend, model),
      `заняло           ${seconds} с`,
      "",
      `В пересчёте на сотню глав: ${(perChapterRub * 100).toFixed(0)} ₽ себестоимости.`,
      `Курс взят ${USD_RUB} ₽ за доллар — поправьте TOLMACH_USD_RUB под свой.`,
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
