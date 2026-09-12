import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Code Visualizer",
  description: "Explore source connections locally",
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
