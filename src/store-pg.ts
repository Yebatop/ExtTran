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
import type {
  BookRecord,
  QueueRecord,
  QueueState,
  Store,
  TranslationRecord,
} from "./store.js";

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

/** Раскодировать %2F и прочее; если строка битая — вернуть как есть. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Куда на самом деле пойдёт соединение: имя хоста или путь к файловому сокету.
 *
 * Разбираем строкой, а не `new URL`, потому что `new URL` на половине рабочих
 * строк подключения просто падает: `postgres://кто-то@/база?host=/var/run/...`
 * — законная строка для драйвера и «Invalid URL» для разборщика адресов, ведь
 * после собаки обязан стоять непустой хост. Драйвер такие строки понимает, и
 * решать за него, нужен ли TLS, надо по тем же правилам.
 */
function hostOf(url: string): string {
  // Ключ host главнее части до косой черты — так же его понимает и драйвер.
  // Этим ключом и записывают путь к сокету, когда в адресе места ему нет.
  const viaKey = /[?&]host=([^&]*)/.exec(url)?.[1];
  if (viaKey !== undefined) return decode(viaKey);

  const scheme = url.indexOf("://");
  if (scheme === -1) return "";
  const authority = url.slice(scheme + 3).split(/[/?#]/, 1)[0] ?? "";
  // Пароль тоже может содержать собаку, поэтому берём последнюю.
  const at = authority.lastIndexOf("@");
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  // Порт отрезаем с конца, чтобы не задеть двоеточия внутри адреса IPv6.
  return decode(hostPort.replace(/:\d*$/, "").replace(/^\[|\]$/g, ""));
}

/**
 * Нужен ли TLS.
 *
 * Все размещённые базы его требуют, а локальная при испытаниях — наоборот,
 * не умеет, и без этого различия проверить адаптер негде.
 *
 * Путь вместо имени хоста (или пустое имя) значит файловый сокет: соединение
 * не покидает машину, шифровать нечего. Так и выяснилось — дважды: сперва
 * прогон на локальной базе уткнулся в «сервер не поддерживает SSL», потому что
 * пустая строка не совпала ни с одним именем и была принята за чужой хост;
 * потом то же самое повторилось на строке с ключом `host=`, потому что она
 * вовсе не разбиралась как адрес, а на неразобранную строку мы отвечали
 * «раз непонятно — значит, TLS».
 *
 * Явный sslmode в строке главнее догадок по хосту: если человек написал, чего
 * он хочет, спорить не с чем.
 */
function needsTls(url: string): boolean {
  const mode = /[?&]sslmode=([^&]*)/.exec(url)?.[1];
  if (mode !== undefined) return decode(mode) !== "disable";

  const host = hostOf(url);
  // Путь — это сокет, а не сервер в сети.
  if (host.startsWith("/")) return false;
  return !LOCAL_HOSTS.has(host);
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
          last_seen timestamptz not null,
          cover_url text,
          source_title text
        );
        -- Таблица могла быть создана до того, как появились эти колонки:
        -- create table if not exists её не тронет, а добавить их надо.
        alter table books add column if not exists cover_url text;
        alter table books add column if not exists source_title text;
        create table if not exists glossaries (
          book_key text primary key references books(key) on delete cascade,
          data jsonb not null,
          updated_at timestamptz not null default now()
        );
        create table if not exists translations (
          reader text not null,
          source text not null,
          register text not null,
          tier text not null,
          book_key text not null,
          title text not null default '',
          words integer not null default 0,
          body text not null,
          model text not null default '',
          rub numeric(10,4) not null default 0,
          published boolean not null default false,
          next_url text,
          created_at timestamptz not null default now(),
          last_read_at timestamptz not null default now(),
          primary key (reader, source, register, tier)
        );
        create table if not exists queue (
          reader text not null,
          source text not null,
          register text not null,
          tier text not null,
          book_key text not null,
          state text not null,
          batch_id text,
          note text,
          title text not null default '',
          words integer not null default 0,
          next_url text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (reader, source, register, tier)
        );
        -- Очередь могла быть заведена до того, как в неё добавили снятое со
        -- страницы: create table if not exists её не тронет.
        alter table queue add column if not exists title text not null default '';
        alter table queue add column if not exists words integer not null default 0;
        alter table queue add column if not exists next_url text;
        -- По этому индексу ходит сборщик пакетов: ему нужны самые давние
        -- главы в заданном состоянии, и без индекса он перебирал бы всю
        -- очередь целиком на каждый заход.
        create index if not exists queue_state_idx
          on queue (reader, state, created_at);
        create index if not exists translations_last_read
          on translations (last_read_at);
      `);
    })();
    return this.ready;
  }

  async readBook(key: string): Promise<BookRecord | null> {
    await this.init();
    const { rows } = await this.pool.query<BookRow>(
      "select * from books where key = $1",
      [key],
    );
    const row = rows[0];
    return row ? asBook(row) : null;
  }

  async writeBook(record: BookRecord): Promise<void> {
    await this.init();
    await this.pool.query(
      `insert into books (key, host, slug, title, chapters_translated, first_seen, last_seen, cover_url, source_title)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (key) do update set
         host = excluded.host,
         slug = excluded.slug,
         title = excluded.title,
         chapters_translated = excluded.chapters_translated,
         last_seen = excluded.last_seen,
         cover_url = excluded.cover_url,
         -- Имя у первоисточника пишется один раз: оно про источник, а не про
         -- то, как книгу решил называть читатель.
         source_title = coalesce(books.source_title, excluded.source_title)`,
      [
        record.key,
        record.host,
        record.slug,
        record.title,
        record.chaptersTranslated,
        record.firstSeen,
        record.lastSeen,
        record.coverUrl ?? null,
        record.sourceTitle ?? null,
      ],
    );
  }

  async listBooks(): Promise<BookRecord[]> {
    await this.init();
    const { rows } = await this.pool.query<BookRow>(
      "select * from books order by last_seen desc limit 200",
    );
    return rows.map(asBook);
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
    //
    // coalesce — на случай глоссария без названия: название у книги обязано
    // быть непустым, и при пустом значении падает вся запись, даже когда
    // книга давно заведена и заготовка никому не нужна.
    await this.pool.query(
      `insert into books (key, host, slug, title, chapters_translated, first_seen, last_seen)
       values ($1, '', '', coalesce($2, ''), 0, now(), now())
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

  async readTranslation(
    owner: string,
    source: string,
    register: string,
    tier: string,
  ): Promise<TranslationRecord | null> {
    await this.init();
    // Чтение продлевает срок хранения: в политике сто восемьдесят дней
    // считаются со дня последнего открытия, а не со дня перевода.
    const { rows } = await this.pool.query<{
      reader: string; source: string; register: string; tier: string;
      book_key: string; title: string; words: number; body: string;
      model: string; rub: string; published: boolean; next_url: string | null;
      created_at: Date; last_read_at: Date;
    }>(
      `update translations set last_read_at = now()
       where reader = $1 and source = $2 and register = $3 and tier = $4
       returning *`,
      [owner, source, register, tier],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      owner: row.reader,
      source: row.source,
      bookKey: row.book_key,
      register: row.register,
      tier: row.tier,
      title: row.title,
      words: row.words,
      text: row.body,
      model: row.model,
      rub: Number(row.rub),
      published: row.published,
      nextUrl: row.next_url,
      createdAt: row.created_at.toISOString(),
      lastReadAt: row.last_read_at.toISOString(),
    };
  }

  async writeTranslation(record: TranslationRecord): Promise<void> {
    await this.init();
    await this.pool.query(
      `insert into translations
         (reader, source, register, tier, book_key, title, words, body,
          model, rub, published, next_url, created_at, last_read_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (reader, source, register, tier) do update set
         body = excluded.body,
         title = excluded.title,
         words = excluded.words,
         model = excluded.model,
         rub = excluded.rub,
         next_url = excluded.next_url,
         last_read_at = excluded.last_read_at`,
      [
        record.owner, record.source, record.register, record.tier,
        record.bookKey, record.title, record.words, record.text,
        record.model, record.rub, record.published, record.nextUrl,
        record.createdAt, record.lastReadAt,
      ],
    );
  }

  async listTranslations(
    owner: string,
    bookKey: string,
  ): Promise<Array<Omit<TranslationRecord, "text">>> {
    await this.init();
    const { rows } = await this.pool.query<ListedRow>(
      `${LIST_COLUMNS}
        where reader = $1 and book_key = $2
        order by last_read_at desc
        limit 500`,
      [owner, bookKey],
    );
    return rows.map(listed);
  }

  async recentTranslations(
    owner: string,
    limit: number,
  ): Promise<Array<Omit<TranslationRecord, "text">>> {
    await this.init();
    const { rows } = await this.pool.query<ListedRow>(
      `${LIST_COLUMNS}
        where reader = $1
        order by last_read_at desc
        limit $2`,
      [owner, Math.max(1, Math.min(200, Math.trunc(limit)))],
    );
    return rows.map(listed);
  }

  async termCounts(): Promise<Map<string, number>> {
    await this.init();
    // Считает база, а не мы: иначе на каждую книгу пришлось бы вытащить весь
    // её глоссарий целиком ради одного числа.
    const { rows } = await this.pool.query<{ book_key: string; n: string }>(
      `select book_key,
              case when jsonb_typeof(data->'terms') = 'array'
                   then jsonb_array_length(data->'terms')
                   else 0 end as n
         from glossaries`,
    );
    return new Map(rows.map((row) => [row.book_key, Number(row.n)]));
  }

  async enqueue(record: QueueRecord): Promise<boolean> {
    await this.init();
    const { rowCount } = await this.pool.query(
      `insert into queue (reader, source, register, tier, book_key, state, batch_id, note,
                          title, words, next_url, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (reader, source, register, tier) do nothing`,
      [
        record.owner, record.source, record.register, record.tier,
        record.bookKey, record.state, record.batchId, record.note,
        record.title, record.words, record.nextUrl,
        record.createdAt, record.updatedAt,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  async listQueue(
    owner: string,
    states: readonly QueueState[],
    limit: number,
  ): Promise<QueueRecord[]> {
    await this.init();
    const { rows } = await this.pool.query<QueueRow>(
      `select * from queue
        where reader = $1 and state = any($2)
        order by created_at
        limit $3`,
      [owner, [...states], Math.max(1, Math.min(500, Math.trunc(limit)))],
    );
    return rows.map(asQueue);
  }

  async markQueue(
    owner: string,
    source: string,
    register: string,
    tier: string,
    patch: {
      state: QueueState;
      batchId?: string | null;
      note?: string | null;
      title?: string;
      words?: number;
      nextUrl?: string | null;
    },
  ): Promise<void> {
    await this.init();
    // Признак «поле передали» отдельным параметром: не переданное остаётся как
    // было, а переданный null именно обнуляет. coalesce так не умеет.
    await this.pool.query(
      `update queue
          set state = $5,
              batch_id = case when $6::boolean then $7 else batch_id end,
              note = case when $8::boolean then $9 else note end,
              title = case when $10::boolean then $11 else title end,
              words = case when $12::boolean then $13 else words end,
              next_url = case when $14::boolean then $15 else next_url end,
              updated_at = now()
        where reader = $1 and source = $2 and register = $3 and tier = $4`,
      [
        owner, source, register, tier, patch.state,
        patch.batchId !== undefined, patch.batchId ?? null,
        patch.note !== undefined, patch.note ?? null,
        patch.title !== undefined, patch.title ?? "",
        patch.words !== undefined, patch.words ?? 0,
        patch.nextUrl !== undefined, patch.nextUrl ?? null,
      ],
    );
  }

  async countQueue(owner: string, bookKey: string): Promise<Map<QueueState, number>> {
    await this.init();
    const { rows } = await this.pool.query<{ state: string; n: string }>(
      `select state, count(*) as n
         from queue
        where reader = $1 and book_key = $2
        group by state`,
      [owner, bookKey],
    );
    return new Map(rows.map((row) => [row.state as QueueState, Number(row.n)]));
  }

  /** Убрать книгу вместе с её глоссарием. Нужно уборке после проверки базы. */
  async removeBook(key: string): Promise<void> {
    await this.init();
    await this.pool.query("delete from books where key = $1", [key]);
    await this.pool.query("delete from translations where book_key = $1", [key]);
    await this.pool.query("delete from queue where book_key = $1", [key]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Список глав без текста.
 *
 * Текст не выбираем намеренно: ни на карточке книги, ни на главной он не
 * нужен, а глава весит около пятнадцати килобайт — на сотне глав это лишние
 * полтора мегабайта через сеть на каждое открытие страницы.
 */
const LIST_COLUMNS = `select reader, source, register, tier, book_key, title, words,
              model, rub, published, next_url, created_at, last_read_at
         from translations`;

interface ListedRow {
  reader: string; source: string; register: string; tier: string;
  book_key: string; title: string; words: number;
  model: string; rub: string; published: boolean; next_url: string | null;
  created_at: Date; last_read_at: Date;
}

function listed(row: ListedRow): Omit<TranslationRecord, "text"> {
  return {
    owner: row.reader,
    source: row.source,
    bookKey: row.book_key,
    register: row.register,
    tier: row.tier,
    title: row.title,
    words: row.words,
    model: row.model,
    rub: Number(row.rub),
    published: row.published,
    nextUrl: row.next_url,
    createdAt: row.created_at.toISOString(),
    lastReadAt: row.last_read_at.toISOString(),
  };
}

interface BookRow {
  key: string;
  host: string;
  slug: string;
  title: string;
  chapters_translated: number;
  first_seen: Date;
  last_seen: Date;
  cover_url: string | null;
  source_title: string | null;
}

function asBook(row: BookRow): BookRecord {
  return {
    key: row.key,
    host: row.host,
    slug: row.slug,
    title: row.title,
    chaptersTranslated: row.chapters_translated,
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString(),
    coverUrl: row.cover_url,
    sourceTitle: row.source_title,
  };
}

interface QueueRow {
  reader: string;
  source: string;
  register: string;
  tier: string;
  book_key: string;
  state: string;
  batch_id: string | null;
  note: string | null;
  title: string;
  words: number;
  next_url: string | null;
  created_at: Date;
  updated_at: Date;
}

function asQueue(row: QueueRow): QueueRecord {
  return {
    owner: row.reader,
    source: row.source,
    register: row.register,
    tier: row.tier,
    bookKey: row.book_key,
    state: row.state as QueueState,
    batchId: row.batch_id,
    note: row.note,
    title: row.title,
    words: row.words,
    nextUrl: row.next_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
