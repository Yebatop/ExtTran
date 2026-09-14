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

export interface Store {
  readBook(key: string): Promise<BookRecord | null>;
  writeBook(record: BookRecord): Promise<void>;
  listBooks(): Promise<BookRecord[]>;
  readGlossary(key: string): Promise<Glossary | null>;
  writeGlossary(key: string, glossary: Glossary): Promise<void>;
}

/** Хранилище в памяти — для проверок и для того, чтобы сайт поднимался всегда. */
export class MemoryStore implements Store {
  private books = new Map<string, BookRecord>();
  private glossaries = new Map<string, Glossary>();

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
}

/**
 * Какое хранилище использовать.
 *
 * Папка задаётся TOLMACH_STORE_DIR. Если её нет — память: сайт поднимется и
 * будет работать, просто забудет всё при перезапуске. Молча падать из-за
 * ненастроенного хранилища он не должен.
 */
export function chooseStore(): Store {
  const dir = process.env.TOLMACH_STORE_DIR;
  return dir ? new FileStore(dir) : new MemoryStore();
}
