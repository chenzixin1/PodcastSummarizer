'use client';

import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  annotateEnglishWithHints,
  buildHintDictionaryCard,
  type AdvancedWordDict,
} from '../../lib/vocabHint';
import {
  extractDialogueSpeakerLabels,
  formatSceneTimestamp,
  formatDialogueTurns,
  youtubeAtTimeUrl,
  type WatchlessArticle,
  type WatchlessLanguageMode,
  type WatchlessScene,
} from '../../lib/watchless/article';

interface WatchlessReaderProps {
  article: WatchlessArticle;
  askQuestion?: (question: string) => Promise<string>;
  onCollapse?: () => void;
}

const LANGUAGE_OPTIONS: Array<{ value: WatchlessLanguageMode; label: string; detail: string }> = [
  { value: 'zh', label: '中文', detail: '编辑稿' },
  { value: 'en', label: 'English', detail: 'Transcript' },
  { value: 'bilingual', label: '中英对照', detail: '逐场景' },
  { value: 'hint', label: '词汇提示', detail: 'English' },
];

const HINT_HASH_PREFIX = '#pronounce:';

function ArrowIcon({ direction = 'right' }: { direction?: 'left' | 'right' | 'down' }) {
  const rotation = direction === 'left' ? 'rotate(180 10 10)' : direction === 'down' ? 'rotate(90 10 10)' : undefined;
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        d="M5 10h10m-3.5-3.5L15 10l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
        transform={rotation}
      />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path d="M7.8 12.2 12.2 7.8M6.4 9.1 4.8 10.7a3 3 0 0 0 4.2 4.2l1.6-1.6M13.6 10.9l1.6-1.6A3 3 0 0 0 11 5.1L9.4 6.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path d="M5 3.7h6l4 4v8.6H5V3.7Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M11 3.7v4h4M7.3 12h5.4M7.3 14.4h3.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
      <path d="M4 4.5h12v8H9l-3.5 3v-3H4v-8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M7 7.2h6M7 9.7h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
    </svg>
  );
}

