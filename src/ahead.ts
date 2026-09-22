/**
 * Перевод наперёд.
 *
 * Пока читатель читает главу, следующая уже переводится — и когда он нажмёт
 * «дальше», она откроется мгновенно и бесплатно.
 *
 * Делается это пакетным API: он вдвое дешевле обычного, но отвечает не сразу,
 * иногда через часы. Там, где человек ждёт главу прямо сейчас, такое не
 * годится — и там мы по-прежнему переводим потоком. А здесь ждать некому, и
 * половина себестоимости достаётся даром.
 *
 * Правила те же, что у обычного перевода, и нарушать их пакет не вправе:
 * платные главы не переводим, оригинал не храним, промпт ровно тот же — иначе
 * разойдётся слог и перестанет попадать кэш.
 */

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, isRegister, isTier, type Register, type Tier } from "./config.js";
import {
  chapterFromHtml,
  fetchPage,
  findNextLink,
  linkDensity,
  looksLocked,
} from "./extract.js";
import { EMPTY_GLOSSARY, type Glossary } from "./glossary.js";
import { mergeIntoGlossary, extractTerms } from "./terms.js";
import { readTranslation, translateRequest } from "./translate.js";
import { queueKey, type QueueRecord, type Store } from "./store.js";

/** Сколько глав собирать в один пакет за раз. */
const BATCH_SIZE = 20;

/** До какой главы книги пополняем глоссарий: дальше он уже устоялся. */
const GLOSSARY_CHAPTERS = 15;

/**
 * Имя запроса внутри пакета.
 *
 * Пакет возвращает ответы вперемешку и опознаёт их только по этому имени, а
 * длина и набор знаков в нём ограничены — адрес главы туда не положить.
 * Поэтому свёртка от ключа очереди: она короткая, считается одинаково при
 * отправке и при разборе, и совпасть у двух разных глав практически не может.
 * «Практически» здесь не отговорка: при отправке мы это проверяем.
 */
