/** Перевод расхода токенов в деньги. */

import type Anthropic from "@anthropic-ai/sdk";
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  USD_RUB,
  type ModelSpec,
} from "./config.js";

export interface Spend {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
  rub: number;
}

export function priceUsage(
  usage: Anthropic.Usage,
  model: ModelSpec,
): Spend {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;

  const usd =
    (inputTokens * model.inputPerMTok +
      cacheReadTokens * model.inputPerMTok * CACHE_READ_MULTIPLIER +
      cacheWriteTokens * model.inputPerMTok * CACHE_WRITE_MULTIPLIER +
      outputTokens * model.outputPerMTok) /
    1_000_000;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    usd,
    rub: usd * USD_RUB,
  };
}

export function formatSpend(spend: Spend, model: ModelSpec): string {
  const lines = [
    `модель            ${model.id}`,
    `на входе          ${spend.inputTokens.toLocaleString("ru")} токенов`,
  ];
  if (spend.cacheReadTokens > 0) {
    lines.push(
      `из кэша           ${spend.cacheReadTokens.toLocaleString("ru")} токенов`,
    );
  }
  if (spend.cacheWriteTokens > 0) {
    lines.push(
      `записано в кэш    ${spend.cacheWriteTokens.toLocaleString("ru")} токенов`,
    );
  }
  lines.push(
    `на выходе         ${spend.outputTokens.toLocaleString("ru")} токенов`,
    `стоило            $${spend.usd.toFixed(4)} — примерно ${spend.rub.toFixed(2)} ₽ по курсу ${USD_RUB}`,
  );
  return lines.join("\n");
}

/**
 * Потолок расходов, заданный в рублях или в долларах.
 *
 * Считаем внутри в рублях, но списывает-то Anthropic доллары, а рубли у нас
 * получаются по курсу из настройки — то есть по числу, которое вписал человек.
 * Поэтому в выводе всегда показываем обе величины и сам курс: иначе непонятно,
 * что именно ограничивает предел.
 */
export interface Ceiling {
  rub: number;
  usd: number;
}

export function makeCeiling(rub?: number, usd?: number): Ceiling | undefined {
  if (usd !== undefined && Number.isFinite(usd)) {
    return { usd, rub: usd * USD_RUB };
  }
  if (rub !== undefined && Number.isFinite(rub)) {
    return { rub, usd: rub / USD_RUB };
  }
  return undefined;
}

export function describeCeiling(ceiling: Ceiling): string {
  return (
    `Предел: ${ceiling.rub.toFixed(0)} ₽ — это $${ceiling.usd.toFixed(2)} ` +
    `по курсу ${USD_RUB} ₽/$ из TOLMACH_USD_RUB. Списывают доллары, курс наш.`
  );
}
