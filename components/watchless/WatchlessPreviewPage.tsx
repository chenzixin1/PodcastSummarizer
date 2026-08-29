'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { sampleWatchlessPreview } from '../../lib/watchless/samplePreview';
import AppHeader from '../AppHeader';
import WatchlessLongformSection from './WatchlessLongformSection';

type AnalysisTab = 'summary' | 'fullText' | 'mindMap' | 'infographic';
type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'podsum-theme-mode';
const ANALYSIS_TABS: Array<{ value: AnalysisTab; label: string }> = [
  { value: 'summary', label: 'Summary' },
  { value: 'fullText', label: 'Full Text' },
  { value: 'mindMap', label: 'Mind Map' },
  { value: 'infographic', label: 'Infographic' },
];

async function answerPreviewQuestion() {
  return `这篇公开阅读样例包含 ${sampleWatchlessPreview.sceneCount} 个场景；问答接口接入 Watchless 发布流程后，回答会引用完整图文与对应时间码。`;
}

async function loadSampleArticle() {
  const { sampleWatchlessArticle } = await import('../../lib/watchless/sample');
  return sampleWatchlessArticle;
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <circle cx="6" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 5h2a4 4 0 0 1 4 4v5a4 4 0 0 0 4 4M14 10V9a2 2 0 0 1 2-2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path d="M6 3.5h8l4 4v13H6v-17Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function SourceSummary() {
  const article = sampleWatchlessPreview;
  return (
    <section className="watchless-analysis-source is-compact">
      <div className="watchless-analysis-cover">
        <Image
          src={article.firstScene.keyframe}
          alt={article.firstScene.keyframeAlt}
          width={1920}
          height={960}
          priority
          sizes="(max-width: 900px) 100vw, 720px"
        />
        <span>{article.durationLabel}</span>
      </div>
      <div className="watchless-analysis-meta">
        <p>Source · YouTube</p>
        <h1>{article.title}</h1>
        <span>{article.sourceName} · {article.sceneCount} scenes · {article.durationLabel}</span>
        <div>
          <a href={article.sourceUrl} target="_blank" rel="noreferrer">打开原视频 ↗</a>
          <a href={article.pdfUrl} target="_blank" rel="noreferrer">PDF</a>
        </div>
      </div>
    </section>
  );
}

function AnalysisSummary() {
  return (
    <section className="watchless-analysis-grid" aria-labelledby="analysis-summary-title">
      <article className="watchless-analysis-main">
        <p className="watchless-section-label">Summary</p>
        <h2 id="analysis-summary-title">AI 时代的创业公司，不能只是旧模板加上更多 Codex</h2>
        <p>{sampleWatchlessPreview.summaryZh}</p>
        <blockquote>“你完全可以从现在开始做那些需要未来模型更聪明或更便宜才能成立的事情。”</blockquote>
        <h3>三个核心判断</h3>
        <ul>
          <li><span>01</span>小团队、快速周期与指数增长，正在重写创业起点。</li>
          <li><span>02</span>使命需要把智能、能源、芯片和组织激励放在同一条关键路径上。</li>
          <li><span>03</span>真实趋势来自持续、深入的使用，而不是一次性的声量。</li>
        </ul>
      </article>
      <aside className="watchless-analysis-side">
        <p>About this analysis</p>
        <dl>
          <div><dt>Scenes</dt><dd>{sampleWatchlessPreview.sceneCount}</dd></div>
          <div><dt>Language</dt><dd>中文 / English</dd></div>
          <div><dt>Status</dt><dd><span>Completed</span></dd></div>
        </dl>
        <details>
          <summary>文件信息</summary>
          <p>YouTube Video ID<br /><strong>{sampleWatchlessPreview.videoId}</strong></p>
        </details>
      </aside>
    </section>
  );
}

function PlaceholderAnalysis({ tab }: { tab: Exclude<AnalysisTab, 'summary'> }) {
  const copy = {
    fullText: {
      label: 'Full Text',
      title: '带时间码的完整文本',
      description: '现有 PodSum 全文视图保持不变；页面下方提供带关键帧的完整图文阅读。',
      icon: <PageIcon />,
    },
    mindMap: {
      label: 'Mind Map',
      title: '从指数增长到真实趋势',
      description: '思维导图继续负责快速建立结构，完整图文负责按场景深入阅读。',
      icon: <BranchIcon />,
    },
    infographic: {
      label: 'Infographic',
      title: '一页图解',
      description: '信息图入口保持不变，完整图文在分析内容之后按需展开。',
      icon: <PageIcon />,
    },
  }[tab];

  return (
    <section className="watchless-placeholder-analysis">
      <span>{copy.icon}</span>
      <p>{copy.label}</p>
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <div aria-hidden="true"><span /><span /><span /><span /></div>
    </section>
  );
}

export default function WatchlessPreviewPage() {
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('summary');
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') {
      setThemeMode(saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setThemeMode('dark');
    }
  }, []);

  const updateTheme = (next: ThemeMode) => {
    setThemeMode(next);
    window.localStorage.setItem(THEME_KEY, next);
  };

  return (
    <div className="dashboard-shell watchless-preview-shell min-h-screen" data-theme={themeMode}>
      <AppHeader
        currentLabel={sampleWatchlessPreview.title}
        themeMode={themeMode}
        onThemeToggle={updateTheme}
        showViewTabs={false}
      />
      <main className="watchless-surface watchless-preview-main">
        <p className="watchless-preview-kicker">完整图文 · Watchless 阅读样例</p>
        <SourceSummary />

        <div className="watchless-analysis-tabs" role="tablist" aria-label="PodSum 内容视图">
          {ANALYSIS_TABS.map((tab) => (
            <button
              key={tab.value}
              id={`watchless-tab-${tab.value}`}
              type="button"
              role="tab"
              aria-controls="watchless-analysis-panel"
              aria-selected={analysisTab === tab.value}
              onClick={() => setAnalysisTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id="watchless-analysis-panel"
          role="tabpanel"
          aria-labelledby={`watchless-tab-${analysisTab}`}
          tabIndex={0}
        >
          {analysisTab === 'summary' ? <AnalysisSummary /> : <PlaceholderAnalysis tab={analysisTab} />}
        </div>

        <WatchlessLongformSection
          articleMeta={sampleWatchlessPreview}
          loadArticle={loadSampleArticle}
          askQuestion={answerPreviewQuestion}
        />
      </main>
    </div>
  );
}
