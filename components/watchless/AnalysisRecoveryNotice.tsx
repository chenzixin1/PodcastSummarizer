'use client';

import type { AnalysisRecoveryStatus } from '../../lib/watchless/recoveryTypes';

export default function AnalysisRecoveryNotice({ recovery, error, completed, total, busy, canEdit, onResume }: {
  recovery?: AnalysisRecoveryStatus | null; error: string | null; completed: number; total: number;
  busy: boolean; canEdit: boolean; onResume: () => void;
}) {
  if (!error && !recovery) return null;
  if (recovery?.status === 'completed') return null;
  const reason = recovery?.pauseReason || error;
  return <section aria-label="完整分析状态" className="mb-4 rounded-xl border border-[var(--border-soft)] bg-[var(--paper-muted)] p-4 text-sm text-[var(--text-secondary)]">
    <p role="status" className="font-semibold text-[var(--heading)]">
      {busy ? '完整分析处理中' : '完整分析已暂停'} · 已完成 {recovery?.completed ?? completed}/{recovery?.total ?? total} 段
    </p>
    <p className="mt-2">已有全文、图文和其他产物仍可阅读。继续时复用成功段，不重新收取 1000 积分。</p>
    {recovery?.currentPart && <p className="mt-2 break-words">当前段：{recovery.currentPart} · 已请求 {recovery.attempts}/3 次 · 全篇额外请求 {recovery.extraAttempts}/10 次</p>}
    {recovery?.nextRetryAt && <p className="mt-2">下次尝试：{new Date(recovery.nextRetryAt).toLocaleString('zh-CN')}</p>}
    {reason && <p className="mt-2 break-words">原因：{reason}</p>}
    {canEdit && <button type="button" onClick={onResume} disabled={busy || recovery?.canResume === false}
      className="mt-3 min-h-11 rounded-lg bg-[var(--btn-primary)] px-4 py-2 font-semibold text-[var(--btn-primary-text)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2">
      {busy ? '正在处理，请勿重复提交' : '继续未完成部分'}
    </button>}
  </section>;
}
