/**
 * Проверка стороннего шлюза.
 *
 *   npm run проверка-шлюза
 *   npm run проверка-шлюза -- --модель strong
 *
 * Шлюз, притворяющийся Anthropic, — это не «то же самое, только дешевле».
 * Совпадает у них обычно один запрос из простых, а мы держимся на четырёх
 * вещах сразу: поток, кэш префикса, строгий формат ответа и уровень усилий.
 * Кэш здесь не мелочь: глоссарий уходит в каждый запрос неизменным блоком
 * и оплачивается по десятой доле цены. Шлюз без кэша дороже прямого доступа,
 * даже когда его прайс вдвое ниже.
 *
 * Ключ берётся из окружения, адрес — из ANTHROPIC_BASE_URL. Ни то, ни другое
 * не печатается: в выводе только имя хоста.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODELS, isTier, type Tier } from "./config.js";
import { priceUsage, type Spend } from "./cost.js";
import { parseArgv } from "./args.js";

const USAGE = `Проверка стороннего шлюза Anthropic.

  npm run проверка-шлюза                 проверить средней моделью
  npm run проверка-шлюза -- --модель strong

Смотрит, что шлюз умеет на самом деле: кто отвечает, работает ли кэш
префикса, идёт ли поток, принимается ли строгий формат ответа.

Тратит несколько рублей: без настоящих запросов это не проверить.
`;

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  process.stdout.write(`  ${ok ? "✓" : "✗"} ${name}\n`);
  if (detail) process.stdout.write(`      ${detail}\n`);
  if (!ok) failed += 1;
}

/**
 * Длинный неизменный префикс — иначе кэш не включится.
 *
 * Минимальная длина у моделей разная и не по возрастанию: у Haiku она
 * вчетверо больше, чем у Sonnet. Берём с запасом от той, что проверяем.
 */
function filler(tokens: number): string {
  const paragraph =
    "Переписчик считал строки, а не слова, и оттого знал книгу наизусть " +
    "прежде, чем понимал её. Сначала приходит рука, потом смысл — так " +
    "говорили в скриптории, и так оно обычно и было. ";
  // Для русского текста примерно два с половиной знака на токен.
  const need = Math.ceil((tokens * 1.6 * 2.5) / paragraph.length);
  return paragraph.repeat(Math.max(1, need));
}

const Extraction = z.object({
  имена: z.array(z.object({ англ: z.string(), рус: z.string() })),
});

