import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentCollaboration — Your team, in sync",
  description: "A private workspace for agent teams. Coordinate tasks, exchange messages, and track progress across computers.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
