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

/**
 * Обложка книги.
 *
 * Настоящих обложек у нас нет и взять их неоткуда: они лежат на чужих сайтах,
 * и тянуть их к себе — отдельный разговор про права и про то, чей адрес
 * увидит браузер читателя. Поэтому обложку мы рисуем сами: буква названия
 * в той же гарнитуре, что и заголовки, на тёплом фоне.
 *
 * Фон у каждой книги свой — оттенок считается из ключа книги, поэтому он
 * всегда один и тот же для одной книги и разный для соседних. На полке из
 * восьми одинаковых прямоугольников не найти нужную; из восьми разных — можно,
 * даже не читая подписи.
 */
export function Cover({
  height,
  width,
  title,
  seed,
}: {
  height: number;
  width?: number;
  title?: string;
  seed?: string;
}) {
  const tone = hue(seed ?? title ?? "");
  // Подпись влезает только на большую обложку; на маленькой — одна буква.
  const roomy = height >= 120;

  return (
    <div
      aria-hidden
      style={{
        height,
        width,
        borderRadius: 8,
        background: `linear-gradient(150deg, hsl(${tone} 15% 17%), hsl(${tone} 13% 10%))`,
        border: "1px solid #332c25",
        display: "grid",
        alignContent: "center",
        justifyItems: "center",
        gap: 6,
        padding: roomy ? "0 12px" : 0,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <span
        className="display"
        style={{
          fontSize: Math.round(height * 0.34),
          lineHeight: 1,
          color: `hsl(${tone} 26% 58%)`,
        }}
      >
        {initial(title)}
      </span>
      {roomy && title && (
        <span
          style={{
            fontSize: 10.5,
            lineHeight: 1.3,
            textAlign: "center",
            color: `hsl(${tone} 14% 48%)`,
            // Длинное название обрезаем двумя строками, а не растягиваем
            // обложку: полка должна оставаться ровной.
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </span>
      )}
    </div>
  );
}

/** Первая буква названия — всё, что помещается на маленькой обложке. */
function initial(title?: string): string {
  const letter = (title ?? "").trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?";
  return letter.toUpperCase();
}

/**
 * Оттенок из ключа книги.
 *
 * Держимся тёплой части круга — от киновари к охре: это палитра холста, и
 * обложка не должна из неё выпадать. Разброс небольшой намеренно, полка не
 * должна выглядеть коробкой карандашей.
 */
function hue(seed: string): number {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) n = (n * 31 + seed.charCodeAt(i)) | 0;
  return 16 + (Math.abs(n) % 28);
}
