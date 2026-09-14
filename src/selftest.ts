/**
 * Самопроверка: всё, что можно проверить без ключа и без сети.
 *
 *   npm run selftest
 *
 * Появилась после того, как в заголовок User-Agent попало русское слово и не
 * работал ни один сетевой запрос: типизация была чистой, файлы разбирались,
 * а запрос падал ещё до отправки. Проверять надо не только то, что удобно
 * проверять.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";
import { USER_AGENT, REGISTERS, MODELS, TIERS, isRegister } from "./config.js";
import { renderGlossary, renderKnownCompact, type Glossary } from "./glossary.js";
import {
  attempts,
  decodeMhtml,
  findNextLink,
  linkDensity,
  looksLocked,
  stripCredits,
} from "./extract.js";
import { mean, median, spread } from "./stats.js";
import { parseArgv } from "./args.js";
import { bookRef, storageKey } from "./book.js";
import { MemoryStore } from "./store.js";
import { missingFileMessage } from "./files.js";

let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(
      `  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const CHAPTER_HTML = `<!doctype html><html><head><title>Chapter 1</title></head><body>
<nav><a href="/">Home</a><a href="/list">List</a></nav>
<h1>Chapter 1</h1>
<div class="reading-content">
<p>The gate keeper counted twice and shook his head, because the number had not changed.</p>
<p>He had counted it every morning for nine years, and every morning it came out the same.</p>
<p>That was the part nobody in the valley could explain, and the part he had stopped explaining.</p>
<p>By noon the dust had settled again, and the road below was empty in both directions.</p>
</div></body></html>`;

const TOC_HTML = `<!doctype html><html><body><h1>Book</h1><ul>${Array.from(
  { length: 80 },
  (_, i) => `<li><a href="/c/${i + 1}">Chapter ${i + 1}</a></li>`,
).join("")}</ul></body></html>`;

process.stdout.write("Самопроверка Толмача\n\n");

check("заголовки запроса собираются (только латиница)", () => {
  // Именно здесь и падало: HTTP-заголовок — это ByteString, байты 0–255.
  new Headers({
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.9",
  });
  assert(
    // eslint-disable-next-line no-control-regex
    /^[\x00-\xFF]*$/.test(USER_AGENT),
    `в User-Agent есть символ вне Latin-1: ${USER_AGENT}`,
  );
});

check("текст главы снимается со страницы", () => {
  const tries = attempts(CHAPTER_HTML, "https://example.invalid/c/1");
  assert(tries.length > 0, "ни один способ не сработал");
  const best = Math.max(...tries.map((t) => t.wordCount));
  assert(best > 40, `слов снялось всего ${best}`);
});

check("оглавление отличается от главы", () => {
  const chapter = linkDensity(CHAPTER_HTML, "https://example.invalid/c/1");
  const toc = linkDensity(TOC_HTML, "https://example.invalid/book");
  assert(chapter < 0.5, `у главы доля ссылок ${(chapter * 100).toFixed(0)}%`);
  assert(toc > 0.5, `у оглавления доля ссылок ${(toc * 100).toFixed(0)}%`);
});

check("глоссарий собирается одинаково при любом порядке", () => {
  const a: Glossary = {
    novel: "X",
    terms: [
      { en: "Bravo", ru: "Браво", kind: "имя" },
      { en: "Alpha", ru: "Альфа", kind: "имя" },
    ],
    addresses: [{ from: "Б", to: "А", form: "ты" }],
  };
  const b: Glossary = {
    novel: "X",
    terms: [...a.terms].reverse(),
    addresses: [...a.addresses],
  };
  assert(
    renderGlossary(a) === renderGlossary(b),
    "порядок терминов влияет на промпт — кэш будет обнуляться каждый раз",
  );
});

check("список известного уходит коротким и одинаковым", () => {
  // Полный глоссарий пересылался в каждый запрос целиком — с ростом книги это
  // и оказалось главной статьёй расхода на разбор. Модели здесь нужно знать
  // только, чего не предлагать повторно.
  const big: Glossary = {
    novel: "X",
    terms: [
      { en: "Bravo", ru: "Браво", kind: "имя", note: "капитан городской стражи" },
      { en: "Alpha", ru: "Альфа", kind: "место", note: "столица южного предела" },
    ],
    addresses: [{ from: "Б", to: "А", form: "ты" }],
  };
  const compact = renderKnownCompact(big);
  assert(compact.includes("Alpha") && compact.includes("Bravo"), "термины потерялись");
  assert(!compact.includes("Браво"), "перевод уходит в запрос, хотя там не нужен");
  assert(!compact.includes("капитан"), "помета уходит в запрос, хотя там не нужна");
  assert(
    compact.length < renderGlossary(big).length,
    "короткий список не короче полного глоссария",
  );
  assert(
    compact === renderKnownCompact({ ...big, terms: [...big.terms].reverse() }),
    "порядок терминов меняет промпт — кэш будет обнуляться каждую главу",
  );
  assert(
    renderKnownCompact({ novel: "X", terms: [], addresses: [] }).length > 0,
    "на первой главе список пуст, но блок должен быть непустым",
  );
});

check("служебная обвязка переводчика срезается", () => {
  const withCredits = [
    "Translator: KJ",
    "Editor: someone",
    "\u2500\u2500\u2500\u2500",
    "",
    "The gate keeper counted twice and shook his head.",
    "",
    "Translator: he had counted it every morning for nine years.",
    "",
    "\u2500\u2500\u2500\u2500",
    "Support us on our page for advanced chapters",
  ].join("\n");

  const cleaned = stripCredits(withCredits);
  assert(!cleaned.startsWith("Translator"), "шапка осталась");
  assert(!cleaned.includes("advanced chapters"), "подвал остался");
  assert(
    cleaned.startsWith("The gate keeper"),
    `начало текста отъели: ${cleaned.slice(0, 40)}`,
  );
  assert(
    cleaned.includes("Translator: he had counted"),
    "строка из середины текста срезана, а трогать её нельзя",
  );
});

check("последняя реплика главы не считается подвалом", () => {
  // Настоящий риск: глава кончается короткой репликой, а мы её молча съедаем.
  const text = [
    "He stopped at the door and did not turn around.",
    "",
    "\u201cPlease,\u201d she said. \u201cNot tonight.\u201d",
  ].join("\n");
  assert(
    stripCredits(text).endsWith("Not tonight.\u201d"),
    "срезали последнюю реплику главы",
  );
});

check("медиана не ведётся на одну длинную главу", () => {
  // Ровно наш случай: первая глава книги длиннее остальных.
  const lengths = [2731, 1400, 1380, 1420, 1390];
  assert(median(lengths) === 1400, `медиана ${median(lengths)}, ждали 1400`);
  assert(mean(lengths) > median(lengths), "среднее должно быть выше медианы");
  assert(median([]) === 0 && mean([]) === 0, "пустой список должен давать ноль");
  assert(median([1, 2, 3, 4]) === 2.5, "чётная длина считается неверно");
});

check("пилот берёт главы вразброс, а не первые подряд", () => {
  // Первый замер считал себестоимость по главам 1-3, а первая глава книги
  // была 2 729 слов против медианы 1 738 — тарифы считались от завышенной
  // цены. Середины равных отрезков заодно обходят главу номер один.
  const book = Array.from({ length: 10 }, (_, i) => i + 1);
  const picked = spread(book, 3);
  assert(picked.length === 3, `взяли ${picked.length} глав вместо трёх`);
  assert(!picked.includes(1), `первая глава снова в выборке: ${picked.join(", ")}`);
  assert(
    Math.max(...picked) > 7,
    `до конца книги не дошли: ${picked.join(", ")}`,
  );
  assert(new Set(picked).size === 3, "одна и та же глава взята дважды");

  // Список короче запрошенного — берём его целиком, а не падаем
  assert(spread([1, 2], 5).length === 2, "короткий список должен браться целиком");
  assert(spread([1, 2, 3], 0).length === 0, "ноль глав — это ноль глав");
});

check("страница, сохранённая как MHTML, распаковывается", () => {
  // Chrome на Android по умолчанию сохраняет именно так. Тело кодируется
  // quoted-printable: знак равенства в конце строки это перенос, а не символ.
  const html = "<html><head><title>Ch 5</title></head><body><h1>Ch 5</h1></body></html>";
  const wrapped =
    "MIME-Version: 1.0\r\n" +
    'Content-Type: multipart/related; boundary="----=_B_01"\r\n\r\n' +
    "------=_B_01\r\n" +
    "Content-Type: text/html\r\n" +
    "Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
    // Перенос внутри слова Chapter и закодированный знак равенства
    html.replace("<h1>Ch 5</h1>", "<h1>Ch=\n 5</h1>") +
    "\r\n------=_B_01--\r\n";

  const decoded = decodeMhtml(wrapped);
  assert(decoded !== null, "не распаковалось вовсе");
  assert(
    (decoded ?? "").includes("<h1>Ch 5</h1>"),
    `перенос строки не склеился: ${(decoded ?? "").match(/<h1>[^<]*<\/h1>/)?.[0]}`,
  );
  assert(
    !/=[0-9A-Fa-f]{2}|=\r?\n/.test(decoded ?? ""),
    "в распакованном тексте остались escape-последовательности",
  );
  assert(decodeMhtml("<html>обычный html</html>") === null, "обычный html принят за MHTML");
});

check("платная глава отличается от сломанной", () => {
  const locked =
    "<html><body><h1>Chapter 270</h1><div>This is a premium chapter. Subscribe to read.</div></body></html>";
  const broken = "<html><body><div id=\"app\"></div></body></html>";
  assert(looksLocked(locked), "платную главу не распознали");
  assert(!looksLocked(broken), "пустую страницу приняли за платную");
});

check("ссылка «вперёд» не путается с «назад»", () => {
  const here = "https://site.invalid/novel/x/chapter-2-must-kill";

  // Обычный случай: обе ссылки рядом, назад идёт первой
  const both =
    '<html><body><p>text</p>' +
    '<a class="prev-chapter" href="/novel/x/chapter-1-to-that-place">Previous</a>' +
    '<a class="next-chapter" href="/novel/x/chapter-3-the-gate">Next</a>' +
    "</body></html>";
  assert(
    findNextLink(both, here) === "https://site.invalid/novel/x/chapter-3-the-gate",
    `взяли не ту ссылку: ${findNextLink(both, here)}`,
  );

  // Без классов, только по тексту — и «назад» стоит раньше
  const byText =
    '<html><body><a href="/novel/x/chapter-1-to-that-place">« Prev</a>' +
    '<a href="/novel/x/chapter-3-the-gate">Next »</a></body></html>';
  assert(
    findNextLink(byText, here) === "https://site.invalid/novel/x/chapter-3-the-gate",
    "по тексту ссылку не нашли или взяли «назад»",
  );

  // Последняя глава: вперёд идти некуда
  const last =
    '<html><body><a class="prev" href="/novel/x/chapter-1-to-that-place">Previous</a></body></html>';
  assert(findNextLink(last, here) === null, "придумали следующую главу там, где её нет");

  // Чужой сайт — не наш путь
  const offsite =
    '<html><body><a rel="next" href="https://elsewhere.invalid/c/3">Next</a></body></html>';
  assert(findNextLink(offsite, here) === null, "ушли на посторонний сайт");
});

check("разбор аргументов переживает лишний --", () => {
  // Ровно то, обо что споткнулись: npm подставляет -- сам, и терминал
  // иногда добавляет ещё один. Это разделитель, а не ключ.
  const a = parseArgv(["--", "--список", "главы.txt"]);
  assert(a.flags.get("список") === "главы.txt", `ключ потерялся: ${[...a.flags]}`);
  assert(a.positional.length === 0, "разделитель попал в позиционные");

  const b = parseArgv(["перевести", "глава.txt", "--регистр", "живой"]);
  assert(b.positional[0] === "перевести" && b.positional[1] === "глава.txt", "позиционные съехали");
  assert(b.flags.get("регистр") === "живой", "ключ со значением не разобрался");

  const c = parseArgv(["список.txt", "--все", "--предел", "300"], ["все"]);
  assert(c.bare.has("все"), "ключ без значения не распознан");
  assert(c.flags.get("предел") === "300", "ключ после булева потерялся");

  let threw = false;
  try {
    parseArgv(["--глоссарий"]);
  } catch {
    threw = true;
  }
  assert(threw, "ключ без значения должен ругаться, а не молчать");
});

check("промах в имени файла объясняется, а не нумеруется", () => {
  // Имя набирают на телефоне, кириллицей. ENOENT не говорит ни что за файл
  // ждали, ни что лежит рядом — а рядом обычно лежит то самое, с опечаткой.
  const withNeighbours = missingFileMessage("главы.txt", "список глав", [
    "список.txt",
    "главы-1-10.txt",
  ]);
  assert(withNeighbours.includes("главы.txt"), "не сказано, чего искали");
  assert(withNeighbours.includes("список глав"), "не сказано, что это за файл");
  assert(withNeighbours.includes("список.txt"), "не показано, что лежит рядом");

  const empty = missingFileMessage("главы.txt", "список глав", []);
  assert(empty.includes("главы.txt"), "не сказано, чего искали");
  assert(!empty.includes(":"), "обещали список соседей, которых нет");

  const many = missingFileMessage(
    "главы.txt",
    "список глав",
    Array.from({ length: 20 }, (_, i) => `c${i}.txt`),
  );
  assert(many.split("\n").length <= 10, "вывалили в глаза всю папку целиком");
  assert(many.includes("и ещё 12"), "не сказано, сколько соседей не показали");
});

check("главы одной книги дают один ключ", () => {
  // Тихая ошибка, которая дороже всех: разойдись ключ на двух главах — и
  // каждая заведёт свой глоссарий, а весь смысл продукта в том, что он один
  // на книгу. Адреса настоящие, с того сайта, на котором мерили.
  const book = "kjnovels.com/novel/semi-coercive-imperialist";
  for (const url of [
    "https://kjnovels.com/novel/semi-coercive-imperialist/chapter-1-the-beginning",
    "https://kjnovels.com/novel/semi-coercive-imperialist/chapter-2-must-kill",
    "https://kjnovels.com/novel/semi-coercive-imperialist/chapter-274",
  ]) {
    const ref = bookRef(url);
    assert(ref.key === book, `${url}\n      дал ключ ${ref.key}, ждали ${book}`);
    assert(ref.slug === "semi-coercive-imperialist", `имя из адреса: ${ref.slug}`);
  }

  // Другая книга на том же сайте — другой ключ, иначе глоссарии смешаются.
  assert(
    bookRef("https://kjnovels.com/novel/other-book/chapter-1").key !== book,
    "две разные книги схлопнулись в один ключ",
  );

  // Устройство путей у сайтов разное; проверяем не только один случай.
  assert(
    bookRef("https://site.invalid/read/some-novel/123").key === "site.invalid/read/some-novel",
    `номерная глава: ${bookRef("https://site.invalid/read/some-novel/123").key}`,
  );
  assert(
    bookRef("https://site.invalid/novel/x/vol-2/chapter-5").key === "site.invalid/novel/x",
    `том и глава: ${bookRef("https://site.invalid/novel/x/vol-2/chapter-5").key}`,
  );

  // Ключ хранилища: разные книги не должны схлопнуться после обработки.
  assert(
    storageKey("kjnovels.com/novel/a") !== storageKey("kjnovels.com/novel/b"),
    "ключи хранилища схлопнулись",
  );
  assert(
    /^[a-z0-9._-]+$/.test(storageKey("KJNovels.com/novel/Semi-Coercive")),
    `в ключе хранилища осталось небезопасное: ${storageKey("KJNovels.com/novel/Semi-Coercive")}`,
  );
});

check("хранилище отдаёт то, что в него положили", () => {
  const store = new MemoryStore();
  const key = "site.invalid/novel/x";
  void store.writeGlossary(key, {
    novel: "X",
    terms: [{ en: "Ain", ru: "Айн", kind: "имя" }],
    addresses: [],
  });
  void store
    .readGlossary(key)
    .then((g) => assert(g?.terms.length === 1, "глоссарий не вернулся"));
  void store
    .readGlossary("site.invalid/novel/другая")
    .then((g) => assert(g === null, "чужой глоссарий нашёлся там, где его нет"));
});

check("регистры перевода на месте", () => {
  for (const name of ["живой", "ровный", "возвышенный"]) {
    assert(isRegister(name), `регистр «${name}» потерялся`);
    assert(REGISTERS[name as keyof typeof REGISTERS].length > 20, `описание «${name}» пустое`);
  }
});

check("модели, цены и пороги кэша заданы", () => {
  for (const tier of TIERS) {
    const m = MODELS[tier];
    assert(m.id.length > 0, `у ${tier} нет идентификатора модели`);
    assert(m.inputPerMTok > 0 && m.outputPerMTok > 0, `у ${tier} нулевая цена`);
    assert(m.minCacheTokens > 0, `у ${tier} не задан порог кэширования`);
  }
  assert(
    MODELS.fast.outputPerMTok < MODELS.middle.outputPerMTok &&
      MODELS.middle.outputPerMTok < MODELS.strong.outputPerMTok,
    "уровни перестали идти по возрастанию цены",
  );
});

process.stdout.write(
  failed === 0
    ? "\nВсё на месте. Ключ и сеть проверяются командой check на настоящей странице.\n"
    : `\nПровалилось проверок: ${failed}.\n`,
);
process.exitCode = failed === 0 ? 0 : 1;
