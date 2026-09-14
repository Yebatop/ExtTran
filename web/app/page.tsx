import Link from "next/link";
import { Cover, Nav } from "./nav";
import { chapters as chapterWords } from "./words";
import { chooseStore, storageKey, storageMode, SOLE_READER } from "@/lib/core";

/**
 * Пока страница статическая, браузер держит её HTML между развёртываниями —
 * и человек видит вчерашнюю форму. Выглядит это не как устаревание, а как
 * поломка: на телефоне так пропало поле выбора модели, добавленное часом
 * раньше, и два перевода подряд ушли не на ту модель.
 *
 * Мы правим сайт по несколько раз в час, и на этом этапе «что вижу — то и
 * развёрнуто» стоит дороже сэкономленных миллисекунд. Перед запуском, когда
 * страница перестанет меняться каждый час, это надо вернуть обратно.
 */
export const dynamic = "force-dynamic";

/** Сколько книг показывать на главной, прежде чем отправить в каталог. */
const SHELF = 7;

/**
 * Главная — «Что читаем?» с холста.
 *
 * Поле для ссылки осталось сверху, но страница больше не только из него:
 * ниже то, что человек уже читал. Без этого к прочитанной главе нельзя было
 * вернуться иначе как через каталог, а первый экран у вернувшегося читателя
 * выглядел так же пусто, как у пришедшего впервые.
 *
 * Форма обычная, методом GET, без единой строчки клиентского кода: она должна
 * работать и там, где скрипты не выполнились. Читают с телефона, в метро, на
 * плохой связи.
 */
