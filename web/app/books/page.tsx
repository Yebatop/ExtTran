import Link from "next/link";
import { chooseStore, storageKey } from "@/lib/core";

export const dynamic = "force-dynamic";

/** Каталог: пока просто то, что через нас уже проходило. */
export default async function Books() {
  const books = await chooseStore().listBooks();

  return (
    <main style={{ maxWidth: 660, margin: "0 auto", padding: "clamp(28px, 7vw, 72px) 16px 96px" }}>
      <nav style={{ marginBottom: 36, fontSize: 13 }}>
        <Link href="/">← На главную</Link>
      </nav>

      <h1 className="display" style={{ fontSize: "clamp(28px, 6.5vw, 42px)", margin: "0 0 28px", lineHeight: 1.12 }}>
        Книги
      </h1>

      {books.length === 0 ? (
        <p style={{ color: "#c8bfae", lineHeight: 1.65 }}>
          Пока ни одной. Переведите главу с главной страницы — книга появится
          здесь вместе со своим глоссарием.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 20 }}>
          {books.map((b) => (
            <li key={b.key} style={{ paddingBottom: 18, borderBottom: "1px solid var(--line-soft)" }}>
              <Link
                href={`/book/${encodeURIComponent(storageKey(b.key))}`}
                style={{ fontSize: 18, fontWeight: 600 }}
              >
                {b.title}
              </Link>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                переведено глав: {b.chaptersTranslated} · {b.host}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
