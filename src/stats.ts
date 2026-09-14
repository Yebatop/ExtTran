/**
 * Медиана и среднее.
 *
 * Медиана здесь не педантизм: длина главы у разных авторов различается вдвое,
 * а внутри книги первая глава обычно длиннее остальных. Одна такая перекашивает
 * среднее, и себестоимость выходит завышенной.
 */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Выбрать n элементов, равномерно разбросанных по списку.
 *
 * Появилось после первого замера: пилот брал первые три главы, а первые главы
 * систематически длиннее остальных — у нашей книги 2 729 слов против медианы
 * 1 738. Себестоимость выходила завышенной почти в полтора раза, и тарифы
 * считались от неё.
 *
 * Берём середины n равных отрезков, а не края: так первая глава, самая
 * нетипичная, в выборку сама собой не попадает.
 */
export function spread<T>(list: T[], n: number): T[] {
  if (n >= list.length) return [...list];
  if (n <= 0) return [];
  const picked: T[] = [];
  for (let i = 0; i < n; i += 1) {
    const index = Math.floor(((i + 0.5) * list.length) / n);
    picked.push(list[Math.min(index, list.length - 1)] as T);
  }
  return picked;
}
