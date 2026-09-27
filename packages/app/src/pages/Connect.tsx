import { CheckCircle2, Laptop, Smartphone, Wifi } from '../components/icons';
import { useEffect, useRef, useState } from 'react';
import { OttoBadge } from '../components/Otto';
import { Button, Input, Label, Panel, toast } from '../components/ui';
import { setMeta } from '../lib/db';
import { useHub, useSyncState } from '../lib/hooks';
import { connectWithToken, pairWithHub, probeHub, setHub } from '../lib/hub';
import { deviceName } from '../lib/platform';
import { navigate, useRoute } from '../lib/router';
import { syncNow } from '../lib/sync';

// Survives remounts so a deep link / token link is only redeemed once per page load.
const redeemed = new Set<string>();

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
      toast.success(`Verbunden mit ${conn.name ?? 'deinem Mac'}`);
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
    const linkKey = `${token ?? ''}|${qUrl ?? ''}|${qCode ?? ''}`;
    if ((token || (qUrl && qCode && qCode.length === 6)) && !redeemed.has(linkKey)) {
      redeemed.add(linkKey);
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
        <OttoBadge size={64} mood="happy" />
        <div>
          <h1 className="t-title">Mit deinem Mac verbinden</h1>
          <p className="mt-1 text-[15px] text-ink-muted">Decks und Wiederholungen synchronisieren, den KI-Tutor nutzen.</p>
        </div>
      </div>

      {hub && !query.get('code') ? (
        <Panel className="p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6 text-wiese" />
            <div className="min-w-0 flex-1">
              <div className="t-label">Verbunden mit {hub.name ?? 'deinem Mac'}</div>
              <div className="truncate text-[13px] text-ink-muted">
                {hub.url} · {sync.status === 'idle' ? 'synchron' : sync.status === 'syncing' ? 'synchronisiert …' : sync.status === 'offline' ? 'nicht erreichbar' : 'Fehler'}
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => navigate('/')}>
              Fertig
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await setHub(null);
                toast('Getrennt');
              }}
            >
              Trennen
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <ol className="mb-6 space-y-3 text-[15px] text-ink-muted">
            <li className="flex gap-3">
              <Laptop className="size-6 shrink-0 text-ink" />
              <span>
                Öffne auf deinem Mac <b className="text-ink">Anker → Einstellungen → Sync & Geräte → Handy koppeln</b>.
              </span>
            </li>
            <li className="flex gap-3">
              <Smartphone className="size-6 shrink-0 text-ink" />
              <span>Scanne den QR-Code mit der Kamera – oder gib unten Adresse und 6-stelligen Code ein.</span>
            </li>
            <li className="flex gap-3">
              <Wifi className="size-6 shrink-0 text-ink" />
              <span>Beide Geräte müssen im selben WLAN sein (unterwegs über Tailscale).</span>
            </li>
          </ol>
          <Panel className="space-y-4 p-5">
            <div>
              <Label hint={found ? `„${found}“ gefunden` : undefined}>Adresse des Macs</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="192.168.1.23:4747" inputMode="url" autoCapitalize="off" autoCorrect="off" />
            </div>
            <div>
              <Label>Kopplungscode</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                className="text-center font-mono text-[22px] tracking-[0.4em]"
                onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void connect()}
              />
            </div>
            {error && <div className="rounded-md bg-koralle-soft px-3.5 py-2.5 text-[13px] font-medium text-koralle-ink">{error}</div>}
            <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={!url.trim() || code.length !== 6} onClick={() => void connect()}>
              Verbinden
            </Button>
          </Panel>
          <button onClick={() => navigate('/')} className="t-label mt-4 h-11 text-center text-ink-muted hover:text-ink">
            Erst mal offline nutzen
          </button>
        </>
      )}
    </div>
  );
}
