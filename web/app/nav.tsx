import Link from "next/link";

/**
 * Верхняя полоса сайта.
 *
 * Одна на все страницы: с макета она одинакова и на главной, и в каталоге, и
 * в кабинете, а разъезжаются такие полосы быстрее всего остального.
 *
 * Счётчика квоты и кружка с лицом из макета здесь нет: учётных записей ещё
 * нет, квоты тоже, а нарисовать «44 из 60 глав» поверх пустоты — соврать в
 * первой же строке страницы. Появятся записи — появится и счётчик.
 */
export function Nav({ here }: { here?: "читать" | "книги" | "правила" }) {
  const link = (name: string, href: string, key: typeof here) => (
    <Link
      href={href}
      style={{ fontSize: 13.5, color: here === key ? "var(--ink)" : "var(--muted)" }}
    >
      {name}
    </Link>
  );

  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22,
        minHeight: 66,
        padding: "12px clamp(16px, 4vw, 40px)",
        borderBottom: "1px solid var(--line-soft)",
        flexWrap: "wrap",
      }}
    >
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--ink)" }}>
        <svg width="21" height="21" viewBox="0 0 26 26" fill="none" aria-hidden>
          <path d="M4 3.5h11.5L22 10v12.5H4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M15.5 3.5V10H22" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M8 14.5h9M8 18h6" stroke="var(--accent)" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
        <span className="display" style={{ fontSize: 17 }}>Толмач</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {link("Читать", "/", "читать")}
        {link("Мои книги", "/books", "книги")}
        {link("Правила", "/rules", "правила")}
      </div>
    </nav>
  );
}

/** Обложка-заглушка: настоящих обложек у нас нет и взять их неоткуда. */
export function Cover({ height, width }: { height: number; width?: number }) {
  return (
    <div
      style={{
        height,
        width,
        borderRadius: 8,
        background: "linear-gradient(150deg, #2e2721, #1e1a15)",
        border: "1px solid #332c25",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 26 26" fill="none" aria-hidden>
        <path d="M4 3.5h11.5L22 10v12.5H4z" stroke="#4d4437" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M8 14.5h9" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