function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function HintTranscript({ markdown, dictionary }: { markdown: string; dictionary: AdvancedWordDict }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => (url.startsWith(HINT_HASH_PREFIX) ? url : defaultUrlTransform(url))}
      components={{
        a({ href, children }) {
          if (href?.startsWith(HINT_HASH_PREFIX)) {
            const word = decodeURIComponent(href.slice(HINT_HASH_PREFIX.length)).toLowerCase();
            const card = buildHintDictionaryCard(word, dictionary[word]);
            if (!card) {
              return <>{children}</>;
            }
            return (
              <button type="button" className="watchless-hint-word" aria-label={`${card.word}：查看词汇释义`}>
                <span>{children}</span>
                <span className="watchless-hint-tooltip" role="tooltip">
                  <span className="watchless-hint-headword">{card.word}</span>
                  <span className="watchless-hint-level">{dictionary[word]?.level?.slice(0, 3).join(' · ')}</span>
                  {card.senses.slice(0, 3).map((sense, index) => (
                    <span key={`${sense.pos}-${index}`} className="watchless-hint-sense">
                      <span>{sense.pos}</span> {sense.meaning}
                    </span>
                  ))}
                </span>
              </button>
            );
          }
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function LanguageSelector({
  value,
  onChange,
  availableModes,
  compact = false,
}: {
  value: WatchlessLanguageMode;
  onChange: (next: WatchlessLanguageMode) => void;
  availableModes: WatchlessLanguageMode[];
  compact?: boolean;
}) {
  return (
    <div className={`watchless-language-switch ${compact ? 'is-compact' : ''}`} role="group" aria-label="文章语言">
      {LANGUAGE_OPTIONS.filter((option) => availableModes.includes(option.value)).map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={value === option.value ? 'is-active' : undefined}
        >
          <span>{option.label}</span>
          {!compact ? <small>{option.detail}</small> : null}
        </button>
      ))}
    </div>
  );
}

function ArticleToc({ article, activeScene }: { article: WatchlessArticle; activeScene: string }) {
  return (
    <nav aria-label="场景目录" className="watchless-toc">
      <p className="watchless-toc-kicker">场景目录</p>
      <ol>
        {article.scenes.map((scene) => (
          <li key={scene.id}>
            <a href={`#${scene.id}`} aria-current={activeScene === scene.id ? 'location' : undefined}>
              <span>{String(scene.number).padStart(2, '0')}</span>
              <span>
                <strong>{scene.titleZh}</strong>
                <small>{scene.timeLabel}</small>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function MobileToc({ article, activeScene }: { article: WatchlessArticle; activeScene: string }) {
  const active = article.scenes.find((scene) => scene.id === activeScene) ?? article.scenes[0];
  return (
    <details className="watchless-mobile-toc">
      <summary>
        <span>
          <small>场景目录</small>
          <strong>{String(active.number).padStart(2, '0')} · {active.titleZh}</strong>
        </span>
        <ArrowIcon direction="down" />
      </summary>
      <ArticleToc article={article} activeScene={activeScene} />
    </details>
  );
}

function SceneFigure({ article, scene, priority }: { article: WatchlessArticle; scene: WatchlessScene; priority: boolean }) {
  return (
    <figure className="watchless-scene-figure">
      <a
        href={youtubeAtTimeUrl(article.videoId, scene.startSec)}
        target="_blank"
        rel="noreferrer"
        aria-label={`从 ${formatSceneTimestamp(scene.startSec)} 在 YouTube 打开第 ${scene.number} 场景`}
      >
        <Image
          src={scene.keyframe}
          alt={scene.keyframeAlt}
          width={1920}
          height={960}
          sizes="(max-width: 820px) 100vw, 820px"
          priority={priority}
        />
        <span className="watchless-frame-time">{formatSceneTimestamp(scene.startSec)} <ArrowIcon direction="right" /></span>
      </a>
      <figcaption>{scene.visualDescriptionZh.replace(/\*\*/g, '')}</figcaption>
    </figure>
  );
}

function SceneContent({
  article,
  scene,
  language,
  hintMarkdown,
  dictionary,
  priority,
  dialogueSpeakerLabels,
}: {
  article: WatchlessArticle;
  scene: WatchlessScene;
  language: WatchlessLanguageMode;
  hintMarkdown?: string;
  dictionary: AdvancedWordDict | null;
  priority: boolean;
  dialogueSpeakerLabels: string[];
}) {
  const showChinese = language === 'zh' || language === 'bilingual';
  const showEnglish = language === 'en' || language === 'bilingual' || language === 'hint';
  return (
    <section id={scene.id} data-watchless-scene className="watchless-scene" aria-labelledby={`${scene.id}-title`}>
      <header className="watchless-scene-header">
        <span className="watchless-scene-number" aria-hidden="true">{String(scene.number).padStart(2, '0')}</span>
        <div>
          <p>{scene.timeLabel}</p>
          <h2 id={`${scene.id}-title`}>{scene.titleZh}</h2>
        </div>
      </header>

      <SceneFigure article={article} scene={scene} priority={priority} />

      <div className={`watchless-scene-copy ${language === 'bilingual' ? 'is-bilingual' : ''}`}>
        {showChinese ? (
          <article className="watchless-copy-column" lang="zh-CN">
            {language === 'bilingual' ? <p className="watchless-copy-label">中文编辑稿</p> : null}
            <Markdown className="watchless-prose watchless-prose-zh">
              {formatDialogueTurns(scene.articleZh, dialogueSpeakerLabels)}
            </Markdown>
          </article>
        ) : null}

        {showEnglish ? (
          <article className="watchless-copy-column" lang="en">
            <p className="watchless-copy-label">Transcript · Original English</p>
            <div className="watchless-prose watchless-prose-en">
              {language === 'hint' && dictionary && hintMarkdown ? (
                <HintTranscript markdown={hintMarkdown} dictionary={dictionary} />
              ) : (
                <Markdown>{scene.transcriptEn}</Markdown>
              )}
            </div>
            <p className="watchless-boundary-note">
              <span>Scene boundary</span>{scene.boundaryReasonEn}
            </p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function QaLauncher({ onAsk }: { onAsk: (question: string) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || sending) return;

    setSending(true);
    setError('');
    setAnswer('');

    try {
      setAnswer(await onAsk(normalizedQuestion));
      setQuestion('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`watchless-qa ${open ? 'is-open' : ''}`}>
      {open ? (
        <aside aria-label="询问这篇完整图文" className="watchless-qa-panel">
          <div>
            <p>问这篇完整图文</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="收起问答助手">×</button>
          </div>
          <p className="watchless-qa-intro">问题会关联场景、时间码和两种语言内容。</p>
          <form onSubmit={submit}>
            <label htmlFor="watchless-question" className="sr-only">输入问题</label>
            <textarea
              id="watchless-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：Sam 如何判断真实趋势？"
              rows={3}
            />
            <button type="submit" disabled={sending}>{sending ? '回答中…' : '提问'}</button>
          </form>
          {answer ? <p className="watchless-qa-answer" aria-live="polite">{answer}</p> : null}
          {error ? <p className="watchless-qa-answer is-error" role="alert">{error}</p> : null}
        </aside>
      ) : null}
      <button
        type="button"
        className="watchless-qa-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <QuestionIcon />
        <span>问图文</span>
      </button>
    </div>
  );
}

function CompactSourceDock({
  article,
  language,
  onLanguageChange,
  progress,
  availableModes,
}: {
  article: WatchlessArticle;
  language: WatchlessLanguageMode;
  onLanguageChange: (value: WatchlessLanguageMode) => void;
  progress: number;
  availableModes: WatchlessLanguageMode[];
}) {
  return (
    <div className="watchless-source-dock" aria-label="紧凑来源栏">
      <span className="watchless-source-progress" style={{ transform: `scaleX(${progress})` }} />
      <div>
        <span className="watchless-dock-mark">W</span>
        <span className="watchless-dock-title">
          <small>{article.sourceName}</small>
          <strong>{article.title}</strong>
        </span>
      </div>
      {availableModes.length > 1 ? (
        <LanguageSelector value={language} onChange={onLanguageChange} availableModes={availableModes} compact />
      ) : null}
      <a href={article.sourceUrl} target="_blank" rel="noreferrer" className="watchless-dock-source">
        <SourceIcon /><span>来源</span>
      </a>
    </div>
  );
}

function SourceHero({ article, heroRef }: { article: WatchlessArticle; heroRef: React.RefObject<HTMLElement | null> }) {
  const heroScene = article.scenes[0];

  return (
    <section ref={heroRef} className="watchless-source-hero" aria-labelledby="watchless-article-title">
      <div className="watchless-video-wrap">
        <a
          href={article.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="watchless-video-link"
          aria-label={`在 YouTube 打开原视频：${article.title}`}
        >
          <Image
            src={heroScene.keyframe}
            alt={heroScene.keyframeAlt}
            width={1920}
            height={960}
            sizes="(max-width: 900px) 100vw, 72vw"
            priority
          />
          <span className="watchless-video-link-label" aria-hidden="true">
            在 YouTube 打开 <ArrowIcon direction="right" />
          </span>
        </a>
      </div>
      <div className="watchless-source-meta">
        <p className="watchless-eyebrow">{article.eyebrow}</p>
        <h2 id="watchless-article-title">{article.titleZh}</h2>
        <p className="watchless-original-title">{article.title}</p>
        <dl>
          <div><dt>来源</dt><dd>{article.sourceName}</dd></div>
          <div><dt>时长</dt><dd>{article.durationLabel}</dd></div>
          <div><dt>结构</dt><dd>{article.publishedLabel}</dd></div>
        </dl>
        <div className="watchless-source-actions">
          <a href={article.sourceUrl} target="_blank" rel="noreferrer"><SourceIcon />打开原视频</a>
          <a href={article.pdfUrl} target="_blank" rel="noreferrer"><PdfIcon />阅读 PDF</a>
        </div>
      </div>
    </section>
  );
}

export default function WatchlessReader({
  article,
  askQuestion,
  onCollapse,
}: WatchlessReaderProps) {
  const [language, setLanguage] = useState<WatchlessLanguageMode>('zh');
  const [activeScene, setActiveScene] = useState(article.scenes[0].id);
  const [compactSource, setCompactSource] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dictionary, setDictionary] = useState<AdvancedWordDict | null>(null);
  const [dictionaryError, setDictionaryError] = useState('');
  const availableLanguageModes = article.availableLanguageModes?.length
    ? article.availableLanguageModes
    : LANGUAGE_OPTIONS.map((option) => option.value);
  const hasEnglishTranscript = availableLanguageModes.includes('en');
  const heroRef = useRef<HTMLElement | null>(null);
  const articleRef = useRef<HTMLDivElement | null>(null);
  const dialogueSpeakerLabels = useMemo(
    () => extractDialogueSpeakerLabels(article.scenes.map((scene) => scene.articleZh)),
    [article.scenes],
  );

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCompactSource(!entry.isIntersecting),
      { rootMargin: '-84px 0px 0px', threshold: 0.03 }
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-watchless-scene]'));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveScene(visible.target.id);
      },
      { rootMargin: '-20% 0px -64% 0px', threshold: [0.02, 0.2, 0.45] }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const root = articleRef.current;
      if (!root) return;
      const start = root.getBoundingClientRect().top + window.scrollY;
      const end = start + root.offsetHeight - window.innerHeight;
      setProgress(Math.min(1, Math.max(0, (window.scrollY - start) / Math.max(1, end - start))));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const selectLanguage = useCallback((next: WatchlessLanguageMode) => {
    setLanguage(next);
    if (next !== 'hint' || dictionary) return;
    setDictionaryError('');
    fetch('/vocab/advanced-words.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<AdvancedWordDict>;
      })
      .then(setDictionary)
      .catch((error: unknown) => setDictionaryError(error instanceof Error ? error.message : String(error)));
  }, [dictionary]);

  const hintTranscripts = useMemo(() => {
    if (language !== 'hint' || !dictionary) return new Map<string, string>();
    return new Map(
      article.scenes.map((scene) => [
        scene.id,
        annotateEnglishWithHints(scene.transcriptEn, dictionary, {
          maxHintsPerParagraph: 5,
          interactionMode: 'pronounceLink',
        }),
      ])
    );
  }, [article.scenes, dictionary, language]);

  return (
    <div ref={articleRef} className="watchless-reader watchless-reader-embedded">
      <SourceHero article={article} heroRef={heroRef} />
      {compactSource ? (
        <CompactSourceDock
          article={article}
          language={language}
          onLanguageChange={selectLanguage}
          progress={progress}
          availableModes={availableLanguageModes}
        />
      ) : null}

      <section className="watchless-reader-intro" aria-labelledby="watchless-intro-title">
        <div>
          <p className="watchless-section-label">编辑导读</p>
          <h2 id="watchless-intro-title">{`先建立一张地图，再进入 ${article.durationLabel}的完整内容`}</h2>
        </div>
        <Markdown className="watchless-intro-copy">{language === 'en' || language === 'hint' ? article.summaryEn : article.summaryZh}</Markdown>
      </section>

      <div className="watchless-reader-toolbar">
        <div>
          <p>阅读语言</p>
          <span>{language === 'zh' ? 'Watchless 中文编辑稿' : language === 'bilingual' ? '逐场景双栏对照' : '按场景边界整理的原始字幕'}</span>
        </div>
        {availableLanguageModes.length > 1 ? (
          <LanguageSelector value={language} onChange={selectLanguage} availableModes={availableLanguageModes} />
        ) : null}
      </div>
      {language === 'hint' && !dictionary && !dictionaryError ? <p className="watchless-hint-status" aria-live="polite">正在加载现有 PodSum 词表…</p> : null}
      {language === 'hint' && dictionaryError ? <p className="watchless-hint-status is-error">词表加载失败，已显示英文原文：{dictionaryError}</p> : null}

      <MobileToc article={article} activeScene={activeScene} />

      <div className="watchless-reader-grid">
        <aside className="watchless-toc-column">
          <ArticleToc article={article} activeScene={activeScene} />
        </aside>
        <article className="watchless-article-flow">
          {article.scenes.map((scene, index) => (
            <SceneContent
              key={scene.id}
              article={article}
              scene={scene}
              language={language}
              hintMarkdown={hintTranscripts.get(scene.id)}
              dictionary={dictionary}
              priority={index === 0}
              dialogueSpeakerLabels={dialogueSpeakerLabels}
            />
          ))}
          <footer className="watchless-article-footer">
            <p className="watchless-section-label">阅读完成</p>
            <h2>从原视频到可复用的知识资产</h2>
            <p>{hasEnglishTranscript
              ? '完整时间线、关键帧、中文编辑稿与英文 Transcript 都保留在同一篇内容中，方便继续回看和引用。'
              : '完整时间线、关键帧与中文编辑稿都保留在同一篇内容中，方便继续回看和引用。'}</p>
            <div>
              <a href={article.sourceUrl} target="_blank" rel="noreferrer"><SourceIcon />原视频</a>
              <a href={article.pdfUrl} target="_blank" rel="noreferrer"><PdfIcon />PDF</a>
              <a href="#watchless-article-title">回到顶部 ↑</a>
            </div>
          </footer>
        </article>
      </div>

      {onCollapse ? (
        <div className="watchless-collapse-row">
          <button type="button" onClick={onCollapse}>收起完整图文 <ArrowIcon direction="down" /></button>
        </div>
      ) : null}
      {askQuestion ? <QaLauncher onAsk={askQuestion} /> : null}
    </div>
  );
}
