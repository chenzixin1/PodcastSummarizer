'use client';

import dynamic from 'next/dynamic';
import { useId, useRef, useState } from 'react';
import type { WatchlessArticle } from '../../lib/watchless/article';
import './watchless.css';

const WatchlessReader = dynamic(() => import('./WatchlessReader'), {
  ssr: false,
  loading: () => (
    <div className="watchless-reader-skeleton" role="status" aria-live="polite">
      <span />
      <span />
      <span />
      <p>正在准备完整图文…</p>
    </div>
  ),
});

interface WatchlessLongformSectionProps {
  articleMeta: {
    sceneCount: number;
    durationLabel: string;
    hasEnglishTranscript?: boolean;
  };
  loadArticle: () => Promise<WatchlessArticle>;
  askQuestion?: (question: string) => Promise<string>;
}

export default function WatchlessLongformSection({
  articleMeta,
  loadArticle,
  askQuestion,
}: WatchlessLongformSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [article, setArticle] = useState<WatchlessArticle | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadingArticle, setLoadingArticle] = useState(false);
  const calloutRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const regionId = useId();
  const sceneRange = `01—${String(articleMeta.sceneCount).padStart(2, '0')}`;

  const requestArticle = async () => {
    if (article || loadingArticle) return;
    setLoadingArticle(true);
    setLoadError('');
    try {
      setArticle(await loadArticle());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingArticle(false);
    }
  };

  const toggleExpanded = () => {
    if (expanded) {
      collapse();
      return;
    }
    setExpanded(true);
    void requestArticle();
  };

  const collapse = () => {
    setExpanded(false);
    window.requestAnimationFrame(() => {
      calloutRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      triggerRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <section className="watchless-surface watchless-longform-section">
      <section ref={calloutRef} className="watchless-expand-callout" aria-labelledby={`${regionId}-title`}>
        <div className="watchless-expand-index" aria-hidden="true">{sceneRange}</div>
        <div>
          <p className="watchless-section-label">Watchless 完整图文</p>
          <h2 id={`${regionId}-title`}>
            {`沿着 ${articleMeta.sceneCount} 个场景，继续读完这段 ${articleMeta.durationLabel}的完整内容`}
          </h2>
          <p>{articleMeta.hasEnglishTranscript === false
            ? '关键帧、中文编辑稿与原视频时间码已经对齐。'
            : '关键帧、中文编辑稿、英文 Transcript 与原视频时间码已经对齐。'}</p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          aria-controls={regionId}
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          {expanded ? '收起完整图文' : '继续阅读完整图文'}
          <span aria-hidden="true">{expanded ? '↑' : '↓'}</span>
        </button>
      </section>

      <div
        id={regionId}
        className={`watchless-expand-region ${expanded ? 'is-open' : ''}`}
        aria-hidden={!expanded}
      >
        <div>
          {article ? (
            <WatchlessReader
              article={article}
              askQuestion={askQuestion}
              onCollapse={collapse}
            />
          ) : loadError ? (
            <div className="watchless-reader-load-error" role="alert">
              <p>完整图文加载失败：{loadError}</p>
              <button type="button" onClick={() => void requestArticle()}>重新加载</button>
            </div>
          ) : (
            <div className="watchless-reader-skeleton" role="status" aria-live="polite">
              <span />
              <span />
              <span />
              <p>正在准备完整图文…</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
