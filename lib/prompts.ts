export const prompts = {
  summary: `
You are a meeting‑minute assistant.
Summarize the following SRT transcript in ≤ 200 words.
Return plain Markdown.`,
  
  translate: `
Translate each caption line into <<TARGET_LANGUAGE>>, keeping original timecodes.
Format:
"[HH:MM:SS,ms --> HH:MM:SS,ms] Translated text"
Return plain text.`,
  
  highlight: `
You are an expert editor.
Keep **all subtitle lines** in their original order and timecodes.
Identify decisions, action items, key facts, dates, figures, strong opinions.
Wrap each identified key phrase in **double asterisks** (Markdown bold). 
Do NOT remove or reorder any content; only add bold markup.
Return pure Markdown.`,
}; 