import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "BlindArbiter",
  description: "Confidential milestone escrow arbiter for private deliverables.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
