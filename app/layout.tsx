import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import SessionWrapper from '../components/SessionWrapper';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PodSum.cc - AI Podcast Summarizer",
  description: "Upload your SRT files and get AI-powered summaries, translations, and highlights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <div className="flex-1">
          <SessionWrapper>
            {children}
          </SessionWrapper>
        </div>
        <footer className="border-t border-[rgba(128,112,86,0.22)] bg-[rgba(248,243,234,0.82)] px-4 py-3 text-center text-sm text-[#5f5547]">
          <Link href="/about" className="font-medium text-[#2f6656] hover:text-[#255648] hover:underline underline-offset-4 transition-colors">
            About
          </Link>
        </footer>
      </body>
    </html>
  );
}
