/**
 * Модели, цены и регистры перевода.
 *
 * Цены — прайс Anthropic на 2026-06-24, доллары за миллион токенов.
 * Они меняются: перед тем как считать по ним себестоимость всерьёз,
 * стоит сверить с прайсом.
 */

export type Tier = "fast" | "strong";

export interface ModelSpec {
  /** Идентификатор модели для API. */
  id: string;
  /** Доллары за миллион входных токенов. */
  inputPerMTok: number;
  /** Доллары за миллион выходных токенов. */
  outputPerMTok: number;
  /**
   * Принимает ли модель output_config.effort.
   * Haiku 4.5 на нём падает, поэтому для неё не отправляем.
   */
  supportsEffort: boolean;
}

/**
 * Два тарифных уровня из продуктового замысла: дешёвый для основной массы
 * глав и дорогой по кнопке. Оба переопределяются переменными окружения,
 * чтобы замер можно было прогнать на любой паре, ничего не пересобирая.
 */
export const MODELS: Record<Tier, ModelSpec> = {
  fast: {
    id: process.env.TOLMACH_MODEL_FAST ?? "claude-haiku-4-5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    supportsEffort: false,
  },
  strong: {
    id: process.env.TOLMACH_MODEL_STRONG ?? "claude-opus-5",
    inputPerMTok: 5,
    outputPerMTok: 25,
    supportsEffort: true,
  },
};

/** Чтение из кэша стоит примерно десятую часть входного токена, запись — четвертью дороже. */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Курс доллара. Это вход, а не факт: подставьте свой перед тем,
 * как показывать кому-то рубли.
 */
export const USD_RUB = Number(process.env.TOLMACH_USD_RUB ?? 92);

export type Register = "живой" | "ровный" | "возвышенный";

export const REGISTERS: Record<Register, string> = {
  живой:
    "Живой. Короткие фразы, разговорные обороты в диалогах, минимум причастных " +
    "оборотов. Так переводят литРПГ и городское фэнтези.",
  ровный:
    "Ровный. Нейтральная литературная норма без стилизации в обе стороны. " +
    "Подходит почти всему.",
  возвышенный:
    "Возвышенный. Чуть архаичный строй фразы, полные формы обращений, " +
    "уважительные конструкции там, где они уместны по отношениям персонажей. " +
    "Так переводят сянься и уся.",
};

export function isRegister(value: string): value is Register {
  return value in REGISTERS;
}

/**
 * Потолок выходных токенов. Глава в 2 500 английских слов даёт примерно
 * 7 000 русских токенов, так что запас четырёхкратный: упереться в потолок
 * дороже, чем его не использовать.
 */
export const MAX_OUTPUT_TOKENS = 32000;
