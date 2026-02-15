'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ThemeModeSwitch from '../../components/ThemeModeSwitch';

type ThemeMode = 'light' | 'dark';

export default function ChromeExtensionPage() {
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
            <span className="app-breadcrumb-current">Chrome Extension</span>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end w-full md:w-auto">
            <Link href="/about" className="bg-[var(--paper-base)] hover:bg-[var(--paper-muted)] border border-[var(--border-soft)] text-[var(--text-secondary)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              About
            </Link>
            <Link href="/upload" className="bg-[var(--btn-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-text)] text-sm font-medium py-2 px-4 sm:px-6 rounded-lg transition-colors">
              + Upload SRT
            </Link>
            <ThemeModeSwitch themeMode={themeMode} onToggle={setThemeMode} />
          </div>
        </div>
      </header>

      <main className="container mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8 flex-grow">
        <section className="dashboard-panel rounded-2xl p-5 sm:p-6 lg:p-8 max-w-4xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--heading)] mb-3">PodSum Chrome Extension</h1>
          <p className="text-[var(--text-secondary)] leading-7 mb-6">
            下载压缩包后，按照下方步骤在 Chrome 中启用开发者模式并安装扩展。
          </p>

          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-5 sm:p-6 mb-6">
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--heading)] mb-3">下载扩展</h2>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] mb-4">
              文件名：<span className="font-semibold">podsum-chrome-extension.zip</span>
            </p>
            <a
              href="/downloads/podsum-chrome-extension.zip"
              download
              className="inline-flex items-center justify-center rounded-xl bg-[var(--btn-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] transition-colors"
            >
              Download ZIP
            </a>
          </div>

          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-5 sm:p-6">
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--heading)] mb-3">安装说明</h2>
            <ol className="list-decimal pl-5 space-y-3 text-sm sm:text-base leading-7 text-[var(--text-secondary)]">
              <li>先下载上面的 ZIP 压缩包，并解压到本地一个固定目录。</li>
              <li>打开 Chrome，在地址栏输入 <code>chrome://extensions</code> 并回车。</li>
              <li>在扩展管理页面右上角，打开“开发者模式（Developer mode）”。</li>
              <li>点击左上角“加载已解压的扩展程序（Load unpacked）”。</li>
              <li>选择你刚才解压后的扩展目录（目录里应直接能看到 <code>manifest.json</code>）。</li>
              <li>安装完成后，建议把扩展固定到工具栏，方便在 YouTube 页面快速使用。</li>
            </ol>
          </div>
        </section>
      </main>
    </div>
  );
}
