/**
 * Модели, цены и регистры перевода.
 *
 * Цены — прайс Anthropic на 2026-06-24, доллары за миллион токенов.
 * Они меняются: перед тем как считать по ним себестоимость всерьёз,
 * стоит сверить с прайсом.
 */

export type Tier = "fast" | "middle" | "strong";

export const TIERS = ["fast", "middle", "strong"] as const;

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

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
  /**
   * Сколько токенов должно быть в префиксе, чтобы он вообще закэшировался.
   * Порог у моделей разный и не по возрастанию поколений: у Haiku 4.5 он
   * 4096, у Opus 5 — 512. Префикс короче порога не кэшируется молча: ни
   * ошибки, ни предупреждения, просто cache_creation_input_tokens = 0.
   */
  minCacheTokens: number;
}

/**
 * Три уровня. Дешёвый — для основной массы глав; средний — то, что имеет
 * смысл ставить на кнопку «перевести получше»; дорогой — потолок качества.
 *
 * Средний появился после первого замера: Opus обошёлся в двадцать рублей за
 * главу при выручке в четыре, то есть на кнопку его не поставить ни при каком
 * разумном множителе. Sonnet стоит ровно вдвое дороже Haiku — вот его и надо
 * мерить, прежде чем рисовать тариф.
 *
 * Все три переопределяются переменными окружения, чтобы замер можно было
 * прогнать на любой тройке, ничего не пересобирая.
 */
export const MODELS: Record<Tier, ModelSpec> = {
  fast: {
    id: process.env.TOLMACH_MODEL_FAST ?? "claude-haiku-4-5",
    inputPerMTok: 1,
    outputPerMTok: 5,
    supportsEffort: false,
    minCacheTokens: 4096,
  },
  middle: {
    id: process.env.TOLMACH_MODEL_MIDDLE ?? "claude-sonnet-5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    supportsEffort: true,
    minCacheTokens: 1024,
  },
  strong: {
    id: process.env.TOLMACH_MODEL_STRONG ?? "claude-opus-5",
    inputPerMTok: 5,
    outputPerMTok: 25,
    supportsEffort: true,
    minCacheTokens: 512,
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

/**
 * Как мы представляемся сайтам.
 *
 * ТОЛЬКО ЛАТИНИЦА. HTTP-заголовки — это ByteString, то есть байты 0–255:
 * любая кириллическая буква здесь роняет запрос ещё до отправки, с ошибкой
 * «Cannot convert argument to a ByteString». Так уже было: в строке стояло
 * русское слово, и не работал ни один сетевой запрос.
 */
export const USER_AGENT =
  "Tolmach/0.1 (web novel translator; +https://github.com/Yebatop/ExtTran)";
