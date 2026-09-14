import Link from "next/link";
import { Nav } from "../../../nav";
import { chooseStore, storageKey, type Glossary, type Term } from "@/lib/core";

export const dynamic = "force-dynamic";

/**
 * Глоссарий книги.
 *
 * По нашим же правилам это единственное, что мы отдаём поиску: справочник имён
 * наш, а текст перевода — нет. Поэтому страница открытая и человеческая, а не
 * служебная выгрузка JSON.
 */
export default async function Book({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await chooseStore();
  const books = await store.listBooks();
  const book = books.find((b) => storageKey(b.key) === slug);
  const glossary: Glossary | null = book ? await store.readGlossary(book.key) : null;

  if (!book || !glossary || glossary.terms.length === 0) {
    return (
      <>
        <Nav here="книги" />
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "clamp(40px, 12vw, 120px) 16px" }}>
        <h1 className="display" style={{ fontSize: 30, margin: "0 0 14px" }}>
          Глоссария этой книги у нас нет
        </h1>
        <p style={{ color: "#c8bfae", lineHeight: 1.65, margin: "0 0 12px" }}>
          Он собирается сам, пока переводятся первые главы. Переведите одну — и
          страница наполнится.
        </p>
        <p style={{ color: "var(--dim)", lineHeight: 1.6, margin: "0 0 28px", fontSize: 14 }}>
          Если главы уже переводились, а здесь пусто — значит, хранилище не
          настроено и глоссарий живёт только до перезапуска. Это ожидаемо: базы
          у нас пока нет.
        </p>
        <Link href="/">← На главную</Link>
        </main>
      </>
    );
  }

  const byKind = new Map<string, Term[]>();
  for (const term of glossary.terms) {
    const list = byKind.get(term.kind) ?? [];
    list.push(term);
    byKind.set(term.kind, list);
  }
  const kinds = [...byKind].sort((a, b) => b[1].length - a[1].length);

  return (
    <>
      <Nav here="книги" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(28px, 7vw, 72px) 16px 96px" }}>
      <nav style={{ marginBottom: 36, fontSize: 13, display: "flex", gap: 16 }}>
        <Link href={`/book/${encodeURIComponent(slug)}`}>← К книге</Link>
        <Link href="/books" style={{ color: "var(--dim)" }}>Все книги</Link>
      </nav>

      <header style={{ marginBottom: 44 }}>
        <div className="label" style={{ marginBottom: 12 }}>Глоссарий</div>
        <h1 className="display" style={{ fontSize: "clamp(28px, 6.5vw, 42px)", margin: "0 0 12px", lineHeight: 1.12 }}>
          {book.title}
        </h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          {glossary.terms.length} терминов, {glossary.addresses.length} пар обращений ·{" "}
          переведено глав: {book.chaptersTranslated} · {book.host}
        </p>
      </header>

      <div style={{ display: "grid", gap: 40 }}>
        {kinds.map(([kind, terms]) => (
          <section key={kind}>
            <h2 className="label" style={{ marginBottom: 14 }}>
              {kind} — {terms.length}
            </h2>
            <dl style={{ margin: 0, display: "grid", gap: 10 }}>
              {[...terms]
                .sort((a, b) => a.en.localeCompare(b.en, "en"))
                .map((t) => (
                  <div
                    key={t.en}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
                      gap: 14,
                      paddingBottom: 10,
                      borderBottom: "1px solid var(--line-soft)",
                    }}
                  >
                    <dt style={{ color: "var(--muted)", fontSize: 15 }}>{t.en}</dt>
                    <dd style={{ margin: 0, fontSize: 15 }}>
                      {t.ru}
                      {t.note && (
                        <span style={{ color: "var(--dim)", fontSize: 13 }}> — {t.note}</span>
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}

        {glossary.addresses.length > 0 && (
          <section>
            <h2 className="label" style={{ marginBottom: 14 }}>Кто кому «ты»</h2>
            <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.6, margin: "0 0 14px" }}>
              В английском этого различия нет. Вывести его можно только из
              отношений — и держать одинаково во всех главах.
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {glossary.addresses.map((a) => (
                <li
                  key={`${a.from}|${a.to}`}
                  style={{ fontSize: 15, paddingBottom: 8, borderBottom: "1px solid var(--line-soft)" }}
                >
                  {a.from} → {a.to}:{" "}
                  <strong style={{ color: "var(--accent)", fontWeight: 600 }}>{a.form}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      </main>
    </>
  );
}
