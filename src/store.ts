/**
 * Хранилище книг и глоссариев.
 *
 * Глоссарий — единственное, чем перевод отличается от машинного, и он должен
 * пережить главу, сеанс и перезапуск. Поэтому доступ к нему спрятан за
 * интерфейсом: сегодня под ним файлы, завтра база, и переписывать придётся
 * ровно один файл, а не весь сайт.
 *
 * ВАЖНО про Vercel: там файловая система живёт ровно столько, сколько живёт
 * запущенный экземпляр, и не общая между ними. Файловое хранилище там годится
 * посмотреть, как всё работает, но не для настоящей работы — для неё нужна
 * база. Интерфейс к этому готов, реализации ещё нет, и делать вид, что готова,
 * не надо.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { storageKey } from "./book.js";
import type { Glossary } from "./glossary.js";

export interface BookRecord {
  /** Ключ из bookRef: хост и путь до книги. */
  key: string;
  host: string;
  slug: string;
  /** Настоящее название, когда узнаем его из заголовка главы. */
  title: string;
  /** Сколько глав этой книги мы уже перевели. */
  chaptersTranslated: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Сохранённый перевод главы.
 *
 * Хранится ради двух вещей сразу: перечитать главу должно быть мгновенно, и
 * платить за неё второй раз не за что. Одна глава стоит около пяти рублей —
 * перезагрузка страницы стоила столько же.
 *
 * Владелец и галочка публикации лежат здесь с первого дня, хотя учётных
 * записей ещё нет. Так решено не на будущее, а по существу: в docs/rights-
 * policy.md записано, что перевод делается для заказавшего и виден только ему,
 * пока он сам не решит иначе. Кэш по одному адресу, без владельца, отдавал бы
 * чужой перевод любому — то есть делал бы за человека тот самый выбор, про
 * который там сказано, что делать его за него мы не будем.
 */
export interface TranslationRecord {
  /** Кто заказал перевод. Пока читатель один — см. SOLE_READER. */
  owner: string;
  /** Адрес главы у первоисточника. */
  source: string;
  bookKey: string;
  register: string;
  tier: string;
  title: string;
  words: number;
  text: string;
  model: string;
  rub: number;
  /** Та самая галочка. Выключена, включается руками. */
  published: boolean;
  /**
   * Ссылка на следующую главу, какой она была при переводе.
   *
   * Сохраняется, чтобы сохранённую главу можно было читать дальше, даже если
   * первоисточник сейчас недоступен. Это адрес, а не текст: оригинал мы не
   * храним, так записано в docs/rights-policy.md.
   */
  nextUrl: string | null;
  createdAt: string;
  /** Отсюда считаются сто восемьдесят дней хранения из политики. */
  lastReadAt: string;
}

/**
 * Единственный читатель, пока нет учётных записей.
 *
 * Значение осмысленное, а не пустое: когда записи появятся, по нему будет
 * видно, какие переводы заказаны до входа, и их можно будет привязать
 * к человеку, а не гадать.
 */
export const SOLE_READER = "до-учётных-записей";

export interface Store {
  readBook(key: string): Promise<BookRecord | null>;
  writeBook(record: BookRecord): Promise<void>;
  listBooks(): Promise<BookRecord[]>;
  readGlossary(key: string): Promise<Glossary | null>;
  writeGlossary(key: string, glossary: Glossary): Promise<void>;
  /**
   * Готовый перевод, если он уже заказан этим читателем в этом регистре и
   * этой моделью. Чтение продлевает срок хранения.
   */
  readTranslation(
    owner: string,
    source: string,
    register: string,
    tier: string,
  ): Promise<TranslationRecord | null>;
  writeTranslation(record: TranslationRecord): Promise<void>;
  /**
   * Главы книги, которые этот читатель уже переводил, — от новых к старым.
   *
   * Без этого к прочитанной главе нельзя вернуться: адрес её у первоисточника,
   * и по каталогу до неё не дойти. Текст сюда не тянем — на карточке книги
   * он не нужен, а глава весит пятнадцать килобайт.
   */
  listTranslations(
    owner: string,
    bookKey: string,
  ): Promise<Array<Omit<TranslationRecord, "text">>>;
  /**
   * Последние главы читателя по всем книгам сразу — от новых к старым.
   *
   * Отдельный вопрос к хранилищу, а не сложение ответов на сайте: «продолжить
   * читать» на главной иначе спрашивало бы по разу на каждую книгу, и на
   * десятке книг это десяток запросов к базе ради одной строки.
   */
  recentTranslations(
    owner: string,
    limit: number,
  ): Promise<Array<Omit<TranslationRecord, "text">>>;
  /**
   * Сколько терминов в глоссарии каждой книги.
   *
   * Отдельный вопрос, а не чтение глоссариев по одному: в каталоге нужно
   * только число, а глоссарий на трёхстах главах — это сотни терминов со
   * всеми пометами. Тянуть их целиком ради одной цифры в строке списка
   * незачем, тем более по разу на книгу.
   */
  termCounts(): Promise<Map<string, number>>;
}

