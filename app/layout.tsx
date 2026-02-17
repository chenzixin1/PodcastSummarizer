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
        <footer className="border-t border-[var(--border-soft)] bg-[var(--background)] px-4 py-5 text-sm text-[var(--text-secondary)]">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] tracking-[0.02em] text-[var(--text-muted)]">PodSum.cc 2026, All rights reserved.</p>
            <div className="flex items-center gap-2.5 sm:justify-end">
              <Link href="/about" className="rounded-full border border-[var(--border-soft)] bg-[var(--paper-muted)] px-3 py-1.5 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--paper-subtle)] hover:text-[var(--heading)]">
                About
              </Link>
              <Link href="/chrome-extension" className="rounded-full border border-[var(--border-soft)] bg-[var(--paper-muted)] px-3 py-1.5 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--paper-subtle)] hover:text-[var(--heading)]">
                Chrome Extension
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
