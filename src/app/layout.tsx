import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Design Intake Assistant",
  description: "AI assistant that helps you define and structure product design requests through conversation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen text-slate-200">{children}</body>
    </html>
  );
}