/** Ключ перевода: читатель, глава, регистр, модель. Всё это меняет текст. */
export function translationKey(
  owner: string,
  source: string,
  register: string,
  tier: string,
): string {
  return [owner, source, register, tier].join("\u0000");
}

/** Хранилище в памяти — для проверок и для того, чтобы сайт поднимался всегда. */
export class MemoryStore implements Store {
  private books = new Map<string, BookRecord>();
  private glossaries = new Map<string, Glossary>();
  private translations = new Map<string, TranslationRecord>();

  async readBook(key: string): Promise<BookRecord | null> {
    return this.books.get(key) ?? null;
  }

  async writeBook(record: BookRecord): Promise<void> {
    this.books.set(record.key, record);
  }

  async listBooks(): Promise<BookRecord[]> {
    return [...this.books.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  async readGlossary(key: string): Promise<Glossary | null> {
    return this.glossaries.get(key) ?? null;
  }

  async writeGlossary(key: string, glossary: Glossary): Promise<void> {
    this.glossaries.set(key, glossary);
  }

  async readTranslation(
    owner: string,
    source: string,
    register: string,
    tier: string,
  ): Promise<TranslationRecord | null> {
    const found = this.translations.get(translationKey(owner, source, register, tier));
    if (!found) return null;
    found.lastReadAt = new Date().toISOString();
    return found;
  }

  async writeTranslation(record: TranslationRecord): Promise<void> {
    this.translations.set(
      translationKey(record.owner, record.source, record.register, record.tier),
      record,
    );
  }

  async listTranslations(
    owner: string,
    bookKey: string,
  ): Promise<Array<Omit<TranslationRecord, "text">>> {
    return [...this.translations.values()]
      .filter((t) => t.owner === owner && t.bookKey === bookKey)
      .map(({ text: _text, ...rest }) => rest)
      .sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt));
  }

  async recentTranslations(
    owner: string,
    limit: number,
  ): Promise<Array<Omit<TranslationRecord, "text">>> {
    return [...this.translations.values()]
      .filter((t) => t.owner === owner)
      .map(({ text: _text, ...rest }) => rest)
      .sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt))
      .slice(0, limit);
  }

  async termCounts(): Promise<Map<string, number>> {
    return new Map([...this.glossaries].map(([key, g]) => [key, g.terms.length]));
  }
}

/** Хранилище файлами: по папке на книгу. */
export class FileStore implements Store {
  constructor(private root: string) {}

  private dir(key: string): string {
    return path.join(this.root, storageKey(key));
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  async readBook(key: string): Promise<BookRecord | null> {
    return this.readJson<BookRecord>(path.join(this.dir(key), "book.json"));
  }

  async writeBook(record: BookRecord): Promise<void> {
    await this.writeJson(path.join(this.dir(record.key), "book.json"), record);
  }

  async listBooks(): Promise<BookRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return [];
    }
    const books: BookRecord[] = [];
    for (const name of names) {
      const record = await this.readJson<BookRecord>(
        path.join(this.root, name, "book.json"),
      );
      if (record) books.push(record);
    }
    return books.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  async readGlossary(key: string): Promise<Glossary | null> {
    return this.readJson<Glossary>(path.join(this.dir(key), "glossary.json"));
  }

