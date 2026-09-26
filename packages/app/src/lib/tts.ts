// German text-to-speech: Android's native engine via Capacitor, otherwise the
// Web Speech API (macOS ships good German voices like Anna/Petra/Markus).
import { isNative } from './platform';

const VOICE_KEY = 'anker-voice';
const RATE_KEY = 'anker-voice-rate';

export function ttsAvailable(): boolean {
  return isNative || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

export function preferredVoice(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY);
  } catch {
    return null;
  }
}

export function setPreferredVoice(name: string | null) {
  try {
    if (name) localStorage.setItem(VOICE_KEY, name);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    // ignore
  }
}

export function speechRate(): number {
  try {
    return Number(localStorage.getItem(RATE_KEY)) || 1;
  } catch {
    return 1;
  }
}

export function setSpeechRate(r: number) {
  try {
    localStorage.setItem(RATE_KEY, String(r));
  } catch {
    // ignore
  }
}

let voicesCache: SpeechSynthesisVoice[] = [];
function loadVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) voicesCache = v;
  return voicesCache;
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = () => loadVoices();
}

export function germanVoices(): SpeechSynthesisVoice[] {
  return loadVoices().filter((v) => v.lang.toLowerCase().startsWith('de'));
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = germanVoices();
  const want = preferredVoice();
  if (want) {
    const v = voices.find((x) => x.name === want);
    if (v) return v;
  }
  const score = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced|natural|neural/i.test(v.name) ? 10 : 0) +
    (/^(anna|petra|markus|helena|yannick|viktor|google deutsch)/i.test(v.name) ? 3 : 0) +
    (v.lang === 'de-DE' ? 2 : 0) +
    (v.localService ? 1 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

/** Strip markup and article-less artifacts so TTS reads naturally. */
export function speakable(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '$1')
    .replace(/\*\*|__|\*/g, '')
    .replace(/[·•]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

let speakingToken = 0;

export async function speak(text: string, opts: { rate?: number; lang?: string } = {}): Promise<void> {
  const t = speakable(text);
  if (!t) return;
  const rate = (opts.rate ?? 1) * speechRate();
  const lang = opts.lang ?? 'de-DE';
  const token = ++speakingToken;
  if (isNative) {
    try {
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      await TextToSpeech.stop().catch(() => {});
      if (token !== speakingToken) return;
      await TextToSpeech.speak({ text: t, lang, rate, pitch: 1, volume: 1, category: 'playback' });
    } catch (e) {
      console.warn('TTS failed', e);
    }
    return;
  }
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang;
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

export async function stopSpeaking() {
  speakingToken++;
  if (isNative) {
    try {
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      await TextToSpeech.stop();
    } catch {
      // ignore
    }
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
