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
 * Номер главы из её адреса.
 *
 * Порядок, в котором главы переводились, читателю ничего не говорит: если
 * человек начал со сто шестнадцатой, она и есть сто шестнадцатая, а не
 * «первая переведённая». Номер живёт в адресе, и это единственное место, где
 * он есть наверняка: в заголовке страницы его может не быть вовсе.
 *
 * Берём последнее совпадение, а не первое: в пути до книги тоже попадаются
 * числа — /novel/1234/chapter-5 про пятую главу, а не про тысяча двести
 * тридцать четвёртую.
 */
export function chapterNumber(chapterUrl: string): number | null {
  let url: URL;
  try {
    url = new URL(chapterUrl);
  } catch {
    return null;
  }

  // Ищем слово «глава» с номером. Отрицательный просмотр назад — чтобы «ch»
  // не находилось внутри слов вроде search-12.
  const marked = [
    ...url.pathname.matchAll(
      /(?<![a-zа-я])(?:chapter|chap|ch|episode|ep|part|глава)[-_]?(\d{1,6})/gi,
    ),
  ];
  const last = marked[marked.length - 1];
  if (last?.[1]) return Number(last[1]);

  for (const key of ["chapter", "c", "глава"]) {
    const value = url.searchParams.get(key);
    if (value && /^\d{1,6}$/.test(value)) return Number(value);
  }

  // Голое число в пути: /novel/имя/116.
  const bare = url.pathname.split("/").filter((s) => /^\d{1,6}$/.test(s));
  const tail = bare[bare.length - 1];
  return tail ? Number(tail) : null;
}

/** Убрать из заголовка главы имя книги и повтор номера. */
function withoutBook(title: string, books: readonly string[]): string {
  let out = title.trim();

  for (const book of books) {
    const name = book.trim();
    if (!name) continue;
    if (out.toLowerCase() === name.toLowerCase()) return "";
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`^${escaped}\\s*[-–—:|·]+\\s*`, "i"), "");
    out = out.replace(new RegExp(`\\s*[-–—:|·]+\\s*${escaped}$`, "i"), "");
  }

  // «Chapter 116:» в начале — номер мы и так покажем отдельно.
  out = out.replace(
    /^(?:chapter|chap|ch\.?|episode|ep\.?|part|глава)\s*[-_№]?\s*\d+\s*[:.\-–—]*\s*/i,
    "",
  );
  return out.trim();
}

/**
 * Как назвать главу в списке.
 *
 * На одних сайтах в заголовке страницы имя главы, на других — имя книги, на
 * третьих и то и другое сразу. Имя книги из заголовка убираем: в списке глав
 * одной книги оно повторялось бы в каждой строке и не сообщало ничего.
 *
 * Имён книги можно передать несколько, и это не прихоть: читатель вправе
 * переименовать книгу, а в уже сохранённых главах останется то имя, под
 * которым её знал первоисточник. Убирать надо оба, иначе сразу после
 * переименования старое имя вылезет в каждой строке списка.
 */
export function chapterName(
  chapterUrl: string,
  title?: string,
  ...books: Array<string | null | undefined>
): string {
  const number = chapterNumber(chapterUrl);
  const own = withoutBook(title ?? "", books.filter((b): b is string => Boolean(b)));

  if (number !== null && own) return `Глава ${number} · ${own}`;
  if (number !== null) return `Глава ${number}`;
  return own || "Глава без заголовка";
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
