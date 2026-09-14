import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  /**
   * Корень — папка репозитория, а не web/: ядро собирается в ../dist и
   * должно оставаться внутри корня, иначе сборщик его просто не найдёт.
   * Заодно снимает предупреждение про два lock-файла.
   */
  turbopack: { root: path.join(__dirname, "..") },
  /**
   * Ядро работает только на сервере и тащит за собой разбор HTML и клиент
   * Anthropic. Ни то, ни другое не должно попадать в сборку: jsdom весит
   * больше всего сайта, а ключ рядом с ним вообще не должен оказываться
   * в одном файле с клиентским кодом.
   */
  serverExternalPackages: ["jsdom", "@mozilla/readability", "@anthropic-ai/sdk"],
};

export default config;
