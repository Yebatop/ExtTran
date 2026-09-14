"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { highlight, type HighlightTerm } from "@/lib/highlight";
import ProblemScreen, { type Problem } from "./problem";

interface Meta {
  title: string;
  words: number;
  method: string;
  book: string;
  bookKey: string;
  bookSlug: string;
  terms: number;
  next: string | null;
  original: string;
  glossary: HighlightTerm[];
}

interface Done {
  rub: number;
  usd: number;
  model: string;
  seconds: number;
  text: string;
  cached: boolean;
}

interface GlossaryNews {
  added: number;
  total: number;
  rub: number;
}

type State = "loading" | "translating" | "done" | "failed";

/** Три темы с холста ReaderThemes. */
const THEMES = ["ночная", "сепия", "дневная"] as const;
type Theme = (typeof THEMES)[number];

/** Как тема выглядит в переключателе: квадратик цвета страницы. */
const SWATCH: Record<Theme, string> = {
  ночная: "#14120f",
  сепия: "#f0e4cf",
  дневная: "#f8f6f1",
};

const THEME_KEY = "толмач-тема";

function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/**
 * Ридер.
 *
 * Перевод приходит потоком и показывается по мере прихода — глава переводится
 * от минуты до двух, и пустой экран всё это время читатель не простит. Пока
 * текст идёт, под ним мигает курсор: видно, что работа не встала.
 */
