/**
 * Проверка сайта перед тем, как тратить деньги.
 *
 *   npm run проверка -- https://сайт/книга/глава-1
 *
 * Ключ не нужен: страница скачивается, из неё пробуют снять текст обоими
 * способами и говорят, годится сайт или нет. Десять секунд против прогона,
 * который выяснит то же самое за деньги.
 */

import { readFile } from "node:fs/promises";
import { attempts, fetchPage, linkDensity } from "./extract.js";
import { MODELS, USD_RUB } from "./config.js";

const USAGE = `Проверка страницы главы.

  npm run проверка -- <ссылка-или-файл>

Скачивает страницу и показывает, снимается ли с неё текст главы.
Ключ Anthropic не нужен, денег не тратит.
`;

/**
 * Грубая прикидка до замера. Обе величины — предположения, а не измерения:
 * английское слово это примерно 1,3 токена на входе, русский перевод того же
 * абзаца — примерно 2,7 токена на выходе. Настоящие числа даёт `npm run замер`.
 */
const TOKENS_PER_WORD_IN = 1.3;
const TOKENS_PER_WORD_OUT = 2.7;

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source) {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const isUrl = /^https?:\/\//i.test(source);
  let html: string;
  try {
    html = isUrl ? await fetchPage(source) : await readFile(source, "utf8");
  } catch (error) {
    process.stderr.write(
      [
        `Страница не открылась: ${error instanceof Error ? error.message : error}`,
        "",
        "Если сайт закрыт от роботов — сохраните главу браузером",
        "(Ctrl+S, «веб-страница полностью») и проверьте файл:",
        "  npm run проверка -- ./глава.html",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const bytes = Buffer.byteLength(html, "utf8");
  const density = linkDensity(html, source);
  const tries = attempts(html, source);

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

  const best = tries.reduce<(typeof tries)[number] | null>(
    (acc, t) => (acc === null || t.wordCount > acc.wordCount ? t : acc),
    null,
  );

  // Вердикт
  let usable = false;
  if (!best || best.wordCount < 100) {
    out.push(
      "ВЕРДИКТ: не годится.",
      bytes < 20_000
        ? "Страница слишком лёгкая — похоже, текст подгружается скриптом."
        : "Текста на странице много, но связного куска не нашлось.",
      "Сохраните главу браузером и проверьте файл — это обходит и то и другое.",
    );
  } else if (density > 0.5) {
    out.push(
      "ВЕРДИКТ: похоже на оглавление, а не на главу.",
      "Больше половины текста лежит в ссылках. Возьмите адрес конкретной главы.",
    );
  } else if (best.wordCount < 600) {
    out.push(
      `ВЕРДИКТ: сомнительно — всего ${best.wordCount} слов.`,
      "Либо глава короткая, либо снялся только кусок. Сверьте с тем, что видно в браузере.",
    );
  } else {
    usable = true;
    out.push(`ВЕРДИКТ: годится. Снято ${best.wordCount.toLocaleString("ru")} слов.`);
  }

  // Короткая глава — повод присмотреться, но переводить её можно.
  if (best && best.wordCount >= 100 && density <= 0.5) {
    usable = true;
  }

  if (best && usable) {
    out.push("", "Начало снятого текста (чтобы сверить глазами):", `  ${best.text.slice(0, 120)}…`);

    out.push("", "Грубая прикидка стоимости этой главы:");
    for (const tier of ["fast", "strong"] as const) {
      const model = MODELS[tier];
      const usd =
        (best.wordCount * TOKENS_PER_WORD_IN * model.inputPerMTok +
          best.wordCount * TOKENS_PER_WORD_OUT * model.outputPerMTok) /
        1_000_000;
      out.push(
        `  ${model.id.padEnd(22)} около ${(usd * USD_RUB).toFixed(2)} ₽`,
      );
    }
    out.push(
      "",
      "Это предположение, а не замер: считано по 1,3 токена на английское слово",
      "на входе и 2,7 на выходе. Настоящие числа даёт `npm run замер`.",
    );
  }

  out.push("");
  process.stdout.write(out.join("\n"));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
