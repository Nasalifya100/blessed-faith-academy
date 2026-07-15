import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blessed Faith Academy",
  description: "School Management System for Blessed Faith Academy",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
