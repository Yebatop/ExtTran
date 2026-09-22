import Link from "next/link";
import { Nav } from "../../nav";
import { renameBook } from "./actions";
import { plural } from "../../words";
import { chapterName, chapterNumber, chooseStore, median, storageKey, SOLE_READER } from "@/lib/core";

export const dynamic = "force-dynamic";

/**
 * Карточка книги.
 *
 * Отсюда видно, что у нас по этой книге есть, и отсюда можно вернуться к
 * прочитанной главе. До сих пор вернуться было нельзя вовсе: адрес главы
 * живёт у первоисточника, и по каталогу до неё не дойти.
 *
 * Жанров и тегов из макета здесь нет намеренно: взять их неоткуда, а
 * придумывать на карточке чужой книги — врать читателю.
 */
export default async function Book({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await chooseStore();
  const book = (await store.listBooks()).find((b) => storageKey(b.key) === slug);

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

  const [glossary, chapters, queue] = await Promise.all([
    store.readGlossary(book.key),
    store.listTranslations(SOLE_READER, book.key),
    store.countQueue(SOLE_READER, book.key),
  ]);

  /*
   * Главы по номеру, а не по порядку перевода. Если человек начал читать со
   * сто шестнадцатой, она сто шестнадцатая, а не первая, — и в списке должна
   * стоять там же, где стояла бы у первоисточника.
   */
  chapters.sort((a, b) => {
    const left = chapterNumber(a.source);
    const right = chapterNumber(b.source);
    if (left !== null && right !== null) return left - right;
    if (left !== null) return -1;
    if (right !== null) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const words = median(chapters.map((c) => c.words).filter((w) => w > 0));
  const spent = chapters.reduce((sum, c) => sum + c.rub, 0);

  const cell = {
    border: "1px solid var(--line)",
    borderRadius: 12,
    padding: "16px 18px",
    background: "var(--bg-raised)",
  } as const;

  return (
    <>
      <Nav here="книги" />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(28px, 7vw, 72px) 16px 96px" }}>
      <nav style={{ marginBottom: 32, fontSize: 13, display: "flex", gap: 16 }}>
        <Link href="/books">← Каталог</Link>
        <a
          href={`https://${book.key}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--dim)" }}
        >
          Оригинал
        </a>
      </nav>

      <header style={{ marginBottom: 36 }}>
        <div className="label" style={{ marginBottom: 12 }}>{book.host}</div>
        <h1 className="display" style={{ fontSize: "clamp(30px, 7vw, 46px)", margin: "0 0 12px", lineHeight: 1.1 }}>
          {book.title}
        </h1>
        {/*
          Название взято из заголовка первой главы, и это догадка: на одних
          сайтах там имя книги, на других — имя главы, а на третьих и то и
          другое сразу. Догадку должно быть чем поправить.
        */}
        <details className="term-row" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <summary style={{ gridTemplateColumns: "minmax(0, 1fr)", fontSize: 13, color: "var(--dim)" }}>
            Название не то? Поправить
          </summary>
          <form action={renameBook} className="edit">
            <input type="hidden" name="slug" value={slug} />
            <label>
              Как называть эту книгу
              <input name="title" defaultValue={book.title} required />
            </label>
            <label>
              Обложка — адрес картинки у первоисточника
              <input
                name="cover"
                type="url"
                defaultValue={book.coverUrl ?? ""}
                placeholder="https://…/cover.jpg"
              />
            </label>
            <div className="buttons">
              <button type="submit">Сохранить</button>
            </div>
          </form>
        </details>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 40,
        }}
      >
        <div style={cell}>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{chapters.length}</div>
          <div className="label" style={{ marginTop: 4 }}>переведено глав</div>
        </div>
        <div style={cell}>
          <div style={{ fontSize: 26, fontWeight: 600 }}>
            {words > 0 ? Math.round(words).toLocaleString("ru") : "—"}
          </div>
          <div className="label" style={{ marginTop: 4 }}>слов в главе</div>
        </div>
        <div style={cell}>
          <div style={{ fontSize: 26, fontWeight: 600 }}>{glossary?.terms.length ?? 0}</div>
          <div className="label" style={{ marginTop: 4 }}>терминов</div>
        </div>
      </div>

      {(queue.get("ждёт") ?? 0) + (queue.get("отправлена") ?? 0) > 0 && (
        <p
          style={{
            margin: "0 0 32px",
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "var(--bg-raised)",
            color: "var(--dim)",
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          Переводится наперёд:{" "}
          {(queue.get("ждёт") ?? 0) + (queue.get("отправлена") ?? 0)}{" "}
          {plural((queue.get("ждёт") ?? 0) + (queue.get("отправлена") ?? 0), "глава", "главы", "глав")}.
          Это идёт пакетом — вдвое дешевле обычного перевода, но не мгновенно.
          Готовая глава открывается сразу и бесплатно.
          {(queue.get("не вышло") ?? 0) > 0 && (
            <>
              {" "}
              Не вышло: {queue.get("не вышло")}. Обычно это платная глава или
              страница, которая не открылась.
            </>
          )}
        </p>
      )}

      <section style={{ marginBottom: 40 }}>
        <Link
          href={`/book/${encodeURIComponent(slug)}/glossary`}
          style={{ fontSize: 17, fontWeight: 600 }}
        >
          Глоссарий книги →
        </Link>
        <p style={{ margin: "6px 0 0", color: "var(--dim)", fontSize: 14, lineHeight: 1.6 }}>
          Открыт для всех: справочник имён наш, и мы его отдаём. Текст перевода —
          нет, так записано в <Link href="/rules">правилах</Link>.
        </p>
      </section>

      <section>
        <h2 className="label" style={{ marginBottom: 14 }}>
          Переведённые главы — {chapters.length}
        </h2>
        {chapters.length === 0 ? (
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.6 }}>
            Пока ни одной. Вставьте ссылку на главу на главной странице.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
            {chapters.map((c) => (
              <li
                key={`${c.source}|${c.register}|${c.tier}`}
                style={{ padding: "12px 0", borderBottom: "1px solid var(--line-soft)" }}
              >
                <Link
                  href={`/read?src=${encodeURIComponent(c.source)}&register=${encodeURIComponent(c.register)}&tier=${encodeURIComponent(c.tier)}`}
                  style={{ fontSize: 16 }}
                >
                  {chapterName(c.source, c.title, book.title, book.sourceTitle)}
                </Link>
                <div style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 4 }}>
                  {c.words.toLocaleString("ru")} слов · регистр {c.register} ·{" "}
                  открыть заново — бесплатно
                </div>
              </li>
            ))}
          </ul>
        )}
        {chapters.length > 0 && (
          <p style={{ marginTop: 18, color: "var(--dim)", fontSize: 13 }}>
            Перевод этих глав стоил {spent.toFixed(2)} ₽. Перечитывание — ноль.
          </p>
        )}
      </section>
      </main>
    </>
  );
}