export default async function Home() {
  const store = await chooseStore();
  const [books, recent] = await Promise.all([
    store.listBooks(),
    store.recentTranslations(SOLE_READER, 1),
  ]);
  const last = recent[0] ?? null;
  const lastBook = last ? books.find((b) => b.key === last.bookKey) ?? null : null;

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Nav here="читать" />

      <main style={{ flex: 1, padding: "clamp(28px, 6vw, 58px) 16px 0", width: "100%" }}>
        <div style={{ maxWidth: 940, margin: "0 auto" }}>
          <h1
            className="display"
            style={{
              fontSize: "clamp(32px, 7vw, 44px)",
              margin: "0 0 26px",
              lineHeight: 1.16,
              textAlign: "center",
            }}
          >
            Что читаем?
          </h1>

          <form
            action="/read"
            method="get"
            style={{ maxWidth: 700, margin: "0 auto 46px" }}
          >
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                id="src"
                name="src"
                type="url"
                required
                placeholder="Ссылка на главу"
                autoComplete="off"
                spellCheck={false}
                style={{
                  flex: "1 1 320px",
                  minWidth: 0,
                  height: 56,
                  padding: "0 17px",
                  borderRadius: 13,
                  border: "1px solid var(--line)",
                  background: "#1c1813",
                  color: "var(--ink)",
                  fontSize: 15.5,
                }}
              />
              <button
                type="submit"
                style={{
                  flex: "0 0 auto",
                  height: 56,
                  padding: "0 26px",
                  borderRadius: 13,
                  border: "none",
                  background: "var(--accent)",
                  color: "#17130f",
                  fontSize: 15.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Перевести
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <Choice name="register" label="Регистр" value="ровный">
                <option value="живой">Живой — литРПГ, городское фэнтези</option>
                <option value="ровный">Ровный — подходит почти всему</option>
                <option value="возвышенный">Возвышенный — сянься и уся</option>
              </Choice>
              <Choice name="tier" label="Перевод" value="middle">
                <option value="middle">Обычный</option>
                <option value="strong">Получше — три главы квоты</option>
              </Choice>
            </div>

            <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--dim)", textAlign: "center" }}>
              Глава открывается целиком. Ни входа, ни оплаты пока нет — как и
              бесплатных первых абзацев из макета.
            </p>
          </form>

          {last && (
            <section style={{ marginBottom: 34 }}>
              <div className="label" style={{ marginBottom: 12 }}>Продолжить</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  padding: 18,
                  borderRadius: 14,
                  background: "#201b15",
                  border: "1px solid #4a3527",
                  flexWrap: "wrap",
                }}
              >
                <Cover height={74} width={54} title={lastBook?.title} seed={last.bookKey} />
                <div style={{ flex: "1 1 240px", minWidth: 0, display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {lastBook ? (
                      <Link href={`/book/${encodeURIComponent(storageKey(lastBook.key))}`} style={{ color: "var(--ink)" }}>
                        {lastBook.title}
                      </Link>
                    ) : (
                      last.bookKey
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    {last.title || "Глава без заголовка"} · {when(last.lastReadAt)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link href={readHref(last.source, last)} style={ghost}>
                    Открыть заново
                  </Link>
                  {last.nextUrl && (
                    <Link href={readHref(last.nextUrl, last)} style={solid}>
                      Следующая глава
                    </Link>
                  )}
                </div>
              </div>
            </section>
          )}

          {books.length > 0 ? (
            <section style={{ paddingBottom: 40 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <span className="label">Ваши книги</span>
                <Link href="/books" style={{ fontSize: 13, color: "var(--muted)" }}>
                  Все {books.length}
                </Link>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 16,
                }}
              >
                {books.slice(0, SHELF).map((b) => (
                  <Link
                    key={b.key}
                    href={`/book/${encodeURIComponent(storageKey(b.key))}`}
                    style={{ display: "grid", gap: 10, color: "var(--ink-read)" }}
                  >
                    <Cover height={152} title={b.title} seed={b.key} />
                    <span style={{ fontSize: 13.5, lineHeight: 1.35 }}>{b.title}</span>
                    <span style={{ fontSize: 11.5, color: "var(--dim)", marginTop: -4 }}>
                      {`переведено: ${chapterWords(b.chaptersTranslated)}`}
                    </span>
                  </Link>
                ))}
                <a
                  href="#src"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    height: 152,
                    borderRadius: 8,
                    border: "1.5px dashed #3a3129",
                    color: "var(--dim)",
                    fontSize: 13,
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  Добавить книгу
                </a>
              </div>
            </section>
          ) : (
            <section style={{ margin: "0 auto 40px", maxWidth: 700, display: "grid", gap: 28 }}>
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
          )}
        </div>
      </main>

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
        Пока работает перевод главы по ссылке и глоссарий книги: ни кабинета,
        ни оплаты ещё нет.
        <div style={{ marginTop: 10, opacity: 0.55, fontSize: 12 }}>
          сборка {build()} · хранение: {storageMode()}
          {storageMode() === "память" && " (переводы не сохраняются — база не подключена)"}
        </div>
      </footer>
    </div>
  );
}

const solid = {
  display: "inline-flex",
  alignItems: "center",
  height: 42,
  padding: "0 20px",
  borderRadius: 10,
  background: "var(--accent)",
  color: "#17130f",
  fontSize: 14,
  fontWeight: 600,
} as const;

const ghost = {
  display: "inline-flex",
  alignItems: "center",
  height: 42,
  padding: "0 18px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  color: "var(--ink-read)",
  fontSize: 14,
} as const;

/** Выпадающий список с подписью — их на форме два и они одинаковые. */
function Choice({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ flex: "1 1 220px" }}>
      <label htmlFor={name} className="label" style={{ display: "block", marginBottom: 8 }}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={value}
        style={{
          width: "100%",
          padding: "13px 14px",
          borderRadius: 10,
          border: "1px solid var(--line)",
          background: "#1c1813",
          color: "var(--ink)",
          fontSize: 15,
        }}
      >
        {children}
      </select>
    </div>
  );
}

/** Ссылка в ридер: регистр и модель берём те же, какими читали в прошлый раз. */
function readHref(src: string, like: { register: string; tier: string }): string {
  const q = new URLSearchParams({ src, register: like.register, tier: like.tier });
  return `/read?${q.toString()}`;
}

/**
 * Когда это было — словами.
 *
 * Точная дата и время на карточке «продолжить» не нужны никому: важно только,
 * вчера это было или в прошлом месяце.
 */
function when(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "только что";
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} ${days < 5 ? "дня" : "дней"} назад`;
  if (days < 31) return `${Math.floor(days / 7)} нед. назад`;
  return `${Math.floor(days / 31)} мес. назад`;
}

/**
 * Какая сборка сейчас открыта.
 *
 * Полдня ушло на вопрос «а это вообще свежая страница или кэш» — браузер
 * отдавал вчерашний HTML, и по виду страницы отличить было нельзя. Семь
 * символов в подвале отвечают на это с одного взгляда.
 */
function build(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : "локальная";
}
