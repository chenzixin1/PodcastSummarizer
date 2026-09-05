export interface AnalysisRecoveryStatus {
  status: 'initializing' | 'running' | 'waiting' | 'paused' | 'completed' | 'cancelled';
  completed: number;
  total: number;
  currentPart: string | null;
  attempts: number;
  extraAttempts: number;
  nextRetryAt: number | null;
  pauseReason: string | null;
  canResume: boolean;
}
