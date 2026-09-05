import fixture from '../../lib/watchless/sampleArticle.json';
import { ensureBilingualArticle, assertBilingualArticle } from '../../lib/watchless/bilingual';
import { normalizeWatchlessArticle, type WatchlessArticle } from '../../lib/watchless/article';

const chinese = '这是第一位说话人的完整原话，包含所有数字、例子与限定条件。\n\n这是另一段原话，必须保留原来的顺序。';
const english = 'This is the complete original statement, including every number, example, and qualification.\n\nThis second paragraph must remain in the original chronological order.';
const sample = () => ({...fixture, scenes:[{...fixture.scenes[0],articleZh:chinese,transcriptEn:english}]}) as WatchlessArticle;

it('preserves English original bytes and translates each paragraph without merging', async () => {
  const article = sample();
  const translate = jest.fn().mockResolvedValue(chinese.split('\n\n'));
  const result = await ensureBilingualArticle(article,translate);
  expect(result.scenes[0].transcriptEn).toBe(english);
  expect(result.scenes[0].sourceTranscript).toBe(english);
  expect(translate).toHaveBeenCalledWith(english.split('\n\n'),'zh',article.scenes[0].id);
  expect(result.bilingualVersion).toBe(1);
  expect(normalizeWatchlessArticle(result)).not.toBeNull();
});

it('restores Chinese originals from a legacy transcriptEn slot and labels English as translation', async () => {
  const article = sample();
  article.scenes[0].transcriptEn=chinese;
  article.transcriptLanguage='zh';
  article.articleZhKind='original';
  article.availableLanguageModes=['zh'];
  const result = await ensureBilingualArticle(article,async () => english.split('\n\n'));
  expect(result.scenes[0].articleZh).toBe(chinese);
  expect(result.transcriptEnKind).toBe('translation');
  expect(normalizeWatchlessArticle(result)?.availableLanguageModes).toEqual(['zh','en','bilingual','hint']);
});

it('fails closed if a translator drops a source paragraph', async () => {
  await expect(ensureBilingualArticle(sample(),async () => [chinese])).rejects.toThrow('TRANSLATION_INCOMPLETE');
});

it('does not call the translator again for a completed article', async () => {
  const article = await ensureBilingualArticle(sample(),async () => chinese.split('\n\n'));
  const translate=jest.fn();
  await ensureBilingualArticle(article,translate);
  expect(translate).not.toHaveBeenCalled();
  article.scenes[0].articleZh=english;
  expect(()=>assertBilingualArticle(article)).toThrow('BILINGUAL_INCOMPLETE');
});

it('translates a Chinese introduction inside an English interview while retaining the source', async () => {
  const article=sample();
  const intro='主持人：欢迎来到我们的访谈节目，今天请嘉宾分享创业经历。';
  article.scenes[0].transcriptEn=intro+'\n\n'+english.repeat(8);
  const original=article.scenes[0].transcriptEn;
  const result=await ensureBilingualArticle(article, async (blocks,target) => blocks.map(() => target==='zh' ? chinese.replace(/\n/g,' ') : 'Host: Welcome to our interview. Today our guest will share their experience founding a company.'));
  expect(result.scenes[0].sourceTranscript).toBe(original);
  expect(result.scenes[0].transcriptEn).toContain(english.repeat(8));
  expect(result.scenes[0].transcriptEn).not.toContain(intro);
  expect(result.transcriptEnKind).toBe('translation');
});
