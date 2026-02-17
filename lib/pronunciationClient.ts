import { getPronunciationAudioUrl } from './pronunciationLibrary';

export interface PronunciationConfig {
  accent: 'en-US' | 'en-GB';
  repeatGapMs: number;
  ttsTimeoutMs: number;
  ttsRate: number;
  ttsPitch: number;
  preferRecordedAudio: boolean;
}

export interface PronunciationController {
  startHoverLoop(word: string): void;
  stop(): void;
  playTap(word: string): void;
  prime(): void;
  dispose(): void;
}

interface PronunciationDeps {
  getAudioUrl?: (word: string) => Promise<string | null>;
  speechSynthesis?: SpeechSynthesis | null;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  createAudio?: () => HTMLAudioElement;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const DEFAULT_CONFIG: PronunciationConfig = {
  accent: 'en-US',
  repeatGapMs: 900,
  ttsTimeoutMs: 2000,
  ttsRate: 0.88,
  ttsPitch: 0.84,
  preferRecordedAudio: true,
};

function normalizePronunciationWord(word: string): string {
  return String(word || '')
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z'-]+$/g, '')
    .trim();
}

function selectVoice(speech: SpeechSynthesis, accent: PronunciationConfig['accent']): SpeechSynthesisVoice | undefined {
  const voices = speech.getVoices ? speech.getVoices() : [];
  if (!Array.isArray(voices) || voices.length === 0) {
    return undefined;
  }

  const accentLower = accent.toLowerCase();
  const accentFamily = accentLower.split('-')[0] || 'en';
  const preferredNameHints = [
    'natural',
    'neural',
    'enhanced',
    'premium',
    'alex',
    'daniel',
    'samantha',
    'aria',
    'guy',
    'google us english',
  ];
  const disfavoredNameHints = [
    'espeak',
    'eloquence',
    'festival',
    'rhvoice',
    'mbrola',
    'pico',
    'robot',
    'compact',
    'novelty',
    'whisper',
  ];

  const scoreVoice = (voice: SpeechSynthesisVoice): number => {
    const lang = String(voice.lang || '').toLowerCase();
    const name = String(voice.name || '').toLowerCase();
    let score = 0;

    if (lang === accentLower) {
      score += 120;
    } else if (lang.startsWith(`${accentFamily}-`)) {
      score += 72;
    } else if (lang.startsWith('en-')) {
      score += 40;
    } else {
      score -= 120;
    }

    if (voice.localService) {
      score += 16;
    }
    if (voice.default) {
      score += 8;
    }

    for (const hint of preferredNameHints) {
      if (name.includes(hint)) {
        score += 14;
      }
    }
    for (const hint of disfavoredNameHints) {
      if (name.includes(hint)) {
        score -= 48;
      }
    }

    return score;
  };

  const sorted = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return sorted[0];
}

export function createPronunciationController(
  config: Partial<PronunciationConfig> = {},
  deps: PronunciationDeps = {}
): PronunciationController {
  const mergedConfig: PronunciationConfig = { ...DEFAULT_CONFIG, ...config };
  const getAudioUrl = deps.getAudioUrl || getPronunciationAudioUrl;
  const speech =
    deps.speechSynthesis !== undefined
      ? deps.speechSynthesis
      : typeof window !== 'undefined'
        ? window.speechSynthesis || null
        : null;
  const createUtterance =
    deps.createUtterance || ((text: string) => new SpeechSynthesisUtterance(text));
  const createAudio = deps.createAudio || (() => new Audio());
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;

  let activeToken = 0;
  let activeWord = '';
  let stopped = true;
  let loopTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAudio: HTMLAudioElement | null = null;
  let activeUtterance: SpeechSynthesisUtterance | null = null;
  let voicesReadyPromise: Promise<void> | null = null;

  const clearLoopTimer = () => {
    if (loopTimer) {
      clearTimeoutFn(loopTimer);
      loopTimer = null;
    }
  };

  const stopMedia = () => {
    clearLoopTimer();

    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch {
        // Ignore audio cleanup failures.
      }
      activeAudio.onended = null;
      activeAudio.onerror = null;
      activeAudio = null;
    }

    if (speech) {
      try {
        speech.cancel();
      } catch {
        // Ignore speech cleanup failures.
      }
    }
    activeUtterance = null;
  };

  const ensureSpeechReady = async (): Promise<boolean> => {
    if (!speech) {
      return false;
    }
    if (typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'undefined' && !deps.createUtterance) {
      return false;
    }

    try {
      const voices = speech.getVoices ? speech.getVoices() : [];
      if (Array.isArray(voices) && voices.length > 0) {
        return true;
      }
    } catch {
      return false;
    }

    if (!speech.addEventListener || !speech.removeEventListener) {
      return true;
    }
    if (!voicesReadyPromise) {
      voicesReadyPromise = new Promise<void>((resolve) => {
        const timeoutMs = Math.max(400, Math.min(1200, mergedConfig.ttsTimeoutMs));
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const onVoicesChanged = () => {
          if (timeoutId) {
            clearTimeoutFn(timeoutId);
            timeoutId = null;
          }
          speech.removeEventListener('voiceschanged', onVoicesChanged);
          resolve();
        };
        timeoutId = setTimeoutFn(() => {
          timeoutId = null;
          speech.removeEventListener('voiceschanged', onVoicesChanged);
          resolve();
        }, timeoutMs);
        speech.addEventListener('voiceschanged', onVoicesChanged, { once: true });
      }).finally(() => {
        voicesReadyPromise = null;
      });
    }
    await voicesReadyPromise;
    return true;
  };

  const playTtsOnce = (word: string, token: number): Promise<boolean> => {
    if (!speech) {
      return Promise.resolve(false);
    }

    return new Promise(async (resolve) => {
      const ready = await ensureSpeechReady();
      if (!ready || token !== activeToken) {
        resolve(false);
        return;
      }

      let settled = false;
      let started = false;
      let startTimeoutId: ReturnType<typeof setTimeout> | null = null;
      let hardTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const done = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (startTimeoutId) {
          clearTimeoutFn(startTimeoutId);
          startTimeoutId = null;
        }
        if (hardTimeoutId) {
          clearTimeoutFn(hardTimeoutId);
          hardTimeoutId = null;
        }
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        resolve(ok && token === activeToken);
      };

      let utterance: SpeechSynthesisUtterance;
      try {
        utterance = createUtterance(word);
      } catch {
        resolve(false);
        return;
      }
      activeUtterance = utterance;
      utterance.lang = mergedConfig.accent;
      utterance.rate = mergedConfig.ttsRate;
      utterance.pitch = mergedConfig.ttsPitch;

      const voice = selectVoice(speech, mergedConfig.accent);
      if (voice) {
        utterance.voice = voice;
      }

      utterance.onstart = () => {
        started = true;
        if (startTimeoutId) {
          clearTimeoutFn(startTimeoutId);
          startTimeoutId = null;
        }
      };
      utterance.onend = () => done(true);
      utterance.onerror = () => done(false);

      startTimeoutId = setTimeoutFn(() => {
        if (started) {
          return;
        }
        try {
          speech.cancel();
        } catch {
          // Ignore cancel failures.
        }
        done(false);
      }, mergedConfig.ttsTimeoutMs);
      const hardTimeoutMs = Math.max(mergedConfig.ttsTimeoutMs * 3, 5000);
      hardTimeoutId = setTimeoutFn(() => {
        try {
          speech.cancel();
        } catch {
          // Ignore cancel failures.
        }
        done(started);
      }, hardTimeoutMs);

      try {
        if (typeof speech.resume === 'function') {
          speech.resume();
        }
        if (speech.speaking || speech.pending) {
          speech.cancel();
        }
        speech.speak(utterance);
      } catch {
        done(false);
      }
    });
  };

  const playFallbackAudioOnce = async (word: string, token: number): Promise<boolean> => {
    const audioUrl = await getAudioUrl(word);
    if (!audioUrl || token !== activeToken) {
      return false;
    }

    return new Promise((resolve) => {
      const audio = createAudio();
      activeAudio = audio;
      let settled = false;

      const done = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (activeAudio === audio) {
          activeAudio = null;
        }
        resolve(ok && token === activeToken);
      };

      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.src = audioUrl;
      audio.preload = 'auto';

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.catch(() => done(false));
      }
    });
  };

  const playWordOnce = async (word: string, token: number): Promise<boolean> => {
    if (mergedConfig.preferRecordedAudio) {
      const audioOk = await playFallbackAudioOnce(word, token);
      if (audioOk) {
        return true;
      }
      return playTtsOnce(word, token);
    }

    const ttsOk = await playTtsOnce(word, token);
    if (ttsOk) {
      return true;
    }
    return playFallbackAudioOnce(word, token);
  };

  const sleepBetweenLoops = (token: number): Promise<void> => {
    return new Promise((resolve) => {
      loopTimer = setTimeoutFn(() => {
        loopTimer = null;
        if (token !== activeToken) {
          resolve();
          return;
        }
        resolve();
      }, mergedConfig.repeatGapMs);
    });
  };

  const runHoverLoop = async (word: string, token: number) => {
    while (!stopped && token === activeToken) {
      await playWordOnce(word, token);
      if (stopped || token !== activeToken) {
        return;
      }
      await sleepBetweenLoops(token);
    }
  };

  const startHoverLoop = (word: string) => {
    const normalized = normalizePronunciationWord(word);
    if (!normalized) {
      return;
    }
    if (!stopped && activeWord === normalized) {
      return;
    }

    activeWord = normalized;
    activeToken += 1;
    stopped = false;
    stopMedia();
    void runHoverLoop(normalized, activeToken);
  };

  const stop = () => {
    activeWord = '';
    stopped = true;
    activeToken += 1;
    stopMedia();
  };

  const playTap = (word: string) => {
    const normalized = normalizePronunciationWord(word);
    if (!normalized) {
      return;
    }

    activeWord = normalized;
    activeToken += 1;
    stopped = false;
    stopMedia();
    const token = activeToken;
    void (async () => {
      await playWordOnce(normalized, token);
      if (token === activeToken) {
        stopped = true;
      }
    })();
  };

  const dispose = () => {
    stop();
  };

  const prime = () => {
    if (!speech) {
      return;
    }
    try {
      if (typeof speech.resume === 'function') {
        speech.resume();
      }
      if (typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'undefined' && !deps.createUtterance) {
        return;
      }
      const utterance = createUtterance('ready');
      utterance.lang = mergedConfig.accent;
      utterance.volume = 0;
      const voice = selectVoice(speech, mergedConfig.accent);
      if (voice) {
        utterance.voice = voice;
      }
      speech.speak(utterance);
      setTimeoutFn(() => {
        try {
          speech.cancel();
        } catch {
          // Ignore cancellation failures.
        }
      }, 32);
    } catch {
      // Ignore priming failures and keep silent fallback behavior.
    }
  };

  return {
    startHoverLoop,
    stop,
    playTap,
    prime,
    dispose,
  };
}