function customId(item: QueueRecord): string {
  const key = queueKey(item.owner, item.source, item.register, item.tier);
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/**
 * Поставить в очередь следующую главу.
 *
 * Ровно одну, а не десять вперёд. Читатель, открывший две главы, не заказывал
 * перевод всей книги, и переводить её впрок значило бы тратить его деньги на
 * то, чего он не просил. Цепочка продлевает себя сама: перевели следующую —
 * из неё узнали адрес той, что за ней, и поставили её.
 */
export async function queueNext(
  store: Store,
  from: { owner: string; bookKey: string; register: string; tier: string; nextUrl: string | null },
): Promise<boolean> {
  if (!from.nextUrl) return false;

  // Уже переведённую ставить незачем. Читаем список, а не саму главу:
  // чтение перевода продлевает срок хранения, а мы тут не читатель.
  const done = await store.listTranslations(from.owner, from.bookKey);
  const already = done.some(
    (t) => t.source === from.nextUrl && t.register === from.register && t.tier === from.tier,
  );
  if (already) return false;

  const stamp = new Date().toISOString();
  return store.enqueue({
    owner: from.owner,
    source: from.nextUrl,
    bookKey: from.bookKey,
    register: from.register,
    tier: from.tier,
    state: "ждёт",
    batchId: null,
    note: null,
    // Заголовок, длину и адрес следующей узнаем при отправке, когда скачаем
    // страницу. Сейчас у нас есть только адрес самой главы.
    title: "",
    words: 0,
    nextUrl: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
}

export interface SendReport {
  /** Сколько глав ушло в пакет. */
  sent: number;
  /** Сколько выбыло, не дойдя до пакета, и почему. */
  dropped: Array<{ source: string; why: string }>;
  batchId: string | null;
}

/**
 * Собрать ждущие главы в пакет и отправить.
 *
 * Страницы скачиваем здесь же: пакету нужен текст главы, а хранить его у себя
 * мы не будем и между заходами тоже. Всё, что не снялось, выбывает из очереди
 * с причиной — молча терять главы нельзя, иначе читатель будет ждать того,
 * чего никто не переводит.
 */
export async function sendBatch(
  store: Store,
  owner: string,
  client: Anthropic = new Anthropic(),
): Promise<SendReport> {
  /*
   * Между «взяли список» и «отметили отправленными» есть щель: два захода,
   * начавшиеся одновременно, могут взять одну главу и перевести её дважды.
   * Сейчас это стоит лишние 2.88 ₽ и ничем больше не грозит — вторая запись
   * ляжет поверх первой, текст у читателя будет верный.
   *
   * Закрывать щель по-настоящему (занимать строки в базе до работы) стоит
   * заметно дороже: заход, упавший между «занял» и «отправил», оставил бы
   * главы занятыми навсегда, и их пришлось бы освобождать по времени. На
   * одном читателе и одной главе в очереди лекарство вышло бы хуже болезни.
   * Когда читателей станет много — переделать на claim.
   */
  const waiting = await store.listQueue(owner, ["ждёт"], BATCH_SIZE);
  const dropped: SendReport["dropped"] = [];
  if (waiting.length === 0) return { sent: 0, dropped, batchId: null };

  const glossaries = new Map<string, Glossary>();
  const requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
  const ids = new Set<string>();

  for (const item of waiting) {
    const fail = async (why: string): Promise<void> => {
      dropped.push({ source: item.source, why });
      await store.markQueue(owner, item.source, item.register, item.tier, {
        state: "не вышло",
        note: why,
      });
    };

    if (!isRegister(item.register) || !isTier(item.tier)) {
      await fail("непонятный регистр или модель");
      continue;
    }

    let html: string;
    try {
      html = await fetchPage(item.source);
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error));
      continue;
    }

    // Платные главы не переводим — так записано в правилах, и пакет
    // не исключение.
    if (looksLocked(html)) {
      await fail("глава платная у первоисточника");
      continue;
    }

    const chapter = chapterFromHtml(html, item.source);
    if (linkDensity(html, item.source) > 0.5 || chapter.wordCount < 300) {
      await fail("на странице не глава, а оглавление или заглушка");
      continue;
    }

    if (!glossaries.has(item.bookKey)) {
      glossaries.set(item.bookKey, (await store.readGlossary(item.bookKey)) ?? EMPTY_GLOSSARY);
    }
    const glossary = glossaries.get(item.bookKey) as Glossary;

    /*
     * Глоссарий пополняется здесь, а не при разборе ответа, и иначе нельзя:
     * для разбора имён нужен английский оригинал, а он есть ровно сейчас —
     * страница открыта. К моменту ответа пакета её давно закрыли, и хранить
     * оригинал у себя мы не будем, так записано в правилах.
     *
     * Запрос отдельный и не пакетный: он идёт дешёвой моделью, стоит около
     * 0.4 ₽ и нужен до перевода, а не после, — иначе имена из этой главы
     * в неё же и не попадут.
     */
    const book = await store.readBook(item.bookKey);
    if ((book?.chaptersTranslated ?? 0) <= GLOSSARY_CHAPTERS) {
      try {
        const found = await extractTerms({ chapter, known: glossary, tier: "fast" });
        mergeIntoGlossary(glossary, found);
        glossary.novel = glossary.novel || chapter.title;
        await store.writeGlossary(item.bookKey, glossary);
      } catch {
        // Глоссарий — не глава: не собрался, переводим с тем, что есть.
      }
    }

    const id = customId(item);
    if (ids.has(id)) {
      // Две разные главы с одним именем внутри пакета — этого быть не может,
      // но если вдруг, то лучше отложить одну до следующего захода, чем
      // записать читателю чужой текст.
      await fail("совпало имя запроса в пакете — глава пойдёт следующим заходом");
      continue;
    }
    ids.add(id);

    await store.markQueue(owner, item.source, item.register, item.tier, {
      state: "ждёт",
      title: chapter.title,
      words: chapter.wordCount,
      nextUrl: findNextLink(html, item.source),
    });

    requests.push({
      custom_id: id,
      params: translateRequest({
        chapter,
        glossary,
        register: item.register as Register,
        tier: item.tier as Tier,
      }),
    });
  }

  if (requests.length === 0) return { sent: 0, dropped, batchId: null };

  const batch = await client.messages.batches.create({ requests });

  for (const item of waiting) {
    if (!requests.some((r) => r.custom_id === customId(item))) continue;
    await store.markQueue(owner, item.source, item.register, item.tier, {
      state: "отправлена",
      batchId: batch.id,
    });
  }

  return { sent: requests.length, dropped, batchId: batch.id };
}

export interface CollectReport {
  /** Пакеты, которые ещё считаются. */
  pending: number;
  ready: number;
  failed: number;
  rub: number;
}

/**
 * Забрать готовые пакеты и записать переводы.
 *
 * Пакет считается до суток. Пока он не кончился, трогать его нечем — просто
 * считаем и уходим; заход дешёвый, его можно делать хоть каждые десять минут.
 */
export async function collectBatch(
  store: Store,
  owner: string,
  client: Anthropic = new Anthropic(),
): Promise<CollectReport> {
  const sent = await store.listQueue(owner, ["отправлена"], 500);
  const report: CollectReport = { pending: 0, ready: 0, failed: 0, rub: 0 };
  if (sent.length === 0) return report;

  const byBatch = new Map<string, QueueRecord[]>();
  for (const item of sent) {
    if (!item.batchId) continue;
    byBatch.set(item.batchId, [...(byBatch.get(item.batchId) ?? []), item]);
  }

  for (const [batchId, items] of byBatch) {
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status !== "ended") {
      report.pending += 1;
      continue;
    }

    const mine = new Map(items.map((item) => [customId(item), item]));

    for await (const result of await client.messages.batches.results(batchId)) {
      const item = mine.get(result.custom_id);
      if (!item) continue;

      if (result.result.type !== "succeeded") {
        report.failed += 1;
        await store.markQueue(owner, item.source, item.register, item.tier, {
          state: "не вышло",
          note: `пакет вернул «${result.result.type}»`,
        });
        continue;
      }

      try {
        const tier = item.tier as Tier;
        const translated = readTranslation(result.result.message, tier);
        if (translated.refusal) {
          report.failed += 1;
          await store.markQueue(owner, item.source, item.register, item.tier, {
            state: "не вышло",
            note: "модель отказалась переводить эту главу",
          });
          continue;
        }

        await store.writeTranslation({
          owner,
          source: item.source,
          bookKey: item.bookKey,
          register: item.register,
          tier: item.tier,
          title: item.title,
          words: item.words,
          text: translated.text,
          model: translated.model,
          rub: translated.spend.rub,
          published: false,
          nextUrl: item.nextUrl,
          createdAt: new Date().toISOString(),
          lastReadAt: new Date().toISOString(),
        });

        const book = await store.readBook(item.bookKey);
        if (book) {
          book.chaptersTranslated += 1;
          book.lastSeen = new Date().toISOString();
          await store.writeBook(book);
        }

        // Цепочка продлевает себя: перевели эту — ставим ту, что за ней.
        await queueNext(store, {
          owner,
          bookKey: item.bookKey,
          register: item.register,
          tier: item.tier,
          nextUrl: item.nextUrl,
        });

        report.ready += 1;
        report.rub += translated.spend.rub;
        await store.markQueue(owner, item.source, item.register, item.tier, { state: "готова" });
      } catch (error) {
        report.failed += 1;
        await store.markQueue(owner, item.source, item.register, item.tier, {
          state: "не вышло",
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return report;
}

/** Заход целиком: забрать готовое, отправить накопившееся. */
export async function runAhead(
  store: Store,
  owner: string,
  client: Anthropic = new Anthropic(),
): Promise<{ collected: CollectReport; sent: SendReport }> {
  // Сначала забираем: освободившиеся главы могут добавить в очередь следующие.
  const collected = await collectBatch(store, owner, client);
  const sent = await sendBatch(store, owner, client);
  return { collected, sent };
}
