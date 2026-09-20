import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RePlay",
  description: "One portal into endless worlds for all your rehab needs"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
