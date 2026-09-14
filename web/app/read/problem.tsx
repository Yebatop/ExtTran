"use client";

import Link from "next/link";

export interface Problem {
  kind:
    | "не-открылась"
    | "не-глава"
    | "платная"
    | "оборвался"
    | "отказ"
    | "нет-ключа"
    | "прочее";
  message: string;
  bookUrl?: string;
  paragraphs?: number;
}

/**
 * Экран «что-то пошло не так».
 *
 * В макете у каждой беды свой заголовок, свои кнопки и — главное — строка
 * про списание. Это не украшение: читатель, у которого оборвался перевод,
 * первым делом думает, не забрали ли у него главу из квоты. Пока квоты нет,
 * говорим то же самое про деньги.
 *
 * Серая плашка с техническим текстом, которая была раньше, ни на один из этих
 * вопросов не отвечала.
 */
export default function ProblemScreen({
  problem,
  src,
  register,
  tier,
  onRetry,
  onForce,
}: {
  problem: Problem;
  src: string;
  register: string;
  tier: string;
  onRetry: () => void;
  onForce: () => void;
}) {
  const titles: Record<Problem["kind"], string> = {
    "не-открылась": "Сайт не отдал нам эту страницу",
    "не-глава": "Это не похоже на главу",
    платная: "Это платная глава",
    оборвался: "Перевод оборвался на середине",
    отказ: "Модель отказалась переводить эту главу",
    "нет-ключа": "Переводить нечем",
    прочее: "Что-то пошло не так",
  };

  // Пока нет квоты — говорим про деньги. Вопрос у читателя один и тот же:
  // взяли с меня за это или нет.
  const charged =
    problem.kind === "оборвался"
      ? "Денег не потратили — спишем, когда глава дойдёт до конца."
      : "Денег не потратили.";

  const button = {
    padding: "12px 20px",
    borderRadius: 10,
    fontSize: 15,
    cursor: "pointer",
    border: "1px solid var(--line)",
    background: "transparent",
    color: "var(--ink)",
  } as const;

  const primary = { ...button, background: "var(--accent)", color: "#14120f", border: "none", fontWeight: 600 };

  return (
    <section
      style={{
        border: "1px solid #4a2a22",
        background: "#1d1410",
        borderRadius: 14,
        padding: "clamp(20px, 5vw, 28px)",
      }}
    >
      <h2 className="display" style={{ fontSize: 24, margin: "0 0 10px", lineHeight: 1.2 }}>
        {titles[problem.kind]}
      </h2>
      <p style={{ margin: "0 0 20px", color: "#e0b6a6", lineHeight: 1.6, fontSize: 15 }}>
        {problem.message}
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {problem.kind === "не-глава" && (
          <button type="button" onClick={onForce} style={primary}>
            Всё равно перевести
          </button>
        )}
        {(problem.kind === "оборвался" || problem.kind === "прочее") && (
          <button type="button" onClick={onRetry} style={primary}>
            Попробовать заново
          </button>
        )}
        {problem.bookUrl && (
          <a href={problem.bookUrl} target="_blank" rel="noopener noreferrer" style={button}>
            Открыть оглавление
          </a>
        )}
        <Link href="/" style={button}>
          Другая глава
        </Link>
      </div>

      <p style={{ margin: 0, color: "var(--dim)", fontSize: 13 }}>{charged}</p>

      {problem.kind === "платная" && (
        <p style={{ margin: "12px 0 0", color: "var(--dim)", fontSize: 13, lineHeight: 1.6 }}>
          Так записано в наших{" "}
          <Link href="/rules">правилах</Link>: платные главы куплены у автора или
          переводчика, и наше дело туда не лезть.
        </p>
      )}
    </section>
  );
}
