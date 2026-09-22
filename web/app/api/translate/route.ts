import {
  bookRef,
  chapterFromHtml,
  chooseStore,
  coverFromHtml,
  extractTerms,
  fetchPage,
  findNextLink,
  isRegister,
  isTier,
  linkDensity,
  looksLocked,
  nextFromIndex,
  mergeIntoGlossary,
  storageKey,
  translateChapter,
  SOLE_READER,
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
      bookTitle: string;
      bookKey: string;
      bookSlug: string;
      terms: number;
      /** Ссылка на следующую главу, если нашлась на странице. */
      next: string | null;
      /** Оригинал целиком — чтобы «показать оригинал» работал без второго запроса. */
      original: string;
      /**
       * Термины книги для подсветки: только английская и русская стороны да
       * короткая помета. Остальное браузеру ни к чему.
       */
      glossary: Array<{ en: string; ru: string; note?: string }>;
    }
  | { type: "text"; chunk: string }
  | {
      type: "done";
      rub: number;
      usd: number;
      model: string;
      seconds: number;
      /** Перевод взят из хранилища — денег не потрачено, ключ не нужен. */
      cached: boolean;
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
  | {
      type: "error";
      /**
       * Какая это беда. По ней страница выбирает, что показать и что
       * предложить: у каждой из них в макете свой экран, свои кнопки и
       * своя строка про списание.
       */
      kind:
        | "не-открылась"
        | "не-глава"
        | "платная"
        | "оборвался"
        | "отказ"
        | "нет-ключа"
        | "прочее";
      message: string;
      /** Адрес книги — чтобы предложить выбрать главу из оглавления. */
      bookUrl?: string;
      /** Сколько абзацев успело прийти, если перевод оборвался. */
      paragraphs?: number;
    };

export async function POST(request: Request): Promise<Response> {
  let body: { src?: unknown; register?: unknown; tier?: unknown; force?: unknown };
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

  // Основа — средняя модель. Дешёвая выдавала выдуманные слова, непереведённый
  // английский и деепричастные обороты, в которых действие приписано не тому,
  // — на том самом тексте, за который берут деньги. Дорогая идёт по кнопке:
  // с урезанной квотой глава квоты стоит дороже, и тройной множитель её
  // наконец окупает.
  const tier =
    typeof body.tier === "string" && isTier(body.tier) ? body.tier : "middle";

  // «Всё равно перевести» с экрана «это не похоже на главу»: человек
  // посмотрел и решил, что мы ошиблись. Спорить не с чем — он видит страницу.
  const force = body.force === true;

  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: Frame): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      };

      try {
        // Ключ книги выводится из адреса, без единого запроса наружу.
        const ref = bookRef(checked.url);
        const store = await chooseStore();

        // Хранилище — раньше сети. Глава стоит около пяти рублей, и платить за
        // неё второй раз потому, что читатель перезагрузил страницу, не за что.
        // А раньше сети — чтобы сохранённая глава открывалась и тогда, когда
        // первоисточник лежит: он нам для неё больше не нужен.
        const saved = await store.readTranslation(
          SOLE_READER,
          checked.url,
          register,
          tier,
        );

        // Как книга называется сейчас — читатель мог её переименовать. Нужно
        // ридеру, чтобы вычистить имя книги из заголовка главы: на многих
        // сайтах в заголовке страницы стоит именно оно.
        const shelved = await store.readBook(ref.key);

        // Страница нужна для оригинала и свежей ссылки «дальше». Для готового
        // перевода это украшение, а не условие, поэтому неудачу здесь терпим.
        let html: string | null = null;
        try {
          html = await fetchPage(checked.url);
        } catch (error) {
          if (!saved) throw error;
        }

        // Платные главы не переводим — так записано в правилах, и это не
        // техническое ограничение, а обещание тем, кто их пишет.
        if (html && looksLocked(html)) {
          send({
            type: "error",
            kind: "платная",
            message:
              "Похоже, это платная глава. Такие мы не переводим: они куплены " +
              "у автора или переводчика, и наше дело туда не лезть.",
          });
          controller.close();
          return;
        }

        const chapter = html ? chapterFromHtml(html, checked.url) : null;

        // Глоссарий у книги один на все главы: имя из первой главы должно
        // писаться так же и в трёхсотой.
        const known: Glossary = (await store.readGlossary(ref.key)) ?? {
          novel: chapter?.title || saved?.title || ref.slug,
          terms: [],
          addresses: [],
        };

        // Свежая ссылка лучше сохранённой: книга могла прирасти главами.
        let nextUrl = html ? findNextLink(html, checked.url) : (saved?.nextUrl ?? null);

        // Ссылки «вперёд» на странице главы может не быть вовсе: навигацию
        // рисует скрипт или её просто не сделали. Тогда порядок глав записан
        // только на странице книги — идём туда. Неудача здесь некритична:
        // без кнопки читать можно, просто неудобно.
        if (!nextUrl && html) {
          try {
            const indexUrl = `https://${ref.key}`;
            nextUrl = nextFromIndex(await fetchPage(indexUrl), indexUrl, checked.url);
          } catch {
            nextUrl = null;
          }
        }

        send({
          type: "meta",
          title: chapter?.title ?? saved?.title ?? "",
          words: chapter?.wordCount ?? saved?.words ?? 0,
          method: chapter?.method ?? (saved ? "из хранилища" : "неизвестно"),
          book: known.novel || ref.slug,
          // Второе имя — то, под которым книга стоит на полке сейчас.
          bookTitle: shelved?.title ?? "",
          bookKey: ref.key,
          bookSlug: storageKey(ref.key),
          terms: known.terms.length,
          next: nextUrl,
          // Оригинал не храним — так записано в правилах. Если страница не
          // открылась, показывать по кнопке будет нечего, и это честнее, чем
          // держать английский текст у себя ради удобства.
          original: chapter?.text ?? "",
          glossary: known.terms.map((t) => ({
            en: t.en,
            ru: t.ru,
            ...(t.note ? { note: t.note } : {}),
          })),
        });

        if (saved) {
          send({ type: "text", chunk: saved.text });
          send({
            type: "done",
            rub: 0,
            usd: 0,
            model: saved.model,
            seconds: (Date.now() - started) / 1000,
            cached: true,
            text: saved.text,
          });
          controller.close();
          return;
        }

        // Оглавление, список новинок, страница комментариев — всё это
        // переведётся как текст и спишет деньги, а читателю не нужно.
        // Отличается оно долей ссылок: у главы это единицы процентов, у
        // списка — половина и больше.
        if (chapter && !force && !saved) {
          const density = html ? linkDensity(html, checked.url) : 0;
          if (density > 0.5 || chapter.wordCount < 300) {
            send({
              type: "error",
              kind: "не-глава",
              message:
                density > 0.5
                  ? "На странице больше ссылок, чем текста — похоже, это оглавление, " +
                    "а не глава."
                  : `Текста на странице всего ${chapter.wordCount} слов — для главы мало.`,
              bookUrl: `https://${ref.key}`,
            });
            controller.close();
            return;
          }
        }

        if (!chapter) {
          send({
            type: "error",
            kind: "не-открылась",
            message: "Страница не открылась, а перевода у нас ещё нет.",
            bookUrl: `https://${ref.key}`,
          });
          controller.close();
          return;
        }

        if (!process.env.ANTHROPIC_API_KEY) {
          send({
            type: "error",
            kind: "нет-ключа",
            message:
              "На сервере не выставлен ключ ANTHROPIC_API_KEY — переводить нечем. " +
              "Это наша беда, а не ваша.",
          });
          controller.close();
          return;
        }

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
            cached: false,
            text: result.text,
          });

          const stamp = new Date().toISOString();
          await store.writeTranslation({
            owner: SOLE_READER,
            source: checked.url,
            bookKey: ref.key,
            register,
            tier,
            title: chapter.title,
            words: chapter.wordCount,
            text: result.text,
            model: result.model,
            rub: result.spend.rub,
            // Галочка публикации из правил: выключена, включается руками.
            published: false,
            nextUrl,
            createdAt: stamp,
            lastReadAt: stamp,
          });

          const book: BookRecord = (await store.readBook(ref.key)) ?? {
            key: ref.key,
            host: ref.host,
            slug: ref.slug,
            title: chapter.title || ref.slug,
            sourceTitle: chapter.title || null,
            chaptersTranslated: 0,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          };
          book.chaptersTranslated += 1;
          book.lastSeen = new Date().toISOString();
          if (!book.coverUrl) book.coverUrl = await findCover(checked.url, ref.key);
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
        const message = error instanceof Error ? error.message : String(error);

        // Вид беды важен: у каждой в макете свой экран и свои кнопки. Обрыв
        // отличается от прочего тем, что его можно дописать, а не начинать
        // заново; недоступная страница — тем, что главу можно выбрать из
        // оглавления. Ядро для обоих случаев говорит узнаваемо.
        const kind = message.includes("упёрся в потолок")
          ? "оборвался"
          : message.startsWith("Страница не открылась") || message.startsWith("Сайт ответил")
            ? "не-открылась"
            : "прочее";

        send({
          type: "error",
          kind,
          message,
          ...(kind === "не-открылась" ? { bookUrl: `https://${bookRef(checked.url).key}` } : {}),
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

/**
 * Найти обложку книги на её странице.
 *
 * Ходим туда один раз — когда обложки у книги ещё нет. Лишний запрос к чужому
 * сайту на каждую главу того не стоит, а обложка меняется раз в никогда.
 *
 * Молча сдаёмся при любой беде: обложка — украшение, а не глава. Если не
 * вышло, на полке останется нарисованная нами.
 */
async function findCover(chapterUrl: string, bookKey: string): Promise<string | null> {
  try {
    const { protocol } = new URL(chapterUrl);
    const page = `${protocol}//${bookKey}`;
    const html = await fetchPage(page);
    return coverFromHtml(html, page);
  } catch {
    return null;
  }
}