  async writeGlossary(key: string, glossary: Glossary): Promise<void> {
    await this.writeJson(path.join(this.dir(key), "glossary.json"), glossary);
  }

  /** Имя файла перевода: от ключа, чтобы адрес главы не попал в имя файла. */
  private translationFile(
    owner: string,
    source: string,
    register: string,
    tier: string,
  ): string {
    const key = translationKey(owner, source, register, tier);
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return path.join(this.root, "переводы", `${(hash >>> 0).toString(36)}.json`);
  }

  async readTranslation(
    owner: string,
    source: string,
    register: string,
    tier: string,
  ): Promise<TranslationRecord | null> {
    const file = this.translationFile(owner, source, register, tier);
    const found = await this.readJson<TranslationRecord>(file);
    // Сверяем содержимое, а не только имя файла: свёртка может совпасть
    // у разных ключей, и тогда читатель получит чужую главу.
    if (
      !found ||
      found.owner !== owner ||
      found.source !== source ||
      found.register !== register ||
      found.tier !== tier
    ) {
      return null;
    }
    found.lastReadAt = new Date().toISOString();
    await this.writeJson(file, found);
    return found;
  }

  async writeTranslation(record: TranslationRecord): Promise<void> {
    await this.writeJson(
      this.translationFile(record.owner, record.source, record.register, record.tier),
      record,
    );
  }

  /**
   * Все переводы читателя, от новых к старым.
   *
   * Папка обходится целиком: имя файла — свёртка ключа, по нему не видно ни
   * книги, ни владельца. Для файлового хранилища это нормально — оно и так
   * только для «посмотреть, как работает», а в настоящей работе под сайтом
   * база.
   */
  private async allTranslations(
    owner: string,
  ): Promise<Array<Omit<TranslationRecord, "text">>> {
    let names: string[];
    try {
      names = await readdir(path.join(this.root, "переводы"));
    } catch {
      return [];
    }
    const found: Array<Omit<TranslationRecord, "text">> = [];
    for (const name of names) {
      const record = await this.readJson<TranslationRecord>(
        path.join(this.root, "переводы", name),
      );
      if (!record || record.owner !== owner) continue;
      const { text: _text, ...rest } = record;
      found.push(rest);
    }
    return found.sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt));
  }

  async listTranslations(
    owner: string,
    bookKey: string,
  ): Promise<Array<Omit<TranslationRecord, "text">>> {
    const all = await this.allTranslations(owner);
    return all.filter((t) => t.bookKey === bookKey);
  }

  async recentTranslations(
    owner: string,
    limit: number,
  ): Promise<Array<Omit<TranslationRecord, "text">>> {
    const all = await this.allTranslations(owner);
    return all.slice(0, limit);
  }

  async termCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const book of await this.listBooks()) {
      counts.set(book.key, (await this.readGlossary(book.key))?.terms.length ?? 0);
    }
    return counts;
  }
}

/**
 * Какое хранилище использовать.
 *
 * По убыванию надёжности: база, если есть строка подключения; папка, если
 * задана TOLMACH_STORE_DIR; иначе память. Последнее — не полноценная работа,
 * а способ подняться и показать себя: сайт будет работать, просто забудет всё
 * при перезапуске. Молча падать из-за ненастроенного хранилища он не должен.
 *
 * Импорт базы ленивый: без строки подключения драйвер не понадобится, и
 * тащить его в запуск незачем.
 */
export type StorageMode = "база" | "папка" | "память";

/**
 * Чем мы сейчас храним — одним словом.
 *
 * Нужно на странице: сайт с неработающим хранилищем выглядит точно так же,
 * как с работающим, просто каждый раз переводит заново. Вопрос «почему не
 * сохранилось» должен отвечаться взглядом, а не перепиской.
 */
export function storageMode(): StorageMode {
  if (process.env.TOLMACH_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL) {
    return "база";
  }
  return process.env.TOLMACH_STORE_DIR ? "папка" : "память";
}

export async function chooseStore(): Promise<Store> {
  const { connectionString, PostgresStore } = await import("./store-pg.js");
  const url = connectionString();
  if (url) return new PostgresStore(url);

  const dir = process.env.TOLMACH_STORE_DIR;
  return dir ? new FileStore(dir) : new MemoryStore();
}
