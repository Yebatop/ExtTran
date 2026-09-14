/**
 * Хранилище в Postgres.
 *
 * На Vercel файловая система живёт ровно столько, сколько живёт запущенный
 * экземпляр, и не общая между ними: глоссарий там собирается и пропадает.
 * Это ломало главное обещание продукта — имена одинаковы во всех главах, —
 * потому что «все главы» на практике означало «пока не сменился процесс».
 *
 * Драйвер обычный, строка подключения обычная. Значит, подойдёт и Neon,
 * и Supabase, и что угодно ещё: привязки к одному поставщику здесь нет.
 */

import pg from "pg";
import type { Glossary } from "./glossary.js";
import type { BookRecord, Store } from "./store.js";

/**
 * Где искать строку подключения.
 *
 * Имена разные у разных поставщиков, и человек не должен об этом думать:
 * Vercel со своим Postgres выставляет POSTGRES_URL, Neon и Supabase —
 * DATABASE_URL. Берём то, что нашлось.
 */
export function connectionString(): string | undefined {
  return (
    process.env.TOLMACH_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    undefined
  );
}

/** Хосты, до которых идти по TLS незачем: соединение и так не покидает машину. */
const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

/**
 * Нужен ли TLS.
 *
 * Все размещённые базы его требуют, а локальная при испытаниях — наоборот,
 * не умеет, и без этого различия проверить адаптер негде.
 *
 * Пустое имя хоста значит подключение через файловый сокет: соединение не
 * покидает машину, шифровать нечего. Так и выяснилось — первый же прогон на
 * локальной базе уткнулся в «сервер не поддерживает SSL», потому что пустая
 * строка не совпала ни с одним именем и была принята за чужой хост.
 *
 * Явный sslmode в строке главнее догадок по хосту: если человек написал, чего
 * он хочет, спорить не с чем.
 */
function needsTls(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  const mode = parsed.searchParams.get("sslmode");
  if (mode === "disable") return false;
  if (mode !== null) return true;

  return !LOCAL_HOSTS.has(parsed.hostname);
}

export class PostgresStore implements Store {
  private pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      // По одному соединению на экземпляр: в бессерверной среде их плодится
      // столько же, сколько экземпляров, и база кончается раньше нас.
      max: 1,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(needsTls(url) ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  /** Создать таблицы, если их ещё нет. Выполняется один раз на экземпляр. */
  private init(): Promise<void> {
    this.ready ??= (async () => {
      await this.pool.query(`
        create table if not exists books (
          key text primary key,
          host text not null,
          slug text not null,
          title text not null,
          chapters_translated integer not null default 0,
          first_seen timestamptz not null,
          last_seen timestamptz not null
        );
        create table if not exists glossaries (
          book_key text primary key references books(key) on delete cascade,
          data jsonb not null,
          updated_at timestamptz not null default now()
        );
      `);
    })();
    return this.ready;
  }

  async readBook(key: string): Promise<BookRecord | null> {
    await this.init();
    const { rows } = await this.pool.query<{
      key: string;
      host: string;
      slug: string;
      title: string;
      chapters_translated: number;
      first_seen: Date;
      last_seen: Date;
    }>("select * from books where key = $1", [key]);
    const row = rows[0];
    if (!row) return null;
    return {
      key: row.key,
      host: row.host,
      slug: row.slug,
      title: row.title,
      chaptersTranslated: row.chapters_translated,
      firstSeen: row.first_seen.toISOString(),
      lastSeen: row.last_seen.toISOString(),
    };
  }

  async writeBook(record: BookRecord): Promise<void> {
    await this.init();
    await this.pool.query(
      `insert into books (key, host, slug, title, chapters_translated, first_seen, last_seen)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (key) do update set
         host = excluded.host,
         slug = excluded.slug,
         title = excluded.title,
         chapters_translated = excluded.chapters_translated,
         last_seen = excluded.last_seen`,
      [
        record.key,
        record.host,
        record.slug,
        record.title,
        record.chaptersTranslated,
        record.firstSeen,
        record.lastSeen,
      ],
    );
  }

  async listBooks(): Promise<BookRecord[]> {
    await this.init();
    const { rows } = await this.pool.query<{
      key: string;
      host: string;
      slug: string;
      title: string;
      chapters_translated: number;
      first_seen: Date;
      last_seen: Date;
    }>("select * from books order by last_seen desc limit 200");
    return rows.map((row) => ({
      key: row.key,
      host: row.host,
      slug: row.slug,
      title: row.title,
      chaptersTranslated: row.chapters_translated,
      firstSeen: row.first_seen.toISOString(),
      lastSeen: row.last_seen.toISOString(),
    }));
  }

  async readGlossary(key: string): Promise<Glossary | null> {
    await this.init();
    const { rows } = await this.pool.query<{ data: Glossary }>(
      "select data from glossaries where book_key = $1",
      [key],
    );
    return rows[0]?.data ?? null;
  }

  async writeGlossary(key: string, glossary: Glossary): Promise<void> {
    await this.init();
    // Книга должна существовать: на неё смотрит внешний ключ. Глоссарий
    // пишется раньше записи о книге в самой первой главе, поэтому заводим
    // заготовку, а не падаем.
    await this.pool.query(
      `insert into books (key, host, slug, title, chapters_translated, first_seen, last_seen)
       values ($1, '', '', $2, 0, now(), now())
       on conflict (key) do nothing`,
      [key, glossary.novel],
    );
    await this.pool.query(
      `insert into glossaries (book_key, data, updated_at)
       values ($1, $2, now())
       on conflict (book_key) do update set data = excluded.data, updated_at = now()`,
      [key, JSON.stringify(glossary)],
    );
  }

  /** Убрать книгу вместе с её глоссарием. Нужно уборке после проверки базы. */
  async removeBook(key: string): Promise<void> {
    await this.init();
    await this.pool.query("delete from books where key = $1", [key]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
