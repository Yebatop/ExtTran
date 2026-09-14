/**
 * Разбор аргументов командной строки — один на все команды.
 *
 * Был свой в каждой точке входа, и одну и ту же ошибку приходилось чинить
 * пять раз. Здесь она чинится один раз и закрывается проверкой.
 */

export interface Parsed {
  /** Ключи со значением: --регистр возвышенный */
  flags: Map<string, string>;
  /** Ключи без значения: --все */
  bare: Set<string>;
  /** Всё остальное */
  positional: string[];
}

/**
 * @param booleans имена ключей, которые значения не требуют
 */
export function parseArgv(argv: string[], booleans: readonly string[] = []): Parsed {
  const flags = new Map<string, string>();
  const bare = new Set<string>();
  const positional: string[] = [];
  const isBoolean = new Set(booleans);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    // Одиночные -- и - это разделители, а не ключи. npm подставляет их сам,
    // и падать на них нельзя.
    if (arg === "--" || arg === "-") continue;

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const name = arg.slice(2);
    if (isBoolean.has(name)) {
      bare.add(name);
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(
        `У ключа ${arg} нет значения. Если это опечатка — посмотрите список ключей, ` +
          "запустив команду без аргументов.",
      );
    }
    flags.set(name, value);
    i += 1;
  }

  return { flags, bare, positional };
}

/** Значение ключа по русскому или латинскому имени. */
export function pick(
  parsed: Parsed,
  ru: string,
  en: string,
  fallback?: string,
): string | undefined {
  return parsed.flags.get(ru) ?? parsed.flags.get(en) ?? fallback;
}
