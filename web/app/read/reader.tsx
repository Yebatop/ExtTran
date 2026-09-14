"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { highlight, type HighlightTerm } from "@/lib/highlight";

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
  const [problem, setProblem] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [picked, setPicked] = useState<HighlightTerm | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Переход к следующей главе — это тот же компонент с другим src:
    // всё, что осталось от прошлой главы, надо убрать руками.
    setShowOriginal(false);
    setPicked(null);
  }, [src]);

  useEffect(() => {
    // В строгом режиме разработки эффект запускается дважды — перевод стоит
    // денег, так что второй запуск нам обойдётся ровно в цену главы.
    if (started.current) return;
    started.current = true;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ src, register, tier }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          setProblem(payload?.error ?? `Сервер ответил ${response.status}.`);
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
                setProblem(
                  "Модель отказалась переводить эту главу" +
                    (frame.category ? ` (${String(frame.category)})` : "") +
                    ". Это её решение, а не сбой.",
                );
                setState("failed");
                break;
              case "error":
                setProblem(String(frame.message));
                setState("failed");
                break;
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem(error instanceof Error ? error.message : String(error));
        setState("failed");
      }
    })();

    return () => controller.abort();
  }, [src, register, tier]);

  const shown = showOriginal ? meta?.original ?? "" : text;
  const paragraphs = shown.split(/\n{2,}/).filter((p) => p.trim() !== "");
  const terms = showOriginal ? [] : meta?.glossary ?? [];

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "clamp(20px, 5vw, 56px) 16px 96px" }}>
      <nav style={{ marginBottom: 36, display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13, alignItems: "center" }}>
        <Link href="/">← Другая глава</Link>
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
        <div
          style={{
            border: "1px solid #4a2a22",
            background: "#1d1410",
            borderRadius: 12,
            padding: 20,
            color: "#e0b6a6",
            lineHeight: 1.6,
            fontSize: 15,
          }}
        >
          {problem}
        </div>
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
              color: "#14120f",
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
