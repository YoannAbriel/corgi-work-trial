import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Corgi policy administration (trial)",
  description: "Commercial liability policies with an append-only ledger. Sandbox data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
