/**
 * Подсветка терминов глоссария в переводе.
 *
 * То, чем мы отличаемся, до сих пор было видно только цифрой в шапке главы.
 * Здесь оно становится видно в самом тексте: имя, написанное так, как решено
 * один раз на всю книгу, помечено — и по нему можно посмотреть, как оно
 * выглядит в оригинале.
 *
 * Главная трудность — русский язык склоняется. «Эбенхольц» в тексте встретится
 * как «Эбенхольца», «Эбенхольцу», «Эбенхольцем». Искать точное совпадение
 * значит не найти почти ничего.
 *
 * Поэтому ищем термин целиком плюс одно из окончаний — не произвольные буквы.
 * Разница существенная: «мана» плюс любые три буквы поймает «манатки», а
 * «мана» плюс окончание из списка — нет. Лучше пропустить падеж, чем
 * подчеркнуть постороннее слово.
 */

/** Окончания, которые может получить существительное. От длинных к коротким. */
const ENDINGS = [
  "ами", "ями", "ому", "ему", "ыми", "ими", "ого", "его",
  "ах", "ях", "ам", "ям", "ом", "ем", "ой", "ей", "ую", "юю",
  "ые", "ие", "ых", "их", "ым", "им", "ов", "ев", "ья", "ье",
  "а", "я", "у", "ю", "е", "ы", "и", "о", "ь", "й",
];

export interface Segment {
  text: string;
  /** Заполнено, если кусок — это термин из глоссария. */
  term?: { en: string; ru: string; note?: string };
}

export interface HighlightTerm {
  en: string;
  ru: string;
  note?: string;
}

/** Буква любого из двух алфавитов — по ним определяем границу слова. */
const LETTER = /[\p{L}]/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Один разбор текста на куски: обычные и термины.
 *
 * Термины сортируются от длинных к коротким, иначе «Орден» съест начало
 * «Орден рыцарей-Стражей» и длинное название никогда не совпадёт целиком.
 */
export function highlight(text: string, terms: HighlightTerm[]): Segment[] {
  const usable = terms
    .filter((t) => t.ru.trim().length >= 3)
    .sort((a, b) => b.ru.length - a.ru.length);
  if (usable.length === 0 || text === "") return [{ text }];

  const byPattern = new Map<string, HighlightTerm>();
  const parts: string[] = [];
  for (const term of usable) {
    const ru = term.ru.trim();
    const pattern = `${escapeRegExp(ru)}(?:${ENDINGS.join("|")})?`;
    if (byPattern.has(pattern)) continue;
    byPattern.set(pattern, term);
    parts.push(pattern);
  }

  const re = new RegExp(`(${parts.join("|")})`, "gu");
  const segments: Segment[] = [];
  let last = 0;

  for (const m of text.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;

    // Не подчёркиваем кусок внутри слова: «мане» в «манекене» — не термин.
    const before = start > 0 ? text[start - 1] : "";
    const after = end < text.length ? text[end] : "";
    if ((before && LETTER.test(before)) || (after && LETTER.test(after))) continue;

    const term = usable.find((t) => m[0].startsWith(t.ru.trim()));
    if (!term) continue;

    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: m[0], term: { en: term.en, ru: term.ru, ...(term.note ? { note: term.note } : {}) } });
    last = end;
  }

  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.length > 0 ? segments : [{ text }];
}
