import type { Metadata } from "next";
import { Cormorant_Garamond, Fraunces } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Rhyolite//",
  description: "Rhyolite// — terminal-grade creative + research environment with multi-provider LLMs, DAG reasoning, and hybrid RAG."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${cormorant.variable} ${fraunces.variable}`}>
      <body className="min-h-screen bg-black font-sans antialiased text-gray-100">
        {children}
      </body>
    </html>
  );
}

