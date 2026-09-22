/**
 * Ядро «Толмача» — то, что умеет переводить, и ничего больше.
 *
 * Консоль и сайт — две оболочки над одним ядром. Консоль запускает его через
 * tsx прямо из исходников; сайт получает собранный JavaScript из dist/ и не
 * тащит ядро в свою сборку: оно работает только на сервере, где есть ключ,
 * сеть и разбор HTML. Отсюда и этот файл — единственная дверь внутрь.
 *
 * Точки входа консоли (check, measure, cli и прочие) сюда не входят намеренно:
 * они читают process.argv и пишут в stderr, а на сервере ни того, ни другого
 * быть не должно.
 */

// Первым импортом: загружает .env до того, как его прочитает config.
import "./env.js";

export {
  MODELS,
  TIERS,
  REGISTERS,
  USD_RUB,
  MAX_OUTPUT_TOKENS,
  USER_AGENT,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  isRegister,
  isTier,
  type ModelSpec,
  type Register,
  type Tier,
} from "./config.js";

export { bookRef, chapterName, chapterNumber, storageKey, type BookRef } from "./book.js";

export { connectionString, PostgresStore } from "./store-pg.js";

export {
  chooseStore,
  storageMode,
  translationKey,
  FileStore,
  MemoryStore,
  SOLE_READER,
  type BookRecord,
  type StorageMode,
  type Store,
  type TranslationRecord,
} from "./store.js";

export {
  priceUsage,
  formatSpend,
  makeCeiling,
  describeCeiling,
  type Ceiling,
  type Spend,
} from "./cost.js";

export {
  attempts,
  chapterFromHtml,
  coverFromHtml,
  decodeMhtml,
  fetchPage,
  findNextLink,
  linkDensity,
  loadChapter,
  looksLocked,
  nextFromIndex,
  stripCredits,
  type Chapter,
  type ExtractionAttempt,
} from "./extract.js";

export {
  EMPTY_GLOSSARY,
  renderGlossary,
  renderKnownCompact,
  type Address,
  type Glossary,
  type Term,
  type TermKind,
} from "./glossary.js";

export {
  highlight,
  type HighlightTerm,
  type Segment,
} from "./highlight.js";

export { polish } from "./polish.js";

export { mean, median, spread } from "./stats.js";

export {
  extractTerms,
  mergeIntoGlossary,
  type ExtractionResult,
  type MergeReport,
} from "./terms.js";

export {
  translateChapter,
  type Translation,
  type TranslateOptions,
} from "./translate.js";
