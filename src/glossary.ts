/**
 * Глоссарий новеллы — то, чем перевод отличается от машинного.
 *
 * Две вещи, которые машина забывает через абзац: как пишется имя и кто кому
 * «ты». Здесь они лежат явно и уходят в промпт неизменным блоком, чтобы
 * его можно было закэшировать.
 */

export type TermKind =
  | "имя"
  | "обращение"
  | "техника"
  | "место"
  | "организация"
  | "предмет"
  | "прочее";

export interface Term {
  /** Как в оригинале. */
  en: string;
  /** Как по-русски. Это написание обязательно к соблюдению. */
  ru: string;
  kind: TermKind;
  /** Короткая помета: род, кто кому кем приходится. Без пересказа сюжета. */
  note?: string;
  /**
   * Откуда взялось написание. Закреплённое вручную имеет приоритет:
   * слияние его не перезаписывает.
   */
  source?: "вручную" | "предложено";
}

/** Кто к кому как обращается. В английском этого различия нет вовсе. */
export interface Address {
  from: string;
  to: string;
  form: "ты" | "вы";
}

export interface Glossary {
  novel: string;
  terms: Term[];
  addresses: Address[];
}

export const EMPTY_GLOSSARY: Glossary = {
  novel: "",
  terms: [],
  addresses: [],
};

/**
 * Глоссарий в текст для промпта.
 *
 * Порядок строк детерминированный — от этого зависит кэш: любой сдвиг байта
 * в префиксе обнуляет всё, что после него.
 */
export function renderGlossary(glossary: Glossary): string {
  if (glossary.terms.length === 0 && glossary.addresses.length === 0) {
    return "Глоссарий пуст: это первая глава книги.";
  }

  const parts: string[] = [];

  if (glossary.terms.length > 0) {
    const rows = [...glossary.terms]
      .sort((a, b) => a.en.localeCompare(b.en, "en"))
      .map((t) => {
        const note = t.note ? ` — ${t.note}` : "";
        return `${t.en} → ${t.ru} (${t.kind})${note}`;
      });
    parts.push(["ТЕРМИНЫ", ...rows].join("\n"));
  }

  if (glossary.addresses.length > 0) {
    const rows = [...glossary.addresses]
      .sort((a, b) => `${a.from} / ${a.to}`.localeCompare(`${b.from} / ${b.to}`, "ru"))
      .map((a) => `${a.from} → ${a.to}: ${a.form}`);
    parts.push(["ОБРАЩЕНИЯ", ...rows].join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * Компактный список уже известного — для промпта разбора.
 *
 * Полный глоссарий с переводами и пометами уходил в каждый запрос целиком, и
 * с ростом книги это становилось главной статьёй расхода: сто терминов это
 * около двух с половиной тысяч токенов на входе, и они пересылаются заново на
 * каждой главе. А модели здесь нужно ровно одно — знать, чего не предлагать
 * повторно. Для этого хватает английской стороны.
 */
export function renderKnownCompact(glossary: Glossary): string {
  if (glossary.terms.length === 0) return "Пока пусто: это первая глава книги.";
  const terms = [...glossary.terms]
    .map((t) => t.en)
    .sort((a, b) => a.localeCompare(b, "en"))
    .join(", ");
  return `Уже выписано, повторять не надо:\n${terms}`;
}
