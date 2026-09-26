import { CheckCircle2, Laptop, Smartphone, Wifi } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '../components/Logo';
import { Button, Input, Label, Panel, toast } from '../components/ui';
import { setMeta } from '../lib/db';
import { useHub, useSyncState } from '../lib/hooks';
import { connectWithToken, pairWithHub, probeHub, setHub } from '../lib/hub';
import { deviceName } from '../lib/platform';
import { navigate, useRoute } from '../lib/router';
import { syncNow } from '../lib/sync';

export function Connect() {
  const { query } = useRoute();
  const hub = useHub();
  const sync = useSyncState();
  const [url, setUrl] = useState(query.get('url') ?? '');
  const [code, setCode] = useState(query.get('code') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const auto = useRef(false);

  const connect = async (u = url, c = code) => {
    setBusy(true);
    setError(null);
    try {
      const token = query.get('token');
      const conn = token ? await connectWithToken(u || window.location.origin, token) : await pairWithHub(u, c.replace(/\D/g, ''), deviceName());
      await setMeta('onboarded', true);
      toast.success(`Connected to ${conn.name ?? 'your hub'}`);
      await syncNow();
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Deep link / QR / local token link → connect automatically once.
  useEffect(() => {
    if (auto.current) return;
    const token = query.get('token');
    const qUrl = query.get('url');
    const qCode = query.get('code');
    if (token || (qUrl && qCode && qCode.length === 6)) {
      auto.current = true;
      void connect(qUrl ?? window.location.origin, qCode ?? '');
    } else if (!qUrl && /^https?:/.test(window.location.origin) && !/^(capacitor|https:\/\/localhost$)/.test(window.location.origin)) {
      // Opened from the hub itself in a browser: prefill its address.
      void probeHub(window.location.origin).then((h) => {
        if (h) {
          setUrl(window.location.origin);
          setFound(h.name);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pt-safe mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Logo size={44} />
        <div>
          <h1 className="font-display text-[26px] leading-tight font-semibold">Connect to your Mac</h1>
          <p className="text-sm text-muted">Sync decks & reviews and use the AI tutor.</p>
        </div>
      </div>

      {hub && !query.get('code') ? (
        <Panel className="p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6 text-good" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Connected to {hub.name ?? 'hub'}</div>
              <div className="truncate text-[13px] text-muted">
                {hub.url} · {sync.status === 'idle' ? 'in sync' : sync.status}
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => navigate('/')}>
              Done
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await setHub(null);
                toast('Disconnected');
              }}
            >
              Disconnect
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <ol className="mb-6 space-y-3 text-[14px] text-muted">
            <li className="flex gap-3">
              <Laptop className="mt-0.5 size-5 shrink-0 text-accent" />
              <span>
                On your Mac, open <b className="text-ink">Anker → Settings → Sync & devices → Pair a phone</b>.
              </span>
            </li>
            <li className="flex gap-3">
              <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" />
              <span>Scan the QR code with your camera — or type the address and 6-digit code below.</span>
            </li>
            <li className="flex gap-3">
              <Wifi className="mt-0.5 size-5 shrink-0 text-accent" />
              <span>Both devices need to be on the same Wi‑Fi (or on Tailscale when you're away).</span>
            </li>
          </ol>
          <Panel className="space-y-4 p-5">
            <div>
              <Label hint={found ? `Found “${found}”` : undefined}>Hub address</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="192.168.1.23:4747" inputMode="url" autoCapitalize="off" autoCorrect="off" />
            </div>
            <div>
              <Label>Pairing code</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                className="text-center font-mono text-[24px] tracking-[0.4em]"
                onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void connect()}
              />
            </div>
            {error && <div className="rounded-xl bg-again/10 px-3.5 py-2.5 text-[13.5px] text-again">{error}</div>}
            <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={!url.trim() || code.length !== 6} onClick={() => void connect()}>
              Connect
            </Button>
          </Panel>
          <button onClick={() => navigate('/')} className="mt-5 text-center text-sm font-medium text-muted hover:text-ink">
            Use offline for now
          </button>
        </>
      )}
    </div>
  );
}
