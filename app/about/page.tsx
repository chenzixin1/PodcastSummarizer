'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ThemeModeSwitch from '../../components/ThemeModeSwitch';

type ThemeMode = 'light' | 'dark';

export default function AboutPage() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const storedTheme = window.localStorage.getItem('podsum-dashboard-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      setThemeMode(storedTheme);
      return;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setThemeMode(prefersDark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('podsum-dashboard-theme', themeMode);
  }, [themeMode]);

  return (
    <div className="dashboard-shell min-h-screen text-[var(--text-main)] flex flex-col" data-theme={themeMode}>
      <header className="sticky top-0 z-20 border-b border-[var(--border-soft)] bg-[var(--header-bg)] backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <nav className="app-breadcrumb-nav w-full md:w-auto">
            <Link href="/" className="app-breadcrumb-link">
              <Image src="/podcast-summarizer-icon.png" alt="PodSum logo" width={28} height={28} className="app-breadcrumb-logo" />
              <span>PodSum.cc</span>
            </Link>
            <span className="app-breadcrumb-divider">/</span>
            <span className="app-breadcrumb-current">About</span>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end w-full md:w-auto">
            <Link href="/my" className="bg-[var(--paper-base)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              My Summaries
            </Link>
            <Link href="/upload" className="bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              + Upload SRT
            </Link>
            <ThemeModeSwitch themeMode={themeMode} onToggle={setThemeMode} />
          </div>
        </div>
      </header>

      <main className="container mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 flex-grow flex items-center justify-center">
        <section className="dashboard-panel w-full max-w-3xl rounded-2xl px-6 py-10 sm:px-10 sm:py-12 text-center">
          <div className="mx-auto mb-8 w-full max-w-[360px]">
            <Image
              src="/podcast-summarizer-icon.png"
              alt="PodSum logo"
              width={512}
              height={512}
              className="w-full h-auto drop-shadow-[0_18px_36px_rgba(47,102,86,0.22)]"
              priority
            />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[var(--heading)] mb-4">About PodSum.cc</h1>
          <p className="text-base sm:text-lg leading-8 text-[var(--text-secondary)]">
            PodSum.cc 是一个把播客内容快速整理成可读结论的平台。你可以上传 SRT 或 YouTube 链接，
            系统会自动生成结构化摘要、重点信息和可追溯的全文内容，帮助你更快理解长内容并沉淀知识。
          </p>

          <div className="mt-8 rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] px-5 py-6 sm:px-7 text-left">
            <h2 className="text-xl sm:text-2xl font-semibold text-[var(--heading)] mb-3">
              Logo 寓意：知识晶体（Crystal of Ideas）
            </h2>
            <p className="text-sm sm:text-base leading-7 text-[var(--text-secondary)] mb-4">
              我们希望这个 Logo 传达的是一个过程，而不只是一个工具图标：
              声音被理解、被提炼，最终凝结成可复用的知识。
            </p>
            <ul className="space-y-2 text-sm sm:text-base leading-7 text-[var(--text-secondary)] list-disc pl-5">
              <li>外圈是简化后的麦克风轮廓，代表播客语音输入。</li>
              <li>中心是几何晶体结构，代表被压缩与提炼后的信息核心。</li>
              <li>晶体发光点象征关键洞察，意味着内容被整理成可执行的要点。</li>
              <li>整体偏科技与抽象风格，避免“普通听书工具”的既视感。</li>
            </ul>
            <p className="mt-4 text-sm sm:text-base leading-7 text-[var(--heading-soft)] font-medium">
              核心语义：声音 → 提炼 → 形成知识晶体。
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
