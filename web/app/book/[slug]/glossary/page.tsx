import Link from "next/link";
import { Nav } from "../../../nav";
import { addTerm, removeTerm, saveTerm } from "../actions";
import { plural, terms as termWords } from "../../../words";
import { chooseStore, storageKey, type Glossary, type Term, type TermKind } from "@/lib/core";

export const dynamic = "force-dynamic";

const KINDS: readonly TermKind[] = [
  "имя", "обращение", "техника", "место", "организация", "предмет", "прочее",
];

/**
 * Глоссарий книги.
 *
 * По нашим же правилам это единственное, что мы отдаём поиску: справочник имён
 * наш, а текст перевода — нет. Поэтому страница открытая и человеческая, а не
 * служебная выгрузка JSON.
 *
 * Строки правятся прямо здесь. Машина ошибается: путает род, заносит в
 * глоссарий обычное слово, пропускает имя, названное один раз. До сих пор
 * поправить это было нельзя вовсе — глоссарий держит всю книгу, и одна
 * неверная строка тянулась через триста глав.
 *
 * Правка раскрывается нажатием на строку и работает без единой строчки
 * клиентского кода: обычная форма, обычная отправка. Пока страница свёрнута,
 * она остаётся тем же справочником, что и была.
 */
export default async function Book({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await chooseStore();
  const books = await store.listBooks();
  const book = books.find((b) => storageKey(b.key) === slug);
  const glossary: Glossary | null = book ? await store.readGlossary(book.key) : null;

  if (!book) {
    return (
      <>
        <Nav here="книги" />
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "clamp(40px, 12vw, 120px) 16px" }}>
          <h1 className="display" style={{ fontSize: 30, margin: "0 0 14px" }}>
            Такой книги у нас нет
          </h1>
          <p style={{ color: "#c8bfae", lineHeight: 1.65, margin: "0 0 28px" }}>
            Переведите из неё главу — книга появится здесь вместе с глоссарием.
          </p>
          <Link href="/">← На главную</Link>
        </main>
      </>
    );
  }

  const terms = glossary?.terms ?? [];
  const addresses = glossary?.addresses ?? [];

  const byKind = new Map<string, Term[]>();
  for (const term of terms) {
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

        <header style={{ marginBottom: 32 }}>
          <div className="label" style={{ marginBottom: 12 }}>Глоссарий</div>
          <h1 className="display" style={{ fontSize: "clamp(28px, 6.5vw, 42px)", margin: "0 0 12px", lineHeight: 1.12 }}>
            {book.title}
          </h1>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            {termWords(terms.length)}, {addresses.length}{" "}
            {plural(addresses.length, "пара", "пары", "пар")}{" "}
            {plural(addresses.length, "обращения", "обращений", "обращений")} ·{" "}
            переведено глав: {book.chaptersTranslated} · {book.host}
          </p>
        </header>

        <p
          style={{
            margin: "0 0 36px",
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "var(--bg-raised)",
            color: "var(--dim)",
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          Нажмите на строку, чтобы поправить написание. Исправленное считается
          проверенным и держится во всех следующих главах. Уже переведённые
          главы не меняются: их текст сохранён, и переписывать его задним
          числом мы не станем.
        </p>

        {terms.length === 0 ? (
          <p style={{ color: "#c8bfae", lineHeight: 1.65, margin: "0 0 36px" }}>
            Глоссарий пуст. Он собирается сам, пока переводятся первые главы, —
            или начните его сами, внизу страницы.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 40 }}>
            {kinds.map(([kind, list]) => (
              <section key={kind}>
                <h2 className="label" style={{ marginBottom: 14 }}>
                  {kind} — {list.length}
                </h2>
                <div style={{ display: "grid", gap: 10 }}>
                  {[...list]
                    .sort((a, b) => a.en.localeCompare(b.en, "en"))
                    .map((t) => (
                      <details key={t.en} className="term-row">
                        <summary>
                          <span style={{ color: "var(--muted)" }}>
                            {t.en}
                            {t.source === "вручную" && (
                              <span title="проверено человеком" style={{ color: "var(--accent)" }}> ✓</span>
                            )}
                          </span>
                          <span>
                            {t.ru}
                            {t.note && (
                              <span style={{ color: "var(--dim)", fontSize: 13 }}> — {t.note}</span>
                            )}
                          </span>
                        </summary>

                        <form action={saveTerm} className="edit">
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="en" value={t.en} />
                          <label>
                            По-русски
                            <input name="ru" defaultValue={t.ru} required />
                          </label>
                          <div className="pair">
                            <label>
                              Помета — род, кто кому кем приходится
                              <input name="note" defaultValue={t.note ?? ""} />
                            </label>
                            <label>
                              Что это
                              <select name="kind" defaultValue={t.kind}>
                                {KINDS.map((k) => (
                                  <option key={k} value={k}>{k}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="buttons">
                            <button type="submit">Сохранить</button>
                            <button type="submit" formAction={removeTerm} className="quiet">
                              Убрать из глоссария
                            </button>
                          </div>
                        </form>
                      </details>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <section style={{ marginTop: 40 }}>
          <details className="term-row">
            <summary>
              <span style={{ color: "var(--accent)" }}>+ Добавить термин</span>
              <span style={{ color: "var(--dim)", fontSize: 13 }}>
                имя, названное один раз, машина могла пропустить
              </span>
            </summary>
            <form action={addTerm} className="edit">
              <input type="hidden" name="slug" value={slug} />
              <div className="pair">
                <label>
                  Как в оригинале
                  <input name="en" required placeholder="Ashen Blade" />
                </label>
                <label>
                  По-русски
                  <input name="ru" required placeholder="Пепельный Клинок" />
                </label>
              </div>
              <div className="pair">
                <label>
                  Помета
                  <input name="note" placeholder="меч наставника, мужской род" />
                </label>
                <label>
                  Что это
                  <select name="kind" defaultValue="имя">
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="buttons">
                <button type="submit">Добавить</button>
              </div>
            </form>
          </details>
        </section>

        {addresses.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 className="label" style={{ marginBottom: 14 }}>Кто кому «ты»</h2>
            <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.6, margin: "0 0 14px" }}>
              В английском этого различия нет. Вывести его можно только из
              отношений — и держать одинаково во всех главах.
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {addresses.map((a) => (
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
      </main>
    </>
  );
}
