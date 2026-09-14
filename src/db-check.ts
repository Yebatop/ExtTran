/**
 * Проверка базы: доедет ли до неё то, что мы пишем.
 *
 *   npm run проверка-базы
 *
 * Подключить базу в панели хостинга легко, а понять, что она действительно
 * работает, — нет: сайт с неработающей базой выглядит точно так же, просто
 * тихо забывает глоссарии. Эта команда отвечает на вопрос прямо.
 *
 * Пишет она в настоящую базу и за собой убирает: ключи начинаются с
 * «проверка-», чтобы их было видно, если уборка почему-то не случится.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import { connectionString, PostgresStore } from "./store-pg.js";
import { SOLE_READER } from "./store.js";

const KEY = "проверка-толмача.invalid/книга";
const OTHER = "проверка-толмача.invalid/другая-книга";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  process.stdout.write(
    ok ? `  ✓ ${name}\n` : `  ✗ ${name}\n      ${detail}\n`,
  );
  if (!ok) failed += 1;
}

async function main(): Promise<void> {
  const url = connectionString();
  if (!url) {
    process.stdout.write(
      "Строки подключения нет.\n\n" +
        "Проверять нечего: сайт будет работать, но забудет всё при перезапуске.\n" +
        "Подключите базу и пропишите её строку в TOLMACH_DATABASE_URL,\n" +
        "DATABASE_URL или POSTGRES_URL — годится любая из трёх.\n",
    );
    process.exitCode = 1;
    return;
  }

  const shown = url.replace(/:\/\/[^@]*@/, "://…@");
  process.stdout.write(`База: ${shown}\n\n`);

  const store = new PostgresStore(url);

  try {
    check("пустое место отдаётся как пустое", (await store.readBook(KEY)) === null);

    // Самая первая глава книги пишет глоссарий раньше, чем запись о книге.
    await store.writeGlossary(KEY, {
      novel: "Проверка",
      terms: [{ en: "Ebenholz", ru: "Эбенхольц", kind: "имя", note: "род героя" }],
      addresses: [{ from: "Эдмон", to: "Себастьян", form: "вы" }],
    });
    const first = await store.readGlossary(KEY);
    check("глоссарий пишется раньше записи о книге", first?.terms.length === 1);
    check("помета доехала", first?.terms[0]?.note === "род героя");
    check("обращения доехали", first?.addresses[0]?.form === "вы");

    const now = new Date().toISOString();
    await store.writeBook({
      key: KEY, host: "проверка-толмача.invalid", slug: "книга",
      title: "Проверка", chaptersTranslated: 1, firstSeen: now, lastSeen: now,
    });
    const book = await store.readBook(KEY);
    check("книга читается обратно", book?.chaptersTranslated === 1);

    // Вторая глава той же книги: обновление, а не второй ряд.
    await store.writeBook({ ...book!, chaptersTranslated: 2 });
    const again = await store.readBook(KEY);
    check("вторая глава обновляет, а не задваивает", again?.chaptersTranslated === 2);
    check("дата первой встречи цела", again?.firstSeen === book?.firstSeen);

    await store.writeGlossary(KEY, {
      novel: "Проверка",
      terms: [
        { en: "Ebenholz", ru: "Эбенхольц", kind: "имя" },
        { en: "mana", ru: "мана", kind: "прочее" },
      ],
      addresses: [],
    });
    check("глоссарий растёт", (await store.readGlossary(KEY))?.terms.length === 2);

    await store.writeGlossary(OTHER, { novel: "Книга «Ёлка»", terms: [], addresses: [] });
    check("кириллица в ключе и названии цела", (await store.readGlossary(OTHER)) !== null);
    check("книги не смешались", (await store.readGlossary(OTHER))?.terms.length === 0);

    // Переводы: ради них половина смысла базы — не платить дважды.
    const stamp = new Date().toISOString();
    check(
      "непереведённой главы в хранилище нет",
      (await store.readTranslation(SOLE_READER, "https://проверка.invalid/c/1", "ровный", "middle")) === null,
    );
    await store.writeTranslation({
      owner: SOLE_READER, source: "https://проверка.invalid/c/1", bookKey: KEY,
      register: "ровный", tier: "middle", title: "Глава 1", words: 1738,
      text: "Первый абзац.\n\nВторой абзац.", model: "claude-sonnet-5",
      rub: 5.75, published: false, nextUrl: "https://проверка.invalid/c/2",
      createdAt: stamp, lastReadAt: stamp,
    });
    const back = await store.readTranslation(SOLE_READER, "https://проверка.invalid/c/1", "ровный", "middle");
    check("перевод читается обратно целиком", back?.text.includes("Второй абзац") === true);
    check("цена сохранилась", back?.rub === 5.75);
    check(
      "ссылка на следующую главу сохранилась",
      back?.nextUrl === "https://проверка.invalid/c/2",
    );
    check("галочка публикации выключена", back?.published === false);
    check(
      "другой регистр — другой перевод, а не этот же",
      (await store.readTranslation(SOLE_READER, "https://проверка.invalid/c/1", "живой", "middle")) === null,
    );
    check(
      "другая модель — другой перевод",
      (await store.readTranslation(SOLE_READER, "https://проверка.invalid/c/1", "ровный", "strong")) === null,
    );
    check(
      "чужому читателю перевод не отдаётся",
      (await store.readTranslation("кто-то-другой", "https://проверка.invalid/c/1", "ровный", "middle")) === null,
    );
  } finally {
    await store.removeBook(KEY).catch(() => undefined);
    await store.removeBook(OTHER).catch(() => undefined);
    await store.close();
  }

  process.stdout.write(
    failed === 0
      ? "\nБаза работает: глоссарии переживут перезапуск.\n"
      : `\nПровалилось проверок: ${failed}. Глоссарии сохраняться не будут.\n`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\nДо базы не достучались: ${error instanceof Error ? error.message : String(error)}\n\n` +
      "Частые причины: строка подключения не та, база требует TLS и его\n" +
      "отключили ключом sslmode=disable, или доступ закрыт по адресу.\n",
  );
  process.exitCode = 1;
});
