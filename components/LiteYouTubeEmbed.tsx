'use client';

import Image from 'next/image';

interface LiteYouTubeEmbedProps {
  videoId: string;
  title: string;
  compact?: boolean;
}

export default function LiteYouTubeEmbed({ videoId, title, compact = false }: LiteYouTubeEmbedProps) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const displayTitle = title.replace(/^Original video for\s+/i, '');

  return (
    <a
      href={watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`在 YouTube 打开原视频：${displayTitle}`}
      className={`group relative flex aspect-video h-full ${compact ? 'min-h-[180px]' : 'min-h-[220px] sm:min-h-[320px] lg:min-h-[520px]'} w-full overflow-hidden bg-[#141814] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white`}
    >
      <Image
        src={thumbnailUrl}
        alt=""
        fill
        priority
        unoptimized
        sizes="(max-width: 1024px) 100vw, 70vw"
        className="object-cover opacity-55 transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/25" />
      <span className="relative z-10 flex w-full flex-col justify-between p-5 sm:p-7">
        <span>
          <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/70">YouTube Source</span>
          <span className="mt-3 block max-w-2xl text-xl font-semibold leading-7 sm:text-2xl">{displayTitle}</span>
          <span className="mt-3 block max-w-xl text-sm leading-6 text-white/75">
            点击画面前往 YouTube 查看原视频。
          </span>
        </span>
        <span className="inline-flex min-h-10 w-fit items-center justify-center rounded-lg bg-white/95 px-4 py-2 text-sm font-semibold text-[#18392f] transition-colors group-hover:bg-white">
          在 YouTube 打开 ↗
        </span>
      </span>
    </a>
  );
}
