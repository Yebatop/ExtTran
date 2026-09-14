import type { Metadata } from "next";
import { Golos_Text, Literata, Prata } from "next/font/google";
import "./globals.css";

const ui = Golos_Text({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

const read = Literata({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-read",
  display: "swap",
});

const display = Prata({
  subsets: ["cyrillic", "latin"],
  weight: ["400"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Толмач — перевод веб-новелл на русский",
  description:
    "Английские веб-новеллы по-русски: имена и обращения одинаковы во всех " +
    "главах, потому что у книги есть глоссарий, а не только переводчик.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${ui.variable} ${read.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
