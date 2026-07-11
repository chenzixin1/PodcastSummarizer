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
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

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
    <div className="relative flex aspect-video h-full min-h-[220px] w-full overflow-hidden bg-[#141814] text-white sm:min-h-[320px] lg:min-h-[520px]">
      <img
        src={thumbnailUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-55"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/25" />
      <div className="relative z-10 flex w-full flex-col justify-between p-5 sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">YouTube Source</p>
          <h3 className="mt-3 max-w-2xl text-xl font-semibold leading-7 sm:text-2xl">{title.replace(/^Original video for\s+/i, '')}</h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/75">
            YouTube may require sign-in or bot verification inside embedded players. Open the video on YouTube for the most reliable playback.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#18392f] transition-colors hover:bg-white/90"
          >
            Open on YouTube
          </a>
          <button
            type="button"
            onClick={() => setActive(true)}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/35 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Try embedded playback
          </button>
        </div>
      </div>
    </div>
  );
}
