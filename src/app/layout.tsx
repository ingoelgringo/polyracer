import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const LEGACY_REDIRECT = `try { new Function("async function f() {} var o = { ...{} };"); } catch (e) { location.replace("/tv"); }`;

export const metadata: Metadata = {
  title: "Polyracer",
  description: "Couch party game: race from the middle to a green cell before time runs out, last player left wins.",
  icons: { apple: "/apple-touch-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Old TV browsers (Samsung 2017 = Chrome 47) can't parse this app's JavaScript
            and just show black, so send them to the plain TV page instead. */}
        <script dangerouslySetInnerHTML={{ __html: LEGACY_REDIRECT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
