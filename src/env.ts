/**
 * Чтение .env своими силами.
 *
 * У Node есть для этого собственный ключ, но он появился только в 22.9, а
 * запускать это будут на чём придётся — в том числе на телефоне, где Node
 * такой, какой дал пакетный менеджер. Пятнадцать строк здесь избавляют от
 * целого класса «у меня не работает».
 *
 * Переменные, уже выставленные в окружении, не трогаются: окружение главнее
 * файла.
 *
 * ВАЖНО: загрузка происходит при импорте этого модуля, а не по вызову.
 * В ESM тела импортированных модулей выполняются раньше тела импортирующего,
 * поэтому вызов loadEnv() в начале main-файла опаздывает: config.ts успевает
 * прочитать окружение до него. Отсюда побочный эффект при импорте — и отсюда же
 * требование держать `import "./env.js"` ПЕРВЫМ импортом в точках входа.
 */

import { readFileSync } from "node:fs";

/** Минимальная версия Node, на которой всё это работает: нужен глобальный fetch. */
const MIN_NODE_MAJOR = 18;

export function loadEnv(path = ".env"): void {
  checkNodeVersion();

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // файла нет — это нормально
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key === "" || process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "") continue;

    process.env[key] = value;
  }
}

function checkNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(major) && major < MIN_NODE_MAJOR) {
    process.stderr.write(
      `Node ${process.versions.node} слишком старый — нужен ${MIN_NODE_MAJOR} или новее.\n` +
        "На телефоне: pkg upgrade nodejs. На компьютере: nodejs.org.\n",
    );
    process.exit(1);
  }
}

// Выполняется при импорте — см. объяснение в шапке файла.
loadEnv();