export default function Reader({
  src,
  register,
  tier,
}: {
  src: string;
  register: string;
  tier: string;
}) {
  const [state, setState] = useState<State>("loading");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [text, setText] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [glossary, setGlossary] = useState<GlossaryNews | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [force, setForce] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [picked, setPicked] = useState<HighlightTerm | null>(null);
  const [theme, setTheme] = useState<Theme>("ночная");
  const [read, setRead] = useState(0);
  const started = useRef("");
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    // Переход к следующей главе — это тот же компонент с другим src:
    // всё, что осталось от прошлой главы, надо убрать руками.
    setShowOriginal(false);
    setPicked(null);
  }, [src]);

  /**
   * Тема: своя, если выбрана, иначе та, что стоит в системе.
   *
   * Читаем уже после первой отрисовки, а не при ней: на сервере ни хранилища,
   * ни системной настройки нет, и выбранная там тема разошлась бы с
   * отрисованной здесь. Поэтому первый кадр всегда ночной.
   */
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      // Приватное окно или закрытые данные сайта — возьмём системную.
    }
    if (saved && isTheme(saved)) {
      setTheme(saved);
      return;
    }
    if (window.matchMedia("(prefers-color-scheme: light)").matches) setTheme("дневная");
  }, []);

  /** Сколько главы позади. Считаем по окну: важно то, что видно глазами. */
  useEffect(() => {
    const measure = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      setRead(height > 40 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [text, showOriginal]);

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Не сохранилось — тема всё равно сменится, просто до конца сеанса.
    }
  };

  useEffect(() => {
    /*
     * Сторож от второго запроса той же главы. В строгом режиме разработки
     * эффект запускается дважды, а перевод стоит денег — второй запуск
     * обошёлся бы ровно в цену главы.
     *
     * Сторож считает по самому запросу, а не по счётчику попыток. Раньше он
     * смотрел только на попытку — и переход к следующей главе, то есть тот же
     * компонент с другим адресом при той же попытке, принимался за повтор:
     * кнопка нажималась, адрес в строке менялся, а на экране оставалась
     * прежняя глава. Проверено на собранном сайте: со старым сторожем адрес
     * становится вторым, а заголовок и текст остаются от первой главы.
     */
    const key = [src, register, tier, attempt, force].join("\u0000");
    if (started.current === key) return;
    started.current = key;
    setProblem(null);
    setText("");
    setDone(null);
    setState("loading");

    // Прошлый запрос отменяем здесь, а не в уборке эффекта: уборка в строгом
    // режиме случается сразу после первого запуска и убивала запрос, который
    // сторож потом не пускал повторить, — экран навсегда оставался
    // на «открываем страницу».
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    void (async () => {
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ src, register, tier, force }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          setProblem({
            kind: "прочее",
            message: payload?.error ?? `Сервер ответил ${response.status}.`,
          });
          setState("failed");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          buffer += decoder.decode(value, { stream: true });

          // Кусок может прийти оборванным на середине строки — последнюю
          // недописанную оставляем в буфере до следующего чтения.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim() === "") continue;
            const frame = JSON.parse(line) as Record<string, unknown>;
            switch (frame.type) {
              case "meta":
                setMeta(frame as unknown as Meta);
                setState("translating");
                break;
              case "text":
                setText((prev) => prev + (frame.chunk as string));
                break;
              case "done": {
                const finished = frame as unknown as Done;
                setDone(finished);
                // Поток шёл сырым; правленый текст приходит в конце целиком.
                if (finished.text) setText(finished.text);
                setState("done");
                break;
              }
              case "glossary":
                setGlossary(frame as unknown as GlossaryNews);
                break;
              case "refusal":
                setProblem({
                  kind: "отказ",
                  message:
                    "Это её решение, а не сбой" +
                    (frame.category ? `: ${String(frame.category)}` : "") +
                    ". Такие главы будут, и это не поломка сайта.",
                });
                setState("failed");
                break;
              case "error":
                setProblem(frame as unknown as Problem);
                setState("failed");
                break;
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem({
          kind: "прочее",
          message: error instanceof Error ? error.message : String(error),
        });
        setState("failed");
      }
    })();
  }, [src, register, tier, attempt, force]);

  const shown = showOriginal ? meta?.original ?? "" : text;
  const paragraphs = shown.split(/\n{2,}/).filter((p) => p.trim() !== "");
  const terms = showOriginal ? [] : meta?.glossary ?? [];

  return (
    <div
      data-reader-theme={theme}
      style={{ background: "var(--bg)", color: "var(--ink)", minHeight: "100dvh" }}
    >
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "clamp(20px, 5vw, 56px) 16px 96px" }}>
      <nav style={{ marginBottom: 36, display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/">← Другая глава</Link>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Themes value={theme} onPick={chooseTheme} />
        {meta && (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            style={{
              border: "1px solid var(--line)",
              background: showOriginal ? "var(--bg-raised)" : "transparent",
              color: showOriginal ? "var(--ink)" : "var(--dim)",
              borderRadius: 8,
              padding: "7px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {showOriginal ? "Показать перевод" : "Показать оригинал"}
          </button>
        )}
        </div>
      </nav>

      {meta && (
        <header style={{ marginBottom: 40 }}>
          <h1 className="display" style={{ fontSize: "clamp(28px, 6vw, 40px)", margin: "0 0 10px", lineHeight: 1.14 }}>
            {meta.title || "Глава без заголовка"}
          </h1>
          <div className="label">
            {meta.words.toLocaleString("ru")} слов в оригинале · регистр {register}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            {meta.terms > 0 ? (
              <>
                Глоссарий книги:{" "}
                <Link href={`/book/${encodeURIComponent(meta.bookSlug)}`}>
                  {meta.terms}{" "}
                  {meta.terms % 10 === 1 && meta.terms % 100 !== 11 ? "термин" : "терминов"}
                </Link>{" "}
                — имена и обращения из прошлых глав соблюдаются в этой.
              </>
            ) : (
              "Это первая глава книги у нас: глоссарий начнёт собираться с неё."
            )}
          </div>
        </header>
      )}

      {state === "loading" && <Waiting note="Открываем страницу и снимаем текст…" />}

      {state === "translating" && paragraphs.length === 0 && (
        <Waiting note="Этой главы у нас ещё нет — переводим. Первые абзацы появятся через несколько секунд." />
      )}

      {paragraphs.length > 0 && (
        <article className={showOriginal ? "reading original" : "reading"}>
          {paragraphs.map((p, i) => (
            <p key={i}>
              {terms.length === 0
                ? p
                : highlight(p, terms).map((seg, j) =>
                    seg.term ? (
                      <span
                        key={j}
                        className="term"
                        role="button"
                        tabIndex={0}
                        onClick={() => setPicked(seg.term ?? null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setPicked(seg.term ?? null);
                        }}
                      >
                        {seg.text}
                      </span>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
            </p>
          ))}
        </article>
      )}

      {state === "translating" && paragraphs.length > 0 && <Cursor />}

      {problem && (
        <ProblemScreen
          problem={problem}
          src={src}
          register={register}
          tier={tier}
          onRetry={() => setAttempt((n) => n + 1)}
          onForce={() => {
            setForce(true);
            setAttempt((n) => n + 1);
          }}
        />
      )}

      {state === "done" && meta?.next && (
        <nav style={{ marginTop: 44, display: "flex", justifyContent: "center" }}>
          <Link
            href={`/read?src=${encodeURIComponent(meta.next)}&register=${encodeURIComponent(register)}&tier=${encodeURIComponent(tier)}`}
            style={{
              display: "inline-block",
              padding: "14px 30px",
              borderRadius: 10,
              background: "var(--accent)",
              color: "var(--on-accent)",
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            Следующая глава →
          </Link>
        </nav>
      )}

      {state === "done" && meta && !meta.next && (
        <p style={{ marginTop: 40, textAlign: "center", color: "var(--dim)", fontSize: 14 }}>
          Ссылки на следующую главу на этой странице нет — видимо, книга кончилась
          или сайт устроен иначе.
        </p>
      )}

      {picked && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            background: "var(--bg-raised)",
            borderTop: "1px solid var(--line)",
            padding: "16px 18px calc(16px + env(safe-area-inset-bottom))",
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>
              <strong style={{ fontWeight: 600 }}>{picked.ru}</strong>
              <span style={{ color: "var(--muted)" }}> · {picked.en}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.5 }}>
              {picked.note ?? "Из глоссария книги — пишется так во всех главах."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPicked(null)}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
      )}

      {done && (
        <footer
          style={{
            marginTop: 48,
            paddingTop: 20,
            borderTop: "1px solid var(--line-soft)",
            color: "var(--dim)",
            fontSize: 13,
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <span>{done.seconds.toFixed(0)} с</span>
          <span>
            {done.cached
              ? "из хранилища — заново не переводили"
              : `${done.rub.toFixed(2)} ₽ себестоимости`}
          </span>
          <span>{done.model}</span>
          {glossary && (
            <span style={{ color: "var(--muted)" }}>
              {glossary.added > 0
                ? `+${glossary.added} в глоссарий, стало ${glossary.total}`
                : `глоссарий без изменений, ${glossary.total}`}
            </span>
          )}
        </footer>
      )}
      </main>

      {paragraphs.length > 0 && !picked && (
        <div className="progress">
          <span className="bar">
            <span style={{ width: `${Math.round(read * 100)}%` }} />
          </span>
          <span className="pct">{Math.round(read * 100)}%</span>
        </div>
      )}
    </div>
  );
}

/**
 * Переключатель тем: три квадратика цвета страницы.
 *
 * Подписей нет намеренно — цвет говорит сам, а места в шапке ридера нет.
 * Название остаётся в подсказке и для читалок с экрана.
 */
function Themes({ value, onPick }: { value: Theme; onPick: (theme: Theme) => void }) {
  return (
    <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Тема ридера">
      {THEMES.map((name) => (
        <button
          key={name}
          type="button"
          title={name}
          aria-label={`Тема: ${name}`}
          aria-pressed={value === name}
          onClick={() => onPick(name)}
          style={{
            width: 22,
            height: 22,
            padding: 0,
            borderRadius: 6,
            cursor: "pointer",
            background: SWATCH[name],
            border: value === name ? "2px solid var(--accent)" : "1px solid var(--line)",
          }}
        />
      ))}
    </div>
  );
}

function Waiting({ note }: { note: string }) {
  return (
    <div style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.6, display: "flex", gap: 10, alignItems: "baseline" }}>
      <Cursor />
      <span>{note}</span>
    </div>
  );
}

function Cursor() {
  return (
    <>
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 9,
          height: 18,
          background: "var(--accent)",
          verticalAlign: "text-bottom",
          animation: "tolmach-blink 1.1s steps(2, start) infinite",
        }}
      />
      <style>{"@keyframes tolmach-blink { to { visibility: hidden } }"}</style>
    </>
  );
}
