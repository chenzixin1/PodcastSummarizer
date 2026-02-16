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
        <footer className="border-t border-[rgba(132,151,182,0.22)] bg-[linear-gradient(180deg,#091224_0%,#0b182d_100%)] px-4 py-4 text-sm text-[#aeb9cb]">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[#9eabc0]">PodSum.cc 2026, All rights reserved.</p>
            <div className="flex items-center gap-3 sm:justify-end">
              <Link href="/about" className="font-medium text-[#d8e2f1] hover:text-white hover:underline underline-offset-4 transition-colors">
                About
              </Link>
              <span className="text-[#73839c]">|</span>
              <Link href="/chrome-extension" className="font-medium text-[#d8e2f1] hover:text-white hover:underline underline-offset-4 transition-colors">
                Chrome Extension
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
