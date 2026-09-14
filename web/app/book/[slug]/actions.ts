"use server";

import { revalidatePath } from "next/cache";
import { chooseStore, storageKey, type Glossary, type Store, type Term, type TermKind } from "@/lib/core";

/**
 * Правки читателя: название книги и глоссарий.
 *
 * Всё обычными формами, без клиентского кода: страница должна работать и там,
 * где скрипты не выполнились. Отсюда и скрытые поля вместо состояния.
 *
 * Учётных записей ещё нет, и права здесь никто не проверяет: правит тот, кто
 * открыл страницу. Пока читатель один, это ровно то, что нужно; к появлению
 * чужих читателей сюда придётся поставить замок.
 */

const KINDS: readonly TermKind[] = [
  "имя", "обращение", "техника", "место", "организация", "предмет", "прочее",
];

function isKind(value: string): value is TermKind {
  return (KINDS as readonly string[]).includes(value);
}

/** Строка из формы: подрезанная и без лишних пробелов внутри. */
function field(form: FormData, name: string, limit = 200): string {
  return String(form.get(name) ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/** Книга по адресу страницы. Ключ книги в адрес не попадает — только слог. */
async function findBook(slug: string): Promise<{ store: Store; key: string } | null> {
  const store = await chooseStore();
  const book = (await store.listBooks()).find((b) => storageKey(b.key) === slug);
  return book ? { store, key: book.key } : null;
}

/** Обновить страницы, на которых видно изменённое. */
function refresh(slug: string): void {
  revalidatePath(`/book/${slug}/glossary`);
  revalidatePath(`/book/${slug}`);
  revalidatePath("/books");
  revalidatePath("/");
}

/**
 * Переименовать книгу.
 *
 * Название берётся из заголовка первой главы, и это догадка: на одних сайтах
 * там имя книги, на других — имя главы, а на третьих и то и другое сразу.
 * Догадку должно быть чем поправить, иначе книга навсегда останется
 * «Semi-Coercive Imperialist · Semi-Coercive Imperialist».
 *
 * Перезаписи можно не бояться: название пишется только при заведении книги,
 * следующие главы его не трогают.
 */
export async function renameBook(form: FormData): Promise<void> {
  const slug = field(form, "slug", 300);
  const title = field(form, "title");
  if (!title) return;

  const found = await findBook(slug);
  if (!found) return;

  const book = await found.store.readBook(found.key);
  if (!book) return;
  book.title = title;
  await found.store.writeBook(book);
  refresh(slug);
}

/** Прочитать глоссарий книги — или пустой, если его ещё нет. */
async function glossaryOf(slug: string): Promise<{ store: Store; key: string; glossary: Glossary } | null> {
  const found = await findBook(slug);
  if (!found) return null;
  const glossary = (await found.store.readGlossary(found.key)) ?? {
    novel: "", terms: [], addresses: [],
  };
  return { ...found, glossary };
}

/**
 * Поправить термин: написание, помету, вид.
 *
 * Исправленное помечается как закреплённое вручную. Слияние и так не трогает
 * то, что уже есть в глоссарии, но пометка говорит следующему человеку, что
 * эту строку проверяли глазами, а не предложила машина.
 *
 * Уже переведённые главы от правки не меняются: их текст сохранён, и
 * переписывать его задним числом мы не станем. Правка работает со следующей
 * главы — так и написано на странице.
 */
export async function saveTerm(form: FormData): Promise<void> {
  const slug = field(form, "slug", 300);
  const en = field(form, "en");
  const ru = field(form, "ru");
  const note = field(form, "note", 300);
  const kind = field(form, "kind", 40);
  if (!en || !ru) return;

  const found = await glossaryOf(slug);
  if (!found) return;

  const term = found.glossary.terms.find((t) => t.en === en);
  if (!term) return;
  term.ru = ru;
  term.note = note || undefined;
  if (isKind(kind)) term.kind = kind;
  term.source = "вручную";

  await found.store.writeGlossary(found.key, found.glossary);
  refresh(slug);
}

/** Убрать термин целиком: машина иногда заносит в глоссарий обычные слова. */
export async function removeTerm(form: FormData): Promise<void> {
  const slug = field(form, "slug", 300);
  const en = field(form, "en");
  if (!en) return;

  const found = await glossaryOf(slug);
  if (!found) return;

  const before = found.glossary.terms.length;
  found.glossary.terms = found.glossary.terms.filter((t) => t.en !== en);
  if (found.glossary.terms.length === before) return;

  await found.store.writeGlossary(found.key, found.glossary);
  refresh(slug);
}

/**
 * Добавить термин руками.
 *
 * Имя, названное в книге один раз, машина может и пропустить — а написание
 * у него всё равно должно быть одно на все главы.
 */
export async function addTerm(form: FormData): Promise<void> {
  const slug = field(form, "slug", 300);
  const en = field(form, "en");
  const ru = field(form, "ru");
  const note = field(form, "note", 300);
  const kind = field(form, "kind", 40);
  if (!en || !ru) return;

  const found = await glossaryOf(slug);
  if (!found) return;

  // Тот же термин дважды — это не добавление, а правка существующего.
  const already = found.glossary.terms.find((t) => t.en.toLowerCase() === en.toLowerCase());
  const term: Term = {
    en, ru, kind: isKind(kind) ? kind : "прочее",
    note: note || undefined, source: "вручную",
  };
  if (already) {
    Object.assign(already, term, { en: already.en });
  } else {
    found.glossary.terms.push(term);
  }

  await found.store.writeGlossary(found.key, found.glossary);
  refresh(slug);
}
