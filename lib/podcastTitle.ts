const YOUTUBE_TITLE_PLACEHOLDERS = new Set(['untitled']);

function normalizeTitle(input: string | null | undefined): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const cleaned = input.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function stripFileExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, dotIndex);
}

export function resolveYoutubePodcastTitle(input: {
  videoTitle?: string | null;
  videoId?: string | null;
}): string {
  const normalizedTitle = normalizeTitle(input.videoTitle);
  if (normalizedTitle && !YOUTUBE_TITLE_PLACEHOLDERS.has(normalizedTitle.toLowerCase())) {
    return normalizedTitle;
  }

  const normalizedVideoId = normalizeTitle(input.videoId);
  if (normalizedVideoId) {
    return normalizedVideoId;
  }

  return 'YouTube Transcript';
}

export function resolveFilePodcastTitle(fileName: string): string {
  const baseName = normalizeTitle(stripFileExtension(fileName));
  if (baseName) {
    return baseName;
  }
  return 'Transcript';
}
