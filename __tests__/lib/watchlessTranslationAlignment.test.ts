/** @jest-environment node */
import { alignTranslatedBlocks } from '../../lib/watchless/bilingual';
describe('identity-aligned translation without lost turns',()=>{
  test('numeric/string ids and returned order cannot reorder the source',()=>{
    expect(alignTranslatedBlocks([{id:'2',text:'C'},{id:0,text:'A'},{id:'1',text:'B'}],3)).toEqual(['A','B','C']);
  });
  test.each([
    [[{id:0,text:'A'}],2],
    [[{id:0,text:'A'},{id:'0',text:'B'}],2],
    [[{id:2,text:'A'}],1],
    [[{id:'01',text:'A'}],1],
    [[{id:0,text:''}],1],
    [[{id:-1,text:'A'}],1],
    [[{id:0.5,text:'A'}],1],
    [[null],1],
  ])('missing, duplicate, malformed or empty turns fail closed (%p)',(rows,count)=>{
    expect(()=>alignTranslatedBlocks(rows,count as number)).toThrow();
  });
});
