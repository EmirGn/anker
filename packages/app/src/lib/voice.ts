// Voice chat with Otto. The device talks to OpenAI's realtime voice model over
// WebRTC; the hub on the Mac answers the call through the user's Codex login
// and streams the transcript back.
import type { ChatToolCall } from '@anker/core';
import { desktop } from './desktop';
import { hubFetch, sseStream } from './hub';
import { tr } from './i18n';
import type { OttoActivity } from './otto';

export type VoiceEvent =
  | { type: 'transcript'; id: string; role: 'user' | 'assistant'; delta: string }
  | { type: 'turnDone'; id: string }
  | { type: 'working'; active: boolean }
  | ({ type: 'tool' } & ChatToolCall)
  | { type: 'error'; message: string }
  | { type: 'closed'; reason?: string; chatId?: string };

/** Voices of Codex's realtime model; "cove" is its default. */
export const VOICES = ['cove', 'juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol'];

export interface VoiceCall {
  /** Ends the call; resolves with the chat that keeps the transcript. */
  hangUp(): Promise<string | undefined>;
  setMuted(muted: boolean): void;
  /** Loudness 0…1 of the learner's microphone and of Otto. */
  levels(): { mic: number; otto: number };
}

export function voiceSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Calls Otto. Start it from a tap so the browser lets Otto's voice play. */
export async function startVoiceCall(opts: {
  chatId?: string;
  activity?: OttoActivity;
  onEvent: (e: VoiceEvent) => void;
  onConnection: (state: RTCPeerConnectionState) => void;
}): Promise<VoiceCall> {
  const speaker = new Audio();
  speaker.autoplay = true;
  const ctx = new AudioContext();
  void ctx.resume();

  let mic: MediaStream;
  try {
    if (desktop?.askMicrophone && !(await desktop.askMicrophone())) {
      throw new Error(tr('Anker darf das Mikrofon nicht benutzen. Erlaube es unter Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon.'));
    }
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    void ctx.close();
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError') throw new Error(tr('Kein Zugriff aufs Mikrofon. Erlaube es in den Einstellungen deines Geräts.'));
    if (name === 'NotFoundError') throw new Error(tr('Kein Mikrofon gefunden.'));
    throw e;
  }

  const track = mic.getAudioTracks()[0]!;
  const pc = new RTCPeerConnection();
  pc.addTrack(track, mic);
  // Codex expects the realtime events channel in the offer.
  const channel = pc.createDataChannel('oai-events');
  const micLevel = meter(ctx, mic);
  let ottoLevel = () => 0;
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    speaker.srcObject = stream;
    void speaker.play().catch(() => {});
    ottoLevel = meter(ctx, stream);
  };
  pc.onconnectionstatechange = () => opts.onConnection(pc.connectionState);

  const ac = new AbortController();
  const close = () => {
    ac.abort();
    channel.close();
    pc.close();
    for (const t of mic.getTracks()) t.stop();
    speaker.srcObject = null;
    void ctx.close().catch(() => {});
  };

  let id: string;
  try {
    await pc.setLocalDescription(await pc.createOffer());
    const r = await hubFetch<{ sessionId: string; sdp: string }>('/api/voice/start', {
      body: { sdp: pc.localDescription!.sdp, chatId: opts.chatId, activity: opts.activity },
      timeoutMs: 60_000,
    });
    id = r.sessionId;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
    } catch (e) {
      void hubFetch(`/api/voice/${id}/stop`, { body: {} }).catch(() => {});
      throw e;
    }
  } catch (e) {
    close();
    throw e;
  }

  // Otto greets once the audio link is up.
  channel.onopen = () => void hubFetch(`/api/voice/${id}/ready`, { body: {} }).catch(() => {});

  let ended = false;
  sseStream(
    `/api/voice/${id}/events`,
    (_ev, data) => {
      if (!data || typeof data !== 'object') return;
      if ((data as VoiceEvent).type === 'closed') ended = true;
      opts.onEvent(data as VoiceEvent);
    },
    ac.signal,
  )
    .then(() => {
      if (!ended && !ac.signal.aborted) opts.onEvent({ type: 'error', message: tr('Verbindung zum Mac verloren') });
    })
    .catch((e) => {
      if (!ac.signal.aborted) opts.onEvent({ type: 'error', message: (e as Error).message });
    });

  return {
    async hangUp() {
      try {
        return (await hubFetch<{ chatId?: string }>(`/api/voice/${id}/stop`, { body: {} })).chatId;
      } finally {
        close();
      }
    },
    setMuted(muted) {
      track.enabled = !muted;
    },
    levels: () => ({ mic: track.enabled ? micLevel() : 0, otto: ottoLevel() }),
  };
}

/** Loudness 0…1 of a stream, for Otto's animation. */
function meter(ctx: AudioContext, stream: MediaStream): () => number {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / buf.length) * 5);
  };
}
