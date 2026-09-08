'use client';

import { useId, type ReactNode } from 'react';
import type { HintDictionaryCard } from '../../lib/vocabHint';

export interface HintPronunciation {
  hover(word: string): void;
  stop(): void;
  tap(word: string): void;
}

export default function WatchlessHintWord({ word, card, level, pronunciation, children }: {
  word: string;
  card: HintDictionaryCard;
  level?: string[];
  pronunciation: HintPronunciation;
  children: ReactNode;
}) {
  const tooltipId = useId();
  return (
    <button
      type="button"
      className="watchless-hint-word"
      aria-label={`${card.word}：查看释义并播放发音`}
      aria-describedby={tooltipId}
      onPointerEnter={event => { if (event.pointerType !== 'touch') pronunciation.hover(word); }}
      onPointerLeave={event => { if (event.pointerType !== 'touch') pronunciation.stop(); }}
      onPointerCancel={() => pronunciation.stop()}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) pronunciation.hover(word); }}
      onBlur={() => pronunciation.stop()}
      onClick={() => pronunciation.tap(word)}
      onKeyDown={event => { if (event.key === 'Escape') { pronunciation.stop(); event.currentTarget.blur(); } }}
    >
      <span>{children}</span>
      <span id={tooltipId} className="watchless-hint-tooltip" role="tooltip">
        <span className="watchless-hint-headword">{card.word}</span>
        <span className="watchless-hint-level">{level?.slice(0, 3).join(' · ')}</span>
        {card.senses.slice(0, 3).map((sense, index) => (
          <span key={`${sense.pos}-${index}`} className="watchless-hint-sense">
            <span>{sense.pos}</span> {sense.meaning}
          </span>
        ))}
        <span className="watchless-hint-audio-note">悬停发音 · 点按重播</span>
      </span>
    </button>
  );
}
