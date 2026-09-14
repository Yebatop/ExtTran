/**
 * Опознание книги по ссылке на главу.
 *
 * Глоссарий собирается по книге, а не по главе: имя, названное в первой главе,
 * должно писаться так же и в трёхсотой. Значит, по ссылке на главу нужно уметь
 * сказать, к какой книге она относится, — и сказать одинаково для всех её глав,
 * иначе каждая глава заведёт себе отдельный глоссарий и смысл пропадёт.
 *
 * Общего стандарта у новелльных сайтов нет, но устройство ссылок у них
 * однотипное: /книга/глава. Поэтому отрезаем последний кусок пути, если он
 * похож на главу, и остаток считаем книгой.
 */

export interface BookRef {
  /** Устойчивый ключ: хост и путь до книги. По нему лежит глоссарий. */
  key: string;
  /** Хост — по нему видно, откуда книга. */
  host: string;
  /** Человекочитаемое имя из адреса, пока не узнали настоящее. */
  slug: string;
}

/** Куски пути, по которым видно, что дальше пошла глава, а не книга. */
const CHAPTER_MARKER =
  /^(chapter|chap|ch|episode|ep|part|volume|vol|глава|том|часть)[-_]?\d*$/i;

/** Кусок пути, внутри которого есть слово «глава» и номер: chapter-2-must-kill. */
const CHAPTER_INSIDE =
  /(^|[-_])(chapter|chap|episode|part|глава)([-_]?\d+)/i;

export function bookRef(chapterUrl: string): BookRef {
  const url = new URL(chapterUrl);
  const segments = url.pathname.split("/").filter((s) => s !== "");

  let cut = segments.length;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i] as string;
    if (
      CHAPTER_MARKER.test(segment) ||
      CHAPTER_INSIDE.test(segment) ||
      /^\d+$/.test(segment)
    ) {
      cut = i;
    }
  }

  // Ничего похожего на главу не нашли — значит, глава это просто последний
  // кусок пути. Так устроено большинство сайтов, и ошибиться тут дешевле,
  // чем считать книгой весь сайт целиком.
  if (cut === segments.length && segments.length > 1) cut = segments.length - 1;

  const bookPath = segments.slice(0, cut);
  const slug = bookPath.length > 0 ? (bookPath[bookPath.length - 1] as string) : url.hostname;

  return {
    key: `${url.hostname}${bookPath.length > 0 ? `/${bookPath.join("/")}` : ""}`,
    host: url.hostname,
    slug,
  };
}

/**
 * Ключ книги в виде, пригодном для имени файла, строки базы и куска адреса.
 *
 * Обратимость не нужна — нужно, чтобы разные книги не схлопнулись в один
 * ключ. Поэтому не срезаем, а заменяем всё небезопасное.
 */
export function storageKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
