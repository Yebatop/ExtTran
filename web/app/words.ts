/**
 * Числительные по-русски.
 *
 * «21 терминов» и «2 глава» — мелочь, но заметная: страница сразу выглядит
 * недоделанной. Правило одно на весь сайт, поэтому и лежит в одном месте.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count));
  // Одиннадцать–четырнадцать — исключение: они ведут себя как «много».
  if (n % 100 >= 11 && n % 100 <= 14) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** «21 термин», «14 терминов». */
export function terms(count: number): string {
  return `${count} ${plural(count, "термин", "термина", "терминов")}`;
}

/** «3 главы», «1 глава». */
export function chapters(count: number): string {
  return `${count} ${plural(count, "глава", "главы", "глав")}`;
}
