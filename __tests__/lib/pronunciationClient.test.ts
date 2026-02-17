import { createPronunciationController } from '../../lib/pronunciationClient';

type MockUtterance = {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice?: SpeechSynthesisVoice;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
};

function createUtterance(text: string): SpeechSynthesisUtterance {
  return {
    text,
    lang: '',
    rate: 1,
    pitch: 1,
    onstart: null,
    onend: null,
    onerror: null,
  } as unknown as SpeechSynthesisUtterance;
}

describe('pronunciationClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('loops TTS on hover and stops cleanly', async () => {
    const speak = jest.fn((utterance: MockUtterance) => {
      setTimeout(() => {
        utterance.onstart?.(new Event('start'));
        utterance.onend?.(new Event('end'));
      }, 0);
    });
    const cancel = jest.fn();
    const speech = {
      speak,
      cancel,
      getVoices: () => [],
    } as unknown as SpeechSynthesis;

    const controller = createPronunciationController(
      { accent: 'en-US', repeatGapMs: 100, ttsTimeoutMs: 500 },
      {
        speechSynthesis: speech,
        createUtterance: (text) => createUtterance(text),
        getAudioUrl: async () => null,
      }
    );

    controller.startHoverLoop('terrestrial');
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(180);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(260);
    await Promise.resolve();
    await Promise.resolve();

    expect(speak.mock.calls.length).toBeGreaterThanOrEqual(1);

    controller.stop();
    const before = speak.mock.calls.length;
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(speak.mock.calls.length).toBe(before);
  });

  test('prefers recorded audio before TTS', async () => {
    const speak = jest.fn((utterance: MockUtterance) => {
      setTimeout(() => {
        utterance.onstart?.(new Event('start'));
        utterance.onerror?.(new Event('error'));
      }, 0);
    });
    const speech = {
      speak,
      cancel: jest.fn(),
      getVoices: () => [],
    } as unknown as SpeechSynthesis;

    const play = jest.fn(() => {
      setTimeout(() => {
        mockAudio.onended?.(new Event('end'));
      }, 0);
      return Promise.resolve();
    });
    const mockAudio = {
      src: '',
      preload: '',
      currentTime: 0,
      onended: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      play,
      pause: jest.fn(),
    } as unknown as HTMLAudioElement;

    const controller = createPronunciationController(
      { accent: 'en-US', repeatGapMs: 100, ttsTimeoutMs: 500 },
      {
        speechSynthesis: speech,
        createUtterance: (text) => createUtterance(text),
        getAudioUrl: async () => 'https://blob.example/terrestrial.mp3',
        createAudio: () => mockAudio,
      }
    );

    controller.playTap('terrestrial');
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    jest.advanceTimersByTime(1);
    await Promise.resolve();

    expect(play).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(0);
  });

  test('stop interrupts active playback', async () => {
    const speak = jest.fn((utterance: MockUtterance) => {
      setTimeout(() => {
        utterance.onstart?.(new Event('start'));
        utterance.onend?.(new Event('end'));
      }, 0);
    });
    const cancel = jest.fn();
    const speech = {
      speak,
      cancel,
      getVoices: () => [],
    } as unknown as SpeechSynthesis;

    const controller = createPronunciationController(
      { accent: 'en-US', repeatGapMs: 100, ttsTimeoutMs: 500 },
      {
        speechSynthesis: speech,
        createUtterance: (text) => createUtterance(text),
        getAudioUrl: async () => null,
      }
    );

    controller.startHoverLoop('terrestrial');
    controller.stop();
    jest.advanceTimersByTime(250);
    await Promise.resolve();

    expect(cancel).toHaveBeenCalled();
  });
});
