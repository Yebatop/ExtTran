/**
 * Перевод главы.
 *
 * Промпт собран так, чтобы кэшироваться: сначала правила, одинаковые для всех
 * книг, потом глоссарий, одинаковый в пределах одной книги, и только потом —
 * регистр и текст главы, которые меняются каждый раз. Любой сдвиг байта в
 * начале обнуляет кэш всего, что после него, поэтому порядок здесь не
 * косметический.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  MAX_OUTPUT_TOKENS,
  MODELS,
  REGISTERS,
  type Register,
  type Tier,
} from "./config.js";
import { priceUsage, type Spend } from "./cost.js";
import { renderGlossary, type Glossary } from "./glossary.js";
import type { Chapter } from "./extract.js";
import { polish } from "./polish.js";

const RULES = `Ты переводишь главу англоязычной веб-новеллы на русский язык.

ГЛОССАРИЙ ОБЯЗАТЕЛЕН. Если термин есть в глоссарии, пиши его ровно так, как
там указано, — без вариантов и без склонения написания. Это главное правило:
читатель бросает перевод, когда герой на каждой главе зовётся по-новому.

ОБРАЩЕНИЯ. В английском одно «you», в русском выбор между «ты» и «вы» говорит,
кто перед кем стоит. Соблюдай таблицу обращений из глоссария. Для пар, которых
в ней нет, выбери форму по отношениям персонажей и держи её до конца главы.

ИМЕНА ВНЕ ГЛОССАРИЯ. Передавай практической транскрипцией и держи одинаково
внутри главы. Не переводи говорящие имена, если только автор сам не играет
на их значении.

ПО-РУССКИ, А НЕ ПО-АНГЛИЙСКИ. Переводи смысл, а не конструкцию. Падеж и
предлог выбираются по тому, что сказано, а не копируются из оригинала. На
вопрос «куда» отвечает «в библиотеку», а не «библиотека». «Where are we
going?» — это «Куда мы едем?», а не «Где мы едем?»: в английском одно слово
и на место, и на направление, в русском — разные. Если русская фраза звучит
так, будто под ней просвечивает английская, перепиши её.

РЕПЛИКИ. Каждая реплика начинается с тире на новой строке — все, включая
первую в сцене и самые короткие. Кавычки для прямой речи не используются.
Мысли героя — курсивом или без знаков, но не репликой.

ЗНАКИ. Многоточие по-русски — три точки, сколько бы их ни стояло в оригинале.
Ряды точек, восклицательных и вопросительных знаков приводи к русской норме.

ЧТО ОТДАВАТЬ. Только текст перевода. Ни предисловий, ни примечаний, ни
пояснений в скобках, ни разметки. Разбиение на абзацы — как в оригинале.
Ничего не сокращай, не пересказывай и не дополняй: сколько сцен в оригинале,
столько и в переводе.

ЧЕГО НЕ ДЕЛАТЬ. Не смягчай и не вырезай сцены — это художественный текст для
взрослого читателя, и он должен дойти таким, каким его написали. Не вставляй
пометок о том, что ты переводчик или что что-то опущено.`;

export interface Translation {
  text: string;
  spend: Spend;
  model: string;
  /** Заполнено, если модель отказалась переводить главу. */
  refusal?: { category: string | null; explanation: string | null };
}

export interface TranslateOptions {
  chapter: Chapter;
  glossary: Glossary;
  register: Register;
  tier: Tier;
  /** Глубина обдумывания. На моделях без поддержки не отправляется. */
  effort?: "low" | "medium" | "high";
  client?: Anthropic;
  /**
   * Вызывается по мере того, как приходит перевод.
   *
   * Глава переводится от минуты до двух — ждать её молча значит показывать
   * пустой экран дольше, чем человек готов ждать. Текст, который появляется
   * по абзацу, ту же минуту делает терпимой, поэтому сайт читает перевод
   * потоком, а консоли это просто не нужно и она колбэк не передаёт.
   */
  onText?: (chunk: string) => void;
}

/**
 * Запрос на перевод главы.
 *
 * Отдельно от отправки, потому что отправок две: поток — когда читатель ждёт
 * главу прямо сейчас, и пакет — когда мы переводим наперёд и ответ нужен не
 * через минуту, а к вечеру. Промпт при этом обязан быть один и тот же: разойдись
 * они хоть пробелом, и кэш префикса перестанет попадать, а переводы одной книги
 * начнут отличаться по слогу в зависимости от того, каким путём шли.
 */
export function translateRequest(
  options: Omit<TranslateOptions, "client" | "onText">,
): Anthropic.MessageCreateParamsNonStreaming {
  const { chapter, glossary, register, tier } = options;
  const model = MODELS[tier];

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: RULES, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `ГЛОССАРИЙ${glossary.novel ? ` — ${glossary.novel}` : ""}\n\n${renderGlossary(glossary)}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: model.id,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: "user",
        content:
          `Регистр перевода: ${REGISTERS[register]}\n\n` +
          "Переведи главу целиком.\n\n---\n\n" +
          chapter.text,
      },
    ],
  };

  // Haiku 4.5 на output_config.effort отвечает ошибкой, поэтому уровень
  // отправляем только тем моделям, которые его принимают.
  if (model.supportsEffort) {
    request.output_config = { effort: options.effort ?? "medium" };
  }

  return request;
}

/**
 * Разобрать ответ модели в перевод.
 *
 * Тоже отдельно и по той же причине: пакетный ответ приходит готовым
 * сообщением, без потока, и разбирать его надо теми же правилами — включая
 * отказ, обрыв по потолку токенов и машинальную типографику.
 */
export function readTranslation(message: Anthropic.Message, tier: Tier): Translation {
  const spend = priceUsage(message.usage, MODELS[tier]);

  if (message.stop_reason === "refusal") {
    return {
      text: "",
      spend,
      model: message.model,
      refusal: {
        category: message.stop_details?.category ?? null,
        explanation: message.stop_details?.explanation ?? null,
      },
    };
  }

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `Перевод упёрся в потолок в ${MAX_OUTPUT_TOKENS.toLocaleString("ru")} токенов ` +
        "и оборвался. Главу нужно разбить на части.",
    );
  }

  const text = polish(
    message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(""),
  );

  return { text, spend, model: message.model };
}

export async function translateChapter(
  options: TranslateOptions,
): Promise<Translation> {
  const client = options.client ?? new Anthropic();

  let message: Anthropic.Message;
  try {
    const stream = client.messages.stream({
      ...translateRequest(options),
      stream: true,
    });
    if (options.onText) stream.on("text", options.onText);
    message = await stream.finalMessage();
  } catch (error) {
    throw describeApiError(error);
  }

  return readTranslation(message, options.tier);
}

function describeApiError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error(
      "API не принял ключ. Проверьте ANTHROPIC_API_KEY или войдите через `ant auth login`.",
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new Error("Упёрлись в лимит запросов. Стоит подождать и повторить.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new Error(`API отклонил запрос: ${error.message}`);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new Error(`Не достучались до API: ${error.message}`);
  }
  if (error instanceof Anthropic.APIError) {
    return new Error(`Ошибка API ${error.status}: ${error.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
