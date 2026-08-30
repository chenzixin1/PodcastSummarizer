import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);

for (const required of ['article', 'manifest', 'speaker-map', 'output']) {
  if (!args[required]) throw new Error(`Missing --${required}=...`);
}

const article = JSON.parse(fs.readFileSync(args.article, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
const speakerMapPayload = JSON.parse(fs.readFileSync(args['speaker-map'], 'utf8'));
const speakerMap = speakerMapPayload.speakers || {};

function originalTurns(transcript) {
  const source = String(transcript || '');
  const matches = [...source.matchAll(/说话人(\d+):\s*/g)];
  const turns = [];
  for (let index = 0; index < matches.length; index += 1) {
    const label = `说话人${matches[index][1]}`;
    const speaker = String(speakerMap[label] || label);
    const start = (matches[index].index || 0) + matches[index][0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const text = source.slice(start, end).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (turns.at(-1)?.speaker === speaker) {
      turns.at(-1).text += ` ${text}`;
    } else {
      turns.push({ speaker, text });
    }
  }
  if (!turns.length) throw new Error('Scene contains no original speaker turns');
  return turns;
}

if (!Array.isArray(article.scenes) || article.scenes.length !== manifest.scenes?.length) {
  throw new Error(`Scene count mismatch: article=${article.scenes?.length || 0}, manifest=${manifest.scenes?.length || 0}`);
}

const audit = { videoId: article.videoId, format: 'verbatim-speaker-turns-v1', scenes: [] };
article.scenes = article.scenes.map((scene, index) => {
  const transcriptTurns = originalTurns(manifest.scenes[index].transcript_text);
  audit.scenes.push({
    number: scene.number,
    turns: transcriptTurns.length,
    speakers: [...new Set(transcriptTurns.map((turn) => turn.speaker))],
  });
  return {
    ...scene,
    articleZh: transcriptTurns.map((turn) => `**${turn.speaker}：** ${turn.text}`).join('\n\n'),
    transcriptEn: transcriptTurns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n\n'),
  };
});
article.bodyMode = 'verbatim';
article.dialogueFormat = 'verbatim-speaker-turns-v1';
article.transcriptLanguage = 'other';
article.availableLanguageModes = ['zh'];

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, `${JSON.stringify(article, null, 2)}\n`);
fs.writeFileSync(`${args.output}.audit.json`, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({
  output: args.output,
  scenes: article.scenes.length,
  turns: audit.scenes.reduce((sum, scene) => sum + scene.turns, 0),
}, null, 2));
