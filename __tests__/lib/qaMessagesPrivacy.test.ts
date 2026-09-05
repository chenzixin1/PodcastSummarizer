/** @jest-environment node */
import { getQaMessages, saveQaMessage } from '../../lib/qaMessages';
import { sql } from '../../lib/sql';
const { DatabaseSync } = jest.requireActual('node:sqlite');
let mockDatabase: InstanceType<typeof DatabaseSync>;
jest.mock('../../lib/sql', () => ({ isD1DatabaseProvider: () => true, sql: jest.fn() }));
jest.mock('nanoid', () => ({ nanoid: () => 'new-qa-id' }));

describe('strict per-user QA history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabase = new DatabaseSync(':memory:');
    mockDatabase.exec(`CREATE TABLE qa_messages (
      id TEXT PRIMARY KEY, podcast_id TEXT NOT NULL, user_id TEXT,
      question TEXT NOT NULL, answer TEXT NOT NULL, suggested_question INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    const seed = mockDatabase.prepare('INSERT INTO qa_messages (id,podcast_id,user_id,question,answer,created_at) VALUES (?,?,?,?,?,?)');
    for (const [id, podcast, user] of [
      ['alice-1', 'public-podcast', 'alice'], ['bob-1', 'public-podcast', 'bob'],
      ['unowned-1', 'public-podcast', null], ['empty-1', 'public-podcast', ''],
      ['alice-other', 'other-podcast', 'alice'], ['alice-2', 'public-podcast', 'alice'],
    ]) seed.run(id, podcast, user, `Question ${id}`, `Private answer ${id}`, `2026-09-06 00:00:0${id === 'alice-2' ? 2 : 1}`);
    (sql as jest.Mock).mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => ({
      rows: mockDatabase.prepare(strings.join('?')).all(...values.map(value => typeof value === 'boolean' ? Number(value) : value)),
    }));
  });
  afterEach(() => mockDatabase.close());

  test('only returns this user and this podcast, preserving chronological order', async () => {
    const result = await getQaMessages('public-podcast', 'alice');
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({ id: 'alice-1', podcastId: 'public-podcast', userId: 'alice' }),
      expect.objectContaining({ id: 'alice-2', podcastId: 'public-podcast', userId: 'alice' }),
    ]);
    expect((await getQaMessages('public-podcast', 'bob')).data).toEqual([expect.objectContaining({ id: 'bob-1' })]);
    expect((await getQaMessages('public-podcast', 'new-user')).data).toEqual([]);
    expect(mockDatabase.prepare('SELECT COUNT(*) AS count FROM qa_messages').get().count).toBe(6);
  });
  test('historical reasoning is removed on read without changing stored records', async () => {
    mockDatabase.prepare('UPDATE qa_messages SET answer = ? WHERE id = ?').run('Internal draft</think> Final answer', 'alice-1');
    mockDatabase.prepare('UPDATE qa_messages SET answer = ? WHERE id = ?').run('<think>Unfinished draft', 'alice-2');
    const result = await getQaMessages('public-podcast', 'alice');
    expect(result.data).toEqual([
      expect.objectContaining({ id: 'alice-1', answer: 'Final answer' }),
      expect.objectContaining({ id: 'alice-2', answer: '这条历史回答不完整，请重新提问。' }),
    ]);
    expect(mockDatabase.prepare('SELECT answer FROM qa_messages WHERE id = ?').get('alice-1').answer).toBe('Internal draft</think> Final answer');
  });
  test.each([undefined, null, '', '  ', 30])('missing or legacy positional identity %p fails before database access', async identity => {
    expect(await getQaMessages('public-podcast', identity as string)).toEqual({ success: false, error: 'Authentication required' });
    expect(sql).not.toHaveBeenCalled();
  });
  test('identity and podcast values are parameters, not SQL fragments', async () => {
    expect((await getQaMessages('public-podcast', "alice' OR 1=1 --")).data).toEqual([]);
    expect((await getQaMessages("public-podcast' OR 1=1 --", 'alice')).data).toEqual([]);
  });
  test.each([[-10, 1], [1.9, 1], [NaN, 30], [Infinity, 30], [5000, 200]])('limit %p remains bounded to %i after owner filtering', async (limit, expected) => {
    await getQaMessages('public-podcast', 'alice', limit);
    const args = (sql as jest.Mock).mock.calls[0];
    expect(args.slice(1)).toEqual(['public-podcast', 'alice', expected]);
  });
  test.each([undefined, null, '', '  '])('new history cannot be stored without an owner: %p', async userId => {
    expect(await saveQaMessage({ podcastId: 'public-podcast', userId, question: 'Q', answer: 'A' })).toEqual({ success: false, error: 'Authentication required' });
    expect(sql).not.toHaveBeenCalled();
    expect(mockDatabase.prepare('SELECT COUNT(*) AS count FROM qa_messages').get().count).toBe(6);
  });
  test('new answers are owned and never visible to another listener', async () => {
    const saved = await saveQaMessage({ podcastId: 'public-podcast', userId: 'alice', question: 'My question', answer: 'My private answer', suggestedQuestion: true });
    expect(saved).toMatchObject({ success: true, data: { userId: 'alice', question: 'My question', suggestedQuestion: true } });
    expect((await getQaMessages('public-podcast', 'bob')).data).toEqual([expect.objectContaining({ id: 'bob-1' })]);
    expect(mockDatabase.prepare('SELECT COUNT(*) AS count FROM qa_messages').get().count).toBe(7);
    expect(mockDatabase.prepare('SELECT COUNT(*) AS count FROM qa_messages WHERE user_id IS NULL').get().count).toBe(1);
  });
});
