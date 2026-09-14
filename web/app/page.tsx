import Link from "next/link";

/**
 * Главная. Одно поле и одна кнопка: ссылка на главу — перевод.
 *
 * Форма обычная, методом GET, без единой строчки клиентского кода: она должна
 * работать и там, где скрипты не выполнились. Читают с телефона, в метро, на
 * плохой связи.
 */
export default function Home() {
  return (
    <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, padding: "clamp(24px, 6vw, 72px) 16px", maxWidth: 760, margin: "0 auto", width: "100%" }}>
        <header style={{ marginBottom: 48 }}>
          <div className="label" style={{ marginBottom: 14 }}>Перевод веб-новелл</div>
          <h1
            className="display"
            style={{ fontSize: "clamp(44px, 11vw, 76px)", margin: "0 0 18px", lineHeight: 1.02, letterSpacing: "-0.01em" }}
          >
            Толмач
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "#c8bfae", margin: 0, maxWidth: 520 }}>
            Английские веб-новеллы по-русски. Имена и обращения одинаковы во всех
            главах — потому что у книги есть глоссарий, а не только переводчик.
          </p>
        </header>

        <form
          action="/read"
          method="get"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            padding: "clamp(18px, 4vw, 28px)",
          }}
        >
          <label htmlFor="src" className="label" style={{ display: "block", marginBottom: 10 }}>
            Ссылка на главу
          </label>
          <input
            id="src"
            name="src"
            type="url"
            required
            placeholder="https://…/novel/…/chapter-1"
            autoComplete="off"
            spellCheck={false}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "#100e0b",
              color: "var(--ink)",
              fontSize: 16,
              marginBottom: 16,
            }}
          />

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label htmlFor="register" className="label" style={{ display: "block", marginBottom: 10 }}>
                Регистр
              </label>
              <select
                id="register"
                name="register"
                defaultValue="ровный"
                style={{
                  width: "100%",
                  padding: "13px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--line)",
                  background: "#100e0b",
                  color: "var(--ink)",
                  fontSize: 15,
                }}
              >
                <option value="живой">Живой — литРПГ, городское фэнтези</option>
                <option value="ровный">Ровный — подходит почти всему</option>
                <option value="возвышенный">Возвышенный — сянься и уся</option>
              </select>
            </div>
            <button
              type="submit"
              style={{
                flex: "0 0 auto",
                padding: "14px 28px",
                borderRadius: 10,
                border: "none",
                background: "var(--accent)",
                color: "#14120f",
                fontWeight: 600,
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              Перевести
            </button>
          </div>
        </form>

        <section style={{ marginTop: 56, display: "grid", gap: 28 }}>
          {[
            ["Глоссарий, а не догадки", "Имя, названное один раз, пишется так же и через триста глав. Машина без глоссария забывает его через абзац."],
            ["Кто кому «ты»", "В английском этого различия нет вовсе, и вывести его можно только из отношений. Мы выводим и держим."],
            ["Свой ридер", "Глава открывается у нас: тёмная тема, оригинал по нажатию, ничего не мигает и не просит установить приложение."],
          ].map(([title, body]) => (
            <div key={title}>
              <h2 style={{ fontSize: 17, margin: "0 0 6px", fontWeight: 600 }}>{title}</h2>
              <p style={{ margin: 0, color: "#9a917f", lineHeight: 1.6, fontSize: 15 }}>{body}</p>
            </div>
          ))}
        </section>
      </div>

      <footer
        style={{
          borderTop: "1px solid var(--line-soft)",
          padding: "22px 16px",
          textAlign: "center",
          color: "var(--dim)",
          fontSize: 13,
        }}
      >
        <Link href="/rules">Что мы делаем с чужим текстом</Link>
        <span style={{ margin: "0 10px", opacity: 0.4 }}>·</span>
        Пока работает только перевод главы по ссылке: ни каталога, ни кабинета,
        ни оплаты ещё нет.
      </footer>
    </main>
  );
}
