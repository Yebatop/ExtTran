/**
 * Проверка ссылки, которую прислал читатель.
 *
 * В консоли `loadChapter` принимает и путь к файлу, и ссылку — там это удобно
 * и безопасно, потому что запускает его тот же человек, чьи это файлы. На
 * сервере то же самое означало бы, что любой посетитель может попросить нас
 * прочитать файл с нашего диска или постучаться внутрь нашей же сети. Поэтому
 * сюда попадает только http(s) и только наружу.
 *
 * Проверка по имени хоста не ловит подмену DNS между проверкой и запросом.
 * Настоящая защита — запрет исходящих соединений внутрь сети на уровне сети;
 * это здесь отмечено, чтобы никто не принял проверку за неё.
 */

const PRIVATE_HOSTS = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

const PRIVATE_V4 =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export type SourceCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function checkSource(raw: string): SourceCheck {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "Ссылка пустая." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: "Это не похоже на ссылку. Нужен полный адрес главы, вместе с https://",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Открываем только http и https." };
  }

  const host = url.hostname.toLowerCase();
  if (
    PRIVATE_HOSTS.test(host) ||
    PRIVATE_V4.test(host) ||
    host === "::1" ||
    host.startsWith("[") ||
    host.endsWith(".")
  ) {
    return { ok: false, reason: "По этому адресу мы не ходим." };
  }

  return { ok: true, url: url.toString() };
}
