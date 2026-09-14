import Link from "next/link";
import { checkSource } from "@/lib/source";
import { isRegister, isTier } from "@/lib/core";
import Reader from "./reader";

/**
 * Страница главы.
 *
 * Ссылку проверяем здесь, до того как что-то показать: если она никуда не
 * годится, честнее сказать это сразу, а не после двух минут ожидания.
 */
export default async function Read({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; register?: string; tier?: string }>;
}) {
  const params = await searchParams;
  const checked = checkSource(params.src ?? "");
  const register =
    params.register && isRegister(params.register) ? params.register : "ровный";
  const tier = params.tier && isTier(params.tier) ? params.tier : "middle";

  if (!checked.ok) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "clamp(40px, 12vw, 120px) 16px" }}>
        <h1 className="display" style={{ fontSize: 30, margin: "0 0 14px" }}>
          С этой ссылкой не выйдет
        </h1>
        <p style={{ color: "#c8bfae", lineHeight: 1.6, margin: "0 0 28px" }}>{checked.reason}</p>
        <Link href="/">← Попробовать другую</Link>
      </main>
    );
  }

  return <Reader src={checked.url} register={register} tier={tier} />;
}
