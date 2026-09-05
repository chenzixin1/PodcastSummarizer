import { NextRequest,NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { tickAnalysisRecovery,pauseAnalysisRecovery,saveAnalysisRecoveryResult } from '../../../../../lib/watchless/analysisRecovery';

export async function POST(request:NextRequest) {
  const expected=process.env.WATCHLESS_INTERNAL_SECRET || '';
  const actual=request.headers.get('x-watchless-internal-secret') || '';
  if(!expected || Buffer.byteLength(actual)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))
    return NextResponse.json({error:'Unauthorized'},{status:401});
  const body=await request.json().catch(()=>null);
  if(!/^[a-f0-9]{64}$/.test(body?.runId || '') || !/^analysis-[a-f0-9]{32}-\d+$/.test(body?.owner || '') || !['tick','pause','pause-result','save'].includes(body?.action))
    return NextResponse.json({error:'Invalid analysis command'},{status:400});
  try {
    const result=body.action==='tick'?await tickAnalysisRecovery(body.runId,body.owner):body.action==='save'
      ?await saveAnalysisRecoveryResult(body.runId,body.owner,body.pending):await pauseAnalysisRecovery(body.runId,body.owner,body.action==='pause-result');
    return NextResponse.json(result || {done:true,status:'missing',waitMs:0},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    console.error('Analysis transition interrupted',error instanceof Error?error.message:'unknown');
    return NextResponse.json({error:'Analysis state unavailable'},{status:503});
  }
}