async function main(): Promise<void> {
  const args = parseArgv(process.argv.slice(2), ["help", "помощь"]);
  if (args.bare.has("help") || args.bare.has("помощь")) {
    process.stdout.write(USAGE);
    return;
  }

  const wanted = args.flags.get("модель") ?? "middle";
  if (!isTier(wanted)) {
    process.stderr.write(`Неизвестная модель: ${wanted}. Бывают fast, middle, strong.\n`);
    process.exitCode = 1;
    return;
  }
  const tier: Tier = wanted;
  const model = MODELS[tier];

  const base = process.env.ANTHROPIC_BASE_URL;
  const where = base ? new URL(base).host : "api.anthropic.com (напрямую)";
  process.stdout.write(`\nШлюз: ${where}\nЗаказываем: ${model.id}\n\n`);

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    process.stderr.write("Ключа нет. Положите его в .env как ANTHROPIC_API_KEY.\n");
    process.exitCode = 1;
    return;
  }

  const client = new Anthropic();
  const spent: Spend[] = [];
  const prefix = filler(model.minCacheTokens);

  // 1. Отвечает ли вообще и кто именно.
  const first = await client.messages.create({
    model: model.id,
    max_tokens: 64,
    system: [{ type: "text", text: prefix, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "Ответь одним словом: готов." }],
  });
  spent.push(priceUsage(first.usage, model));
  check("шлюз отвечает", first.content.length > 0);
  check(
    "отвечает та модель, которую заказывали",
    first.model === model.id,
    first.model === model.id ? "" : `заказывали ${model.id}, ответила ${first.model}`,
  );
  check(
    "кэш префикса записался",
    (first.usage.cache_creation_input_tokens ?? 0) > 0,
    (first.usage.cache_creation_input_tokens ?? 0) > 0
      ? ""
      : "шлюз не записал кэш — глоссарий будет оплачиваться полностью в каждой главе",
  );

  // 2. Тот же префикс второй раз: кэш должен прочитаться.
  const second = await client.messages.create({
    model: model.id,
    max_tokens: 64,
    system: [{ type: "text", text: prefix, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "Ответь одним словом: снова." }],
  });
  spent.push(priceUsage(second.usage, model));
  const read = second.usage.cache_read_input_tokens ?? 0;
  check(
    "кэш префикса читается",
    read > 0,
    read > 0
      ? `прочитано ${read.toLocaleString("ru")} токенов по десятой доле цены`
      : "второй запрос с тем же началом оплачен как первый — на главе это лишние рубли",
  );

  // 3. Поток: важно, чтобы первые слова приходили сразу, а не в конце.
  const started = Date.now();
  let firstChunkAt = 0;
  let chunks = 0;
  const stream = client.messages.stream({
    model: model.id,
    max_tokens: 300,
    messages: [{ role: "user", content: "Перечисли по порядку числа от одного до двадцати словами." }],
  });
  stream.on("text", () => {
    chunks += 1;
    if (firstChunkAt === 0) firstChunkAt = Date.now();
  });
  const finished = await stream.finalMessage();
  spent.push(priceUsage(finished.usage, model));
  const whole = Date.now() - started;
  const untilFirst = firstChunkAt === 0 ? whole : firstChunkAt - started;
  check(
    "текст идёт потоком, а не одним куском в конце",
    chunks > 3 && untilFirst < whole * 0.7,
    `кусков ${chunks}, первый через ${untilFirst} мс из ${whole} мс`,
  );

  // 4. Строгий формат ответа — на нём держится сбор глоссария.
  try {
    const parsed = await client.messages.parse({
      model: model.id,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content:
            "В тексте «Ashen Blade met Nine Flights» два названия. " +
            "Верни их с русским написанием.",
        },
      ],
      output_config: { format: zodOutputFormat(Extraction) },
    });
    spent.push(priceUsage(parsed.usage, model));
    check("строгий формат ответа принимается", (parsed.parsed_output?.имена.length ?? 0) > 0);
  } catch (error) {
    check(
      "строгий формат ответа принимается",
      false,
      `${error instanceof Error ? error.message : String(error)} — без этого не собрать глоссарий`,
    );
  }

  // 5. Уровень усилий — только там, где модель его понимает.
  if (model.supportsEffort) {
    try {
      const effort = await client.messages.create({
        model: model.id,
        max_tokens: 64,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "Сколько будет семью восемь? Только число." }],
      });
      spent.push(priceUsage(effort.usage, model));
      check("уровень усилий принимается", effort.content.length > 0);
    } catch (error) {
      check(
        "уровень усилий принимается",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const rub = spent.reduce((sum, s) => sum + s.rub, 0);
  process.stdout.write(
    `\nПотрачено на проверку: ${rub.toFixed(2)} ₽ по нашему прайсу.\n` +
      "Сверьте с тем, что списал сам шлюз: если цифры разойдутся, его цена\n" +
      "не та, что в объявлении.\n",
  );

  process.stdout.write(
    failed === 0
      ? "\nШлюз умеет всё, на чём мы держимся.\n"
      : `\nПровалилось проверок: ${failed}. Переводить через такой шлюз нельзя\n` +
          "без правок в коде, а на непринятом кэше он выйдет дороже прямого доступа.\n",
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\nДо шлюза не достучались: ${error instanceof Error ? error.message : String(error)}\n\n` +
      "Частые причины: ANTHROPIC_BASE_URL с опечаткой, ключ не от этого шлюза,\n" +
      "или шлюз ждёт ключ в другом заголовке.\n",
  );
  process.exitCode = 1;
});
