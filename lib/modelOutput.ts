/** Keep only the provider's final answer, never its optional reasoning channel. */
export function finalModelText(text: string): string {
  const closingTags = [...text.matchAll(/<\/think\s*>/gi)];
  const last = closingTags.at(-1);
  const answer = (last ? text.slice(last.index! + last[0].length) : text).trim();
  if (!answer || /<think(?:\s[^>]*)?>/i.test(answer)) {
    throw new Error('Model final answer incomplete');
  }
  return answer;
}
