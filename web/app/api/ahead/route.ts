import { timingSafeEqual } from "node:crypto";
import { chooseStore, runAhead, SOLE_READER } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Заход скачивает до двадцати страниц и собирает глоссарии — это не секунды. */
export const maxDuration = 300;

/**
 * Заход перевода наперёд: забрать готовые пакеты, отправить накопившиеся главы.
 *
 * Дёргается по расписанию, а не человеком. Ручка тратит деньги, поэтому
 * закрыта ключом и закрыта наглухо: не задан ключ — не работает вовсе. Ошибиться
 * тут дороже, чем поднять руками одну настройку.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? process.env.TOLMACH_CRON_SECRET;
  if (!secret) {
    return json(
      { ошибка: "перевод наперёд не настроен: нет CRON_SECRET" },
      503,
    );
  }
  /*
   * Заголовки ходят по сети байтами из латиницы. Ключ с кириллицей приедет
   * искажённым и не совпадёт никогда — а выглядеть это будет как «всё
   * настроил, а оно молчит». Один раз на это уже попались при проверке,
   * поэтому говорим прямо, а не отвечаем «не тот ключ».
   */
  // eslint-disable-next-line no-control-regex
  if (/[^\x21-\x7e]/.test(secret)) {
    return json(
      { ошибка: "CRON_SECRET должен состоять из латиницы и цифр: заголовки не переносят кириллицу" },
      503,
    );
  }
  if (!allowed(request.headers.get("authorization"), secret)) {
    return json({ ошибка: "не тот ключ" }, 401);
  }

  try {
    const store = await chooseStore();
    const { collected, sent } = await runAhead(store, SOLE_READER);
    return json({
      забрано: collected.ready,
      неВышло: collected.failed,
      пакетовВРаботе: collected.pending,
      потрачено: Number(collected.rub.toFixed(2)),
      отправлено: sent.sent,
      выбыло: sent.dropped,
      пакет: sent.batchId,
    });
  } catch (error) {
    return json(
      { ошибка: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

/** Сравнение за постоянное время: по времени ответа ключ подбирать не дадим. */
function allowed(header: string | null, secret: string): boolean {
  const given = header?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
