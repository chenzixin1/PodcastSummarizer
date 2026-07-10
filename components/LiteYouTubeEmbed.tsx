'use client';

import { useEffect, useRef, useState } from 'react';

const YOUTUBE_PERMISSION_POLICY =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

interface LiteYouTubeEmbedProps {
  videoId: string;
  title: string;
}

export default function LiteYouTubeEmbed({ videoId, title }: LiteYouTubeEmbedProps) {
  return <LiteYouTubePlayer key={videoId} videoId={videoId} title={title} />;
}

function LiteYouTubePlayer({ videoId, title }: LiteYouTubeEmbedProps) {
  const [active, setActive] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (active) {
      iframeRef.current?.focus();
    }
  }, [active]);

  if (active) {
    return (
      <iframe
        ref={iframeRef}
        src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
        title={title}
        loading="lazy"
        className="aspect-video h-full min-h-[220px] w-full bg-[#141814] sm:min-h-[320px] lg:min-h-[520px]"
        allow={YOUTUBE_PERMISSION_POLICY}
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        tabIndex={0}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Play ${title}`}
      onClick={() => setActive(true)}
      className="group relative flex aspect-video h-full min-h-[220px] w-full items-center justify-center overflow-hidden bg-[linear-gradient(145deg,#202820,#101510)] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white sm:min-h-[320px] lg:min-h-[520px]"
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12),transparent_55%)]" />
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-black/55 shadow-lg transition-transform group-hover:scale-105" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-current" focusable="false">
          <path d="M8 5.5v13l10-6.5L8 5.5Z" />
        </svg>
      </span>
    </button>
  );
}
