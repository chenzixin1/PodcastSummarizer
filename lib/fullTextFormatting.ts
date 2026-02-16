// Normalize full-text notes by forcing each timestamp entry into its own markdown paragraph.
// Supports patterns like "00:00:00", "[00:00:00]", "**00:00:00**", and "**[00:00:00]**".
const FLEXIBLE_TIMESTAMP_REGEX = /(\*\*\s*)?\[?(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)\]?(\s*\*\*)?/g;
const CANONICAL_TIMESTAMP_REGEX = /\*\*\[\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?\]\*\*/g;

export const enforceLineBreaks = (text: string) => {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00A0/g, ' ');

  if (!normalized.trim()) {
    return '';
  }

  const canonicalized = normalized.replace(
    FLEXIBLE_TIMESTAMP_REGEX,
    (_match, _boldStart, timestamp) => `**[${timestamp}]**`,
  );

  const result = canonicalized.replace(CANONICAL_TIMESTAMP_REGEX, (timestamp) => `\n\n${timestamp}`);

  return result
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
