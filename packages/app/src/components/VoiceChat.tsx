// Full-screen voice chat with Otto (Codex realtime voice): Otto reacts to who
// is talking, the transcript builds up underneath, and hanging up keeps it as a chat.
import { useEffect, useRef, useState } from 'react';
import { useProviders } from '../lib/ai';
import { useIsWide } from '../lib/hooks';
import { tr } from '../lib/i18n';
import type { OttoActivity } from '../lib/otto';
import { navigate } from '../lib/router';
import { syncNow } from '../lib/sync';
import { startVoiceCall, voiceSupported, type VoiceCall, type VoiceEvent } from '../lib/voice';
import { Mic, MicOff, PhoneOff, X } from './icons';
import { Otto, type OttoMood } from './Otto';
import { ToolChip } from './ToolChip';
import { Button, cx, IconButton, toast } from './ui';

type Item =
  | { kind: 'turn'; id: string; role: 'user' | 'assistant'; text: string; done: boolean }
  | { kind: 'tool'; id: string; name: string; input?: unknown; output?: string; status: 'running' | 'ok' | 'error' };

type Phase = 'connecting' | 'live' | 'ending' | 'failed';

export function VoiceChat({ chatId, activity, onClose }: { chatId?: string; activity?: OttoActivity; onClose: (chatId?: string) => void }) {
  const wide = useIsWide();
  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [muted, setMuted] = useState(false);
  const [working, setWorking] = useState(false);
  const [talking, setTalking] = useState<'none' | 'user' | 'otto'>('none');
  const [attempt, setAttempt] = useState(0);
  const call = useRef<VoiceCall | null>(null);
  /** Chat that already holds this conversation (after a dropped call) */
  const saved = useRef<string | undefined>(chatId);
  const closing = useRef(false);
  const halo = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  function handle(e: VoiceEvent) {
    switch (e.type) {
      case 'transcript':
        setItems((cur) => {
          const i = cur.findIndex((it) => it.kind === 'turn' && it.id === e.id);
          if (i < 0) return [...cur, { kind: 'turn', id: e.id, role: e.role, text: e.delta, done: false }];
          const next = [...cur];
          const it = next[i] as Extract<Item, { kind: 'turn' }>;
          next[i] = { ...it, text: it.text + e.delta };
          return next;
        });
        break;
      case 'turnDone':
        setItems((cur) => cur.map((it) => (it.kind === 'turn' && it.id === e.id ? { ...it, done: true } : it)));
        break;
      case 'working':
        setWorking(e.active);
        break;
      case 'tool': {
        const { type: _type, ...tool } = e;
        setItems((cur) => {
          const i = cur.findIndex((it) => it.kind === 'tool' && it.id === tool.id);
          if (i < 0) return [...cur, { kind: 'tool', ...tool }];
          const next = [...cur];
          next[i] = { kind: 'tool', ...tool, output: tool.output ?? (next[i] as Extract<Item, { kind: 'tool' }>).output };
          return next;
        });
        break;
      }
      case 'error':
        setError(e.message);
        break;
      case 'closed':
        // Ended on Otto's side (time limit, usage limit, lost connection).
        if (!closing.current) void end(e.chatId);
        break;
    }
  }

  function fail(message: string) {
    setError(message);
    setPhase('failed');
    const c = call.current;
    call.current = null;
    void c
      ?.hangUp()
      .then((id) => id && (saved.current = id))
      .catch(() => {});
  }

  async function end(chat?: string) {
    if (closing.current) return;
    closing.current = true;
    setPhase('ending');
    const c = call.current;
    call.current = null;
    let id = chat ?? saved.current;
    try {
      id = (await c?.hangUp()) ?? id;
    } catch {
      // the hub keeps whatever it heard
    }
    onClose(id);
  }

  useEffect(() => {
    let cancelled = false;
    closing.current = false;
    setPhase('connecting');
    setError(null);
    startVoiceCall({
      chatId: saved.current,
      // A retry continues the saved chat instead of opening the activity again.
      activity: saved.current && saved.current !== chatId ? undefined : activity,
      onEvent: (e) => !cancelled && handle(e),
      onConnection: (state) => {
        if (cancelled) return;
        if (state === 'connected') setPhase((p) => (p === 'connecting' ? 'live' : p));
        else if (state === 'failed') fail(tr('Die Audioverbindung ist abgebrochen.'));
      },
    }).then(
      (c) => {
        if (cancelled) void c.hangUp().catch(() => {});
        else call.current = c;
      },
      (e) => !cancelled && fail((e as Error).message),
    );
    return () => {
      cancelled = true;
      const c = call.current;
      call.current = null;
      if (c) void c.hangUp().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Otto's halo follows the loudest voice; the mood follows who is talking.
  useEffect(() => {
    let raf = 0;
    let who: 'none' | 'user' | 'otto' = 'none';
    let heard = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = call.current;
      if (!c) return;
      const { mic, otto } = c.levels();
      halo.current?.style.setProperty('--lvl', Math.max(mic, otto).toFixed(3));
      const now = performance.now();
      const loud = otto > 0.05 ? 'otto' : mic > 0.08 ? 'user' : 'none';
      if (loud !== 'none') heard = now;
      const next = loud !== 'none' ? loud : now - heard > 700 ? 'none' : who;
      if (next !== who) setTalking((who = next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep the screen on during the call.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void end();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      void lock?.release().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  const mood: OttoMood =
    phase === 'failed' ? 'sleepy' : phase !== 'live' || working ? 'thinking' : talking === 'otto' ? 'happy' : 'listening';
  const status =
    phase === 'connecting'
      ? tr('Verbinde mit Otto …')
      : phase === 'ending'
        ? tr('Gespräch wird gespeichert …')
        : phase === 'failed'
          ? ''
          : working
            ? tr('Otto kümmert sich um deine Karten …')
            : muted
              ? tr('Stummgeschaltet')
              : talking === 'otto'
                ? tr('Otto spricht …')
                : tr('Otto hört zu …');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activity?.title ?? tr('Sprachchat mit Otto')}
      className="fixed inset-0 z-50 flex flex-col bg-paper pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <div className="t-label truncate">{activity?.title ?? tr('Sprachchat mit Otto')}</div>
          <div className="t-caption text-ink-muted">{tr('Codex Realtime · über dein Codex-Abo')}</div>
        </div>
        <IconButton label={tr('Schließen')} onClick={() => void end()}>
          <X className="size-5" />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-col items-center px-5 pt-3 pb-4">
        <div className="relative flex items-center justify-center">
          <div
            ref={halo}
            className="absolute -inset-4 rounded-full bg-krake-soft transition-transform duration-75"
            style={{ transform: 'scale(calc(1 + var(--lvl, 0) * 0.4))' }}
          />
          <Otto size={wide ? 168 : 128} mood={mood} className="relative" />
        </div>
        <div className="t-body mt-6 min-h-6 text-ink-muted" aria-live="polite">
          {status}
        </div>
      </div>

      <div ref={scroller} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-xl flex-col gap-2 px-5 pb-4">
          {phase === 'live' && !items.length && (
            <p className="t-caption text-center text-ink-muted">
              {activity
                ? tr('Otto fängt an. Antworte einfach auf Deutsch, und sag Bescheid, wenn du aufhören willst.')
                : tr('Sprich einfach los: auf Deutsch, oder auf Englisch, wenn du nicht weiterweißt. Sag „Speicher das Wort …“, dann legt Otto Karten an.')}
            </p>
          )}
          {items.map((it) =>
            it.kind === 'tool' ? (
              <ToolChip key={it.id} name={it.name} input={it.input} output={it.output} status={it.status} />
            ) : it.text.trim() ? (
              <div key={it.id} className={cx('flex', it.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cx(
                    't-body-lg max-w-[85%] rounded-[18px] px-3.5 py-2 whitespace-pre-wrap transition-opacity',
                    it.role === 'user' ? 'rounded-br-[6px] bg-hafen text-on-hafen' : 'rounded-bl-[6px] bg-paper-raised',
                    !it.done && 'opacity-75',
                  )}
                >
                  {it.text.trim()}
                </div>
              </div>
            ) : null,
          )}
          {error && <div className="rounded-md bg-koralle-soft px-4 py-3 text-[15px] text-koralle-ink">{error}</div>}
          {phase === 'failed' && (
            <div className="flex justify-center pt-1">
              <Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>
                {tr('Nochmal versuchen')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-start justify-center gap-8 border-t border-line px-5 py-4">
        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={() => {
              setMuted(!muted);
              call.current?.setMuted(!muted);
            }}
            disabled={phase !== 'live'}
            aria-pressed={muted}
            aria-label={muted ? tr('Mikrofon an') : tr('Stummschalten')}
            className={cx(
              'flex size-14 items-center justify-center rounded-full transition-colors duration-[120ms] disabled:opacity-45',
              muted ? 'bg-ink text-paper' : 'bg-paper-sunk text-ink hover:bg-line',
            )}
          >
            {muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
          </button>
          <span className="t-caption text-ink-muted">{muted ? tr('Stumm') : tr('Mikrofon')}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={() => void end()}
            disabled={phase === 'ending'}
            aria-label={tr('Auflegen')}
            className="flex size-14 items-center justify-center rounded-full bg-koralle text-white transition-[filter] duration-[120ms] hover:brightness-95 disabled:opacity-45"
          >
            <PhoneOff weight="fill" className="size-6" />
          </button>
          <span className="t-caption text-ink-muted">{tr('Auflegen')}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Opens a voice chat with Otto from anywhere: checks Codex and the microphone,
 * and afterwards opens the chat that keeps the conversation.
 */
export function useVoiceLauncher(chatId?: string) {
  const providers = useProviders();
  const [call, setCall] = useState<{ activity?: OttoActivity } | null>(null);
  const open = (activity?: OttoActivity) => {
    const codex = providers?.find((p) => p.id === 'codex');
    if (providers && !(codex?.installed && codex.loggedIn)) return void toast.error(tr('Sprachchat läuft über Codex. Melde Codex unter Einstellungen → Otto an.'));
    if (!voiceSupported()) return void toast.error(tr('Hier gibt es kein Mikrofon. Nutze die Anker-App auf dem Mac, iPad, iPhone oder Android.'));
    setCall({ activity });
  };
  const element = call ? (
    <VoiceChat
      chatId={chatId}
      activity={call.activity}
      onClose={(id) => {
        setCall(null);
        void syncNow();
        if (id && id !== chatId) navigate(`/otto/${id}`);
      }}
    />
  ) : null;
  return { open, element };
}
