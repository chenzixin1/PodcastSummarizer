#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { YoutubeTranscript } from 'youtube-transcript';

function formatTime(seconds) {
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(Math.floor(seconds % 60)).padStart(2, '0');
  const ms = String(Math.floor((seconds % 1) * 1000)).padStart(3, '0');
  return `${hrs}:${mins}:${secs},${ms}`;
}

function transcriptToSrt(transcript) {
  return transcript
    .map((item, idx) => {
      const start = formatTime(item.offset);
      const end = formatTime(item.offset + item.duration);
      const text = item.text.replace(/\n/g, ' ');
      return `${idx + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}

async function main() {
  const videoId = process.argv[2];
  const lang = process.argv[3] || 'en';
  const outDir = process.argv[4] || '.';

  if (!videoId) {
    console.error('Usage: youtube-fetch.mjs <videoUrl|id> [lang] [outputDir]');
    process.exit(1);
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang });
    if (!transcript || transcript.length === 0) {
      console.error('No transcript available');
      process.exit(1);
    }
    const srtContent = transcriptToSrt(transcript);
    const id = YoutubeTranscript.retrieveVideoId(videoId);
    const outPath = path.join(outDir, `${id}-${lang}.srt`);
    fs.writeFileSync(outPath, srtContent, 'utf8');
    console.log(`Subtitle saved to ${outPath}`);
  } catch (err) {
    console.error('Failed to fetch transcript:', err.message || err);
    process.exit(1);
  }
}

main();
