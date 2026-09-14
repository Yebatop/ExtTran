import {
  bookRef,
  chapterFromHtml,
  chooseStore,
  extractTerms,
  fetchPage,
  isRegister,
  isTier,
  looksLocked,
  mergeIntoGlossary,
  storageKey,
  translateChapter,
  type BookRecord,
  type Glossary,
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
/**
 * До каких пор собирать глоссарий.
 *
 * Замеры на живой книге показали: костяк набирается за десять-пятнадцать глав,
 * дальше новые имена появляются редко, а разбор главы стоит денег на каждой.
 * Поэтому собираем, пока книга молодая, и перестаём, когда собрали.
 */
const GLOSSARY_CHAPTERS = 15;

type Frame =
  | {
      type: "meta";
      title: string;
      words: number;
      method: string;
      book: string;
      bookKey: string;
      bookSlug: string;
      terms: number;
    }
  | { type: "text"; chunk: string }
  | {
      type: "done";
      rub: number;
      usd: number;
      model: string;
      seconds: number;
      /**
       * Готовый текст целиком.
       *
       * Поток идёт сырым, как его отдаёт модель, — иначе читателю пришлось бы
       * ждать конца главы. Но механическая правка (ряды точек, тире в начале
       * реплики) работает по всему тексту сразу и на куске потока сделать её
       * нельзя: многоточие может разорваться между кусками. Поэтому в конце
       * присылаем правленый текст целиком, и страница его подменяет.
       */
      text: string;
    }
  | { type: "glossary"; added: number; total: number; rub: number }
  | { type: "refusal"; category: string | null; explanation: string | null }
  | { type: "error"; message: string };

export async function POST(request: Request): Promise<Response> {
  let body: { src?: unknown; register?: unknown; tier?: unknown };
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

  // Дорогая модель наружу не выставляется: замер показал 14.58 ₽ за главу
  // против 4.76 ₽ выручки, то есть она убыточна при любом множителе, который
  // читатель согласится нажать. Выбор — между дешёвой и средней.
  const tier =
    typeof body.tier === "string" && isTier(body.tier) && body.tier !== "strong"
      ? body.tier
      : "fast";

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

        // Глоссарий у книги один на все главы: имя из первой главы должно
        // писаться так же и в трёхсотой. Ключ книги выводится из адреса.
        const ref = bookRef(checked.url);
        const store = chooseStore();
        const known: Glossary = (await store.readGlossary(ref.key)) ?? {
          novel: chapter.title || ref.slug,
          terms: [],
          addresses: [],
        };

        send({
          type: "meta",
          title: chapter.title,
          words: chapter.wordCount,
          method: chapter.method ?? "неизвестно",
          book: known.novel || ref.slug,
          bookKey: ref.key,
          bookSlug: storageKey(ref.key),
          terms: known.terms.length,
        });

        const result = await translateChapter({
          chapter,
          glossary: known,
          register,
          tier,
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
            text: result.text,
          });

          const book: BookRecord = (await store.readBook(ref.key)) ?? {
            key: ref.key,
            host: ref.host,
            slug: ref.slug,
            title: chapter.title || ref.slug,
            chaptersTranslated: 0,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          };
          book.chaptersTranslated += 1;
          book.lastSeen = new Date().toISOString();
          await store.writeBook(book);

          // Пополняем глоссарий уже после того, как читатель получил текст:
          // ему не за что ждать лишние секунды, а книге эти имена пригодятся
          // в следующей главе.
          if (book.chaptersTranslated <= GLOSSARY_CHAPTERS) {
            try {
              const found = await extractTerms({ chapter, known, tier: "fast" });
              const report = mergeIntoGlossary(known, found);
              known.novel = known.novel || chapter.title || ref.slug;
              await store.writeGlossary(ref.key, known);
              send({
                type: "glossary",
                added: report.added,
                total: known.terms.length,
                rub: found.spend.rub,
              });
            } catch {
              // Разбор не удался — перевод от этого не хуже, читателю знать
              // об этом незачем. Глоссарий доберём на следующей главе.
            }
          }
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
