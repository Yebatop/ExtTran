/**
 * Сборка глоссария из глав.
 *
 * Глоссарий — то, чем перевод отличается от машинного, но взять его неоткуда:
 * он собирается по ходу чтения книги. Здесь первые главы прогоняются через
 * модель, из них вынимаются имена, техники, места и обращения, и всё это
 * складывается в файл, который дальше правит человек.
 *
 * Важное ограничение, и оно не стилистическое: в глоссарий не должно попадать
 * пересказа сюжета, описаний сцен и цитат. Список имён собственных — это
 * справочник, а пересказ книги — уже производное от неё произведение. Правило
 * записано в docs/rights-policy.md, а здесь оно живёт в промпте.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODELS, type Tier } from "./config.js";
import { priceUsage, type Spend } from "./cost.js";
import type { Chapter } from "./extract.js";
import {
  renderKnownCompact,
  type Address,
  type Glossary,
  type Term,
  type TermKind,
} from "./glossary.js";

const KINDS = [
  "имя",
  "обращение",
  "техника",
  "место",
  "организация",
  "предмет",
  "прочее",
] as const satisfies readonly TermKind[];

const ExtractionSchema = z.object({
  terms: z.array(
    z.object({
      en: z.string(),
      ru: z.string(),
      kind: z.enum(KINDS),
      note: z.string(),
    }),
  ),
  addresses: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      form: z.enum(["ты", "вы"]),
    }),
  ),
});

const INSTRUCTIONS = `Ты составляешь глоссарий для перевода англоязычной веб-новеллы на русский.

Прочитай главу и выпиши то, что должно писаться одинаково во всех главах книги:

ТЕРМИНЫ — имена персонажей, формы обращения к ним, названия техник, мест,
организаций и придуманных предметов. Для каждого дай написание по-русски
практической транскрипцией. Говорящие названия переводи по смыслу, если автор
сам играет на значении; имена людей — транскрибируй.

ОБРАЩЕНИЯ — кто к кому обращается на «ты», а кто на «вы». В английском этого
различия нет, и вывести его можно только из отношений: учитель и ученик,
старший и младший, чужие друг другу люди. Выписывай только те пары, которые
в этой главе действительно разговаривают.

ЧЕГО НЕ ДЕЛАТЬ, и это важнее остального:
— не пересказывай сюжет;
— не описывай сцены и события;
— не цитируй текст главы;
— в помете к термину пиши только сухую справку: род, кто кому кем приходится,
  к какой организации принадлежит. Не больше десяти слов. Если сказать нечего —
  оставь пустую строку.

Глоссарий — это список имён, а не изложение книги.

Термины, которые уже есть в присланном глоссарии, повторять не надо: выписывай
только новое.`;

export interface ExtractionResult {
  terms: Term[];
  addresses: Address[];
  spend: Spend;
  model: string;
}

export async function extractTerms(options: {
  chapter: Chapter;
  known: Glossary;
  tier: Tier;
  client?: Anthropic;
}): Promise<ExtractionResult> {
  const { chapter, known, tier } = options;
  const model = MODELS[tier];
  const client = options.client ?? new Anthropic();

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: renderKnownCompact(known),
      cache_control: { type: "ephemeral" },
    },
  ];

  // Усердие низкое намеренно. Выписать имена из главы — работа не думательная,
  // а на моделях с обдумыванием оно включено по умолчанию и работает на полную:
  // разбор главы выходил дороже её перевода. Модели без поддержки усердия
  // ключ не отправляем, они на нём падают.
  const response = await client.messages.parse({
    model: model.id,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: chapter.text }],
    output_config: {
      format: zodOutputFormat(ExtractionSchema),
      ...(model.supportsEffort ? { effort: "low" as const } : {}),
    },
  });

  const spend = priceUsage(response.usage, model);
  const parsed = response.parsed_output;

  if (!parsed) {
    throw new Error(
      "Модель вернула ответ, который не разобрался по схеме. " +
        "Обычно это значит, что глава пришла обрезанной или пустой.",
    );
  }

  return {
    terms: parsed.terms.map((t) => ({
      en: t.en.trim(),
      ru: t.ru.trim(),
      kind: t.kind,
      ...(t.note.trim() ? { note: t.note.trim() } : {}),
      source: "предложено" as const,
    })),
    addresses: parsed.addresses.map((a) => ({
      from: a.from.trim(),
      to: a.to.trim(),
      form: a.form,
    })),
    spend,
    model: response.model,
  };
}

export interface MergeReport {
  added: number;
  skippedExisting: number;
  addressesAdded: number;
}

/**
 * Слияние: то, что человек закрепил вручную, не трогаем никогда.
 * Предложенное моделью добавляется только если такого термина ещё нет.
 */
export function mergeIntoGlossary(
  glossary: Glossary,
  found: { terms: Term[]; addresses: Address[] },
): MergeReport {
  const byEn = new Map(glossary.terms.map((t) => [t.en.toLowerCase(), t]));
  let added = 0;
  let skippedExisting = 0;

  for (const term of found.terms) {
    if (term.en === "" || term.ru === "") continue;
    if (byEn.has(term.en.toLowerCase())) {
      skippedExisting += 1;
      continue;
    }
    glossary.terms.push(term);
    byEn.set(term.en.toLowerCase(), term);
    added += 1;
  }

  const seen = new Set(
    glossary.addresses.map((a) => `${a.from.toLowerCase()}|${a.to.toLowerCase()}`),
  );
  let addressesAdded = 0;
  for (const address of found.addresses) {
    if (address.from === "" || address.to === "") continue;
    const key = `${address.from.toLowerCase()}|${address.to.toLowerCase()}`;
    if (seen.has(key)) continue;
    glossary.addresses.push(address);
    seen.add(key);
    addressesAdded += 1;
  }

  return { added, skippedExisting, addressesAdded };
}
