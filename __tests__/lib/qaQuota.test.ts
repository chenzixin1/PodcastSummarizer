/** @jest-environment node */
import { consumeQaRequestQuota, QA_REQUESTS_PER_HOUR } from '../../lib/qaQuota';
import { sql } from '../../lib/sql';
const { DatabaseSync } = jest.requireActual('node:sqlite');
jest.mock('../../lib/sql', () => ({ isD1DatabaseProvider: () => true, sql: jest.fn() }));
describe('atomic per-account inference quota', () => {
  let database: InstanceType<typeof DatabaseSync>;
  beforeEach(() => {
    jest.clearAllMocks(); jest.spyOn(Date,'now').mockReturnValue(3600000000);
    database=new DatabaseSync(':memory:');
    database.exec('CREATE TABLE qa_request_limits(user_id TEXT PRIMARY KEY,window_start INTEGER,request_count INTEGER)');
    (sql as jest.Mock).mockImplementation(async (strings:TemplateStringsArray,...values:unknown[])=>({rows:database.prepare(strings.join('?')).all(...values)}));
  });
  afterEach(()=>{database.close();jest.restoreAllMocks();});
  test('concurrent attempts cannot exceed 30; a different user has a separate quota',async()=>{
    const results=await Promise.all(Array.from({length:50},()=>consumeQaRequestQuota('alice')));
    expect(results.filter(Boolean)).toHaveLength(QA_REQUESTS_PER_HOUR);
    expect(database.prepare('SELECT request_count FROM qa_request_limits').get().request_count).toBe(30);
    expect(await consumeQaRequestQuota('bob')).toBe(true);
  });
  test('new hour resets in the same row without growing the table',async()=>{
    for(let i=0;i<30;i++) await consumeQaRequestQuota('alice');
    expect(await consumeQaRequestQuota('alice')).toBe(false);
    jest.spyOn(Date,'now').mockReturnValue(3603600000);
    expect(await consumeQaRequestQuota('alice')).toBe(true);
    expect(database.prepare('SELECT request_count FROM qa_request_limits').all()).toEqual([{request_count:1}]);
  });
  test('empty user fails before accessing storage',async()=>{
    expect(await consumeQaRequestQuota('')).toBe(false);expect(sql).not.toHaveBeenCalled();
  });
  test('database unavailable fails closed before caller can pay',async()=>{
    (sql as jest.Mock).mockRejectedValue(new Error('database unavailable'));
    await expect(consumeQaRequestQuota('alice')).rejects.toThrow('database unavailable');
  });
});
