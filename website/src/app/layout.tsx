import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lately",
  description: "Save it with a reason. Find it when you actually need it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
