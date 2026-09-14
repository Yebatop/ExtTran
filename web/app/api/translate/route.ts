import {
  EMPTY_GLOSSARY,
  chapterFromHtml,
  fetchPage,
  isRegister,
  looksLocked,
  translateChapter,
} from "@/lib/core";
import { checkSource } from "@/lib/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Глава переводится от минуты до двух — обычные тридцать секунд тут мало. */
export const maxDuration = 300;

/**
 * Перевод главы, отдаваемый потоком.
 *
 * Ответ — построчный JSON: по объекту на строку. Первый несёт заголовок и
 * длину, дальше идут куски текста по мере готовности, последний — сколько
 * это стоило. Так читатель видит первый абзац через несколько секунд, а не
 * пустой экран две минуты.
 */
type Frame =
  | { type: "meta"; title: string; words: number; method: string }
  | { type: "text"; chunk: string }
  | { type: "done"; rub: number; usd: number; model: string; seconds: number }
  | { type: "refusal"; category: string | null; explanation: string | null }
  | { type: "error"; message: string };

export async function POST(request: Request): Promise<Response> {
  let body: { src?: unknown; register?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Тело запроса не разобралось." }, { status: 400 });
  }

  const checked = checkSource(typeof body.src === "string" ? body.src : "");
  if (!checked.ok) {
    return Response.json({ error: checked.reason }, { status: 400 });
  }

  const register =
    typeof body.register === "string" && isRegister(body.register)
      ? body.register
      : "ровный";

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "На сервере не выставлен ключ ANTHROPIC_API_KEY — переводить нечем. " +
          "Это наша беда, а не ваша.",
      },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: Frame): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      };

      try {
        const html = await fetchPage(checked.url);

        // Платные главы не переводим — так записано в правилах, и это не
        // техническое ограничение, а обещание тем, кто их пишет.
        if (looksLocked(html)) {
          send({
            type: "error",
            message:
              "Похоже, это платная глава. Такие мы не переводим: они куплены " +
              "у автора или переводчика, и наше дело туда не лезть.",
          });
          controller.close();
          return;
        }

        const chapter = chapterFromHtml(html, checked.url);
        send({
          type: "meta",
          title: chapter.title,
          words: chapter.wordCount,
          method: chapter.method ?? "неизвестно",
        });

        // Глоссария пока неоткуда взять: он собирается по книге и живёт в
        // хранилище, которого ещё нет. Без него перевод ровно настолько же
        // машинный, как у всех остальных, — и это главное, что предстоит
        // исправить следующим шагом.
        const result = await translateChapter({
          chapter,
          glossary: EMPTY_GLOSSARY,
          register,
          tier: "fast",
          onText: (chunk) => send({ type: "text", chunk }),
        });

        if (result.refusal) {
          send({
            type: "refusal",
            category: result.refusal.category,
            explanation: result.refusal.explanation,
          });
        } else {
          send({
            type: "done",
            rub: result.spend.rub,
            usd: result.spend.usd,
            model: result.model,
            seconds: (Date.now() - started) / 1000,
          });
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Иначе прокси копит ответ целиком и весь смысл потока пропадает.
      "x-accel-buffering": "no",
    },
  });
}
