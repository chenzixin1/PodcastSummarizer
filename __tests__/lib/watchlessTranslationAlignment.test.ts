/** @jest-environment node */
import { alignTranslatedBlocks, translateWatchlessBlocks } from '../../lib/watchless/bilingual';
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

test('long turn lists are sent as bounded 12-block requests and reassembled in source order',async()=>{
  const env=process.env; const originalFetch=global.fetch;
  process.env={...env,WATCHLESS_AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'test-only-token'};
  const batches:number[]=[];
  global.fetch=jest.fn(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    const inputs=JSON.parse(body.messages[1].content) as Array<{id:number;text:string}>;
    batches.push(inputs.length);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translations:inputs.map(row=>({id:String(row.id),text:`译文 ${row.text}`})).reverse()})}}]});
  });
  try {
    const inputs=Array.from({length:25},(_,i)=>`Turn ${i}`);
    expect(await translateWatchlessBlocks(inputs,'zh')).toEqual(inputs.map(text=>`译文 ${text}`));
    expect(batches).toEqual([12,12,1]);
  } finally {process.env=env; global.fetch=originalFetch;}
});
