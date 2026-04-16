import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyDeck - 知识整理助手",
  description: "帮助用户围绕内容进行知识整理与沉淀",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}