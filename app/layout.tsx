import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keyhole",
  description: "Apply for rentals without handing over your life.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
