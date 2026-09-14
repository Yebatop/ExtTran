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
