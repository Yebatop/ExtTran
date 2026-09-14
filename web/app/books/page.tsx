import Link from "next/link";
import { Cover, Nav } from "../nav";
import { chooseStore, storageKey, type BookRecord } from "@/lib/core";

export const dynamic = "force-dynamic";

type Sort = "recent" | "terms" | "chapters";

interface Query {
  q?: string;
  host?: string;
  glossary?: string;
  sort?: string;
}

/**
 * Каталог — экран CatalogueList с холста, ровно в той мере, в какой у нас
 * есть о чём рассказать.
 *
 * Жанров, тегов, автора, английского названия, числа глав у первоисточника и
 * состояния («выходит», «завершена») здесь нет: взять их неоткуда. Это не
 * недоделка холста, а отсутствие источника — придумывать их на карточке чужой
 * книги значит врать читателю, а списывать с чужого сайта мы не будем.
 *
 * Что осталось от макета и работает: поиск по названию, фильтры слева
 * с числами, сортировка. Фильтры сделаны ссылками, а не кнопками: страница
 * должна работать там, где скрипты не выполнились.
 */
export default async function Books({ searchParams }: { searchParams: Promise<Query> }) {
  const params = await searchParams;
  const store = await chooseStore();
  const [all, terms] = await Promise.all([store.listBooks(), store.termCounts()]);

  const needle = (params.q ?? "").trim().toLowerCase();
  const onlyGlossary = params.glossary === "1";
  const sort: Sort =
    params.sort === "terms" ? "terms" : params.sort === "chapters" ? "chapters" : "recent";

  const matches = (b: BookRecord) =>
    (!needle || b.title.toLowerCase().includes(needle) || b.host.toLowerCase().includes(needle)) &&
    (!params.host || b.host === params.host) &&
    (!onlyGlossary || (terms.get(b.key) ?? 0) > 0);

  const books = all.filter(matches).sort((a, b) => {
    if (sort === "terms") return (terms.get(b.key) ?? 0) - (terms.get(a.key) ?? 0);
    if (sort === "chapters") return b.chaptersTranslated - a.chaptersTranslated;
    return b.lastSeen.localeCompare(a.lastSeen);
  });

  /** Адрес этой же страницы с изменённым набором ключей. */
  const href = (patch: Query): string => {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value) next[key] = String(value);
    }
    const query = new URLSearchParams(next).toString();
    return query ? `/books?${query}` : "/books";
  };

  /** Сколько книг осталось бы, поменяй мы один ключ. Число рядом с фильтром. */
  const countIf = (patch: Query): number => {
    const test = { ...params, ...patch };
    return all.filter(
      (b) =>
        (!test.host || b.host === test.host) &&
        (test.glossary !== "1" || (terms.get(b.key) ?? 0) > 0) &&
        (!needle ||
          b.title.toLowerCase().includes(needle) ||
          b.host.toLowerCase().includes(needle)),
    ).length;
  };

  const hosts = [...new Set(all.map((b) => b.host))].sort();

  return (
    <>
      <Nav here="книги" />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(22px, 5vw, 30px) clamp(16px, 4vw, 40px) 60px" }}>
        <header style={{ marginBottom: 22 }}>
          <h1 className="display" style={{ fontSize: "clamp(26px, 6vw, 34px)", margin: "0 0 8px", lineHeight: 1.18 }}>
            Каталог
          </h1>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)", margin: 0, maxWidth: 560 }}>
            Пока это то, что через нас уже проходило. Сами книги живут на своих
            сайтах — мы держим глоссарий и перевод.
          </p>
        </header>

        <div className="catalogue">
          <aside style={{ display: "grid", gap: 24 }}>
            {hosts.length > 1 && (
              <Group title="Сайт">
                <Filter href={href({ host: undefined })} on={!params.host} name="Все" n={countIf({ host: undefined })} />
                {hosts.map((h) => (
                  <Filter
                    key={h}
                    href={href({ host: h })}
                    on={params.host === h}
                    name={h}
                    n={countIf({ host: h })}
                  />
                ))}
              </Group>
            )}

            <Group title="Глоссарий">
              <Filter
                href={href({ glossary: onlyGlossary ? undefined : "1" })}
                on={onlyGlossary}
                name="Только с готовым"
                n={countIf({ glossary: "1" })}
              />
            </Group>

            <Group title="Сначала">
              <Filter href={href({ sort: undefined })} on={sort === "recent"} name="Недавние" />
              <Filter href={href({ sort: "terms" })} on={sort === "terms"} name="По глоссарию" />
              <Filter href={href({ sort: "chapters" })} on={sort === "chapters"} name="По числу глав" />
            </Group>
          </aside>

          <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <form action="/books" method="get" style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              {params.host && <input type="hidden" name="host" value={params.host} />}
              {onlyGlossary && <input type="hidden" name="glossary" value="1" />}
              {params.sort && <input type="hidden" name="sort" value={params.sort} />}
              <input
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Название книги или сайт"
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  height: 46,
                  padding: "0 15px",
                  borderRadius: 11,
                  border: "1px solid var(--line)",
                  background: "#1c1813",
                  color: "var(--ink)",
                  fontSize: 14.5,
                }}
              />
              <button
                type="submit"
                style={{
                  height: 46,
                  padding: "0 18px",
                  borderRadius: 11,
                  border: "1px solid var(--line)",
                  background: "transparent",
                  color: "var(--ink-read)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Найти
              </button>
            </form>

            {books.length === 0 ? (
              <p style={{ color: "#c8bfae", lineHeight: 1.65, margin: "6px 0 0" }}>
                {all.length === 0
                  ? "Пока ни одной книги. Переведите главу с главной — книга появится здесь вместе со своим глоссарием."
                  : "Под эти условия ничего не подошло."}
                {all.length > 0 && (
                  <>
                    {" "}
                    <Link href="/books">Показать все {all.length}</Link>
                  </>
                )}
              </p>
            ) : (
              books.map((b) => (
                <Link key={b.key} className="row" href={`/book/${encodeURIComponent(storageKey(b.key))}`}>
                  <Cover height={94} width={68} />
                  <span style={{ display: "grid", gap: 7, flexGrow: 1, minWidth: 0, alignContent: "start" }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{b.title}</span>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                      {b.host} · переведено {b.chaptersTranslated}
                    </span>
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 12.5, color: "#e08160", fontWeight: 500 }}>
                    {termWord(terms.get(b.key) ?? 0)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 9 }}>
      <span className="label">{title}</span>
      <div style={{ display: "grid", gap: 1 }}>{children}</div>
    </div>
  );
}

function Filter({ href, on, name, n }: { href: string; on: boolean; name: string; n?: number }) {
  return (
    <Link className={on ? "fbtn on" : "fbtn"} href={href}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {n !== undefined && <span className="n">{n}</span>}
    </Link>
  );
}

/** «142 термина» — числительное по-русски, а не «142 терминов». */
function termWord(count: number): string {
  if (count === 0) return "глоссария нет";
  const last2 = count % 100;
  const last1 = count % 10;
  const word =
    last2 >= 11 && last2 <= 14
      ? "терминов"
      : last1 === 1
        ? "термин"
        : last1 >= 2 && last1 <= 4
          ? "термина"
          : "терминов";
  return `${count} ${word}`;
}
