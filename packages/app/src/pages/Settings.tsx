import type { AIProvider, Prefs } from '@anker/core';
import { CheckCircle2, Code2, Copy, ExternalLink, Laptop, Loader2, LogIn, Monitor, Moon, Plug, RefreshCw, Smartphone, Sun, Trash2, Volume2, XCircle } from '../components/icons';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Chip, cx, Input, Modal, PageHeader, Panel, Section, Segmented, Select, Spinner, toast, Toggle, useConfirm } from '../components/ui';
import { aiLogin, aiStatus, type ProviderStatus } from '../lib/ai';
import { db } from '../lib/db';
import { uhrzeit } from '../lib/format';
import { desktop } from '../lib/desktop';
import { useIsAdmin, usePrefs, useHub, useSyncState, useTheme } from '../lib/hooks';
import { hubFetch, setHub } from '../lib/hub';
import { isDesktop, isNative, openExternal, scheduleDailyReminder } from '../lib/platform';
import { savePrefs } from '../lib/repo';
import { navigate } from '../lib/router';
import { resetSyncState, syncNow } from '../lib/sync';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { germanVoices, preferredVoice, setPreferredVoice, setSpeechRate, speak, speechRate, ttsAvailable } from '../lib/tts';

declare const __APP_VERSION__: string;
const REPO_URL = 'https://github.com/EmirGn/anker';

function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <div className="t-label">{title}</div>
        {desc && <div className="t-caption mt-0.5 text-ink-muted">{desc}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Study prefs
function StudyPrefs({ prefs }: { prefs: Prefs }) {
  const save = (patch: Partial<Prefs>) => void savePrefs(patch);
  return (
    <Panel className="divide-y divide-line">
      <Row title="Dein Name" desc="Für die Begrüßung auf „Heute“.">
        <Input defaultValue={prefs.name ?? ''} placeholder="Optional" className="w-44" onBlur={(e) => save({ name: e.target.value.trim() || undefined })} />
      </Row>
      <Row title="Deutschniveau" desc="Der KI-Tutor passt Beispiele und Erklärungen daran an.">
        <Select value={prefs.level} onChange={(e) => save({ level: e.target.value as Prefs['level'] })} className="w-28">
          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
      </Row>
      <Row title="Erklärungen auf" desc="Sprache für Bedeutungen, Übersetzungen und Grammatikhinweise.">
        <Select value={prefs.nativeLanguage} onChange={(e) => save({ nativeLanguage: e.target.value })} className="w-40">
          {['English', 'Türkçe', 'Español', 'Français', 'Italiano', 'Português', 'Polski', 'Русский', 'Українська', 'العربية', 'فارسی', '中文', '日本語', 'Deutsch'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
      </Row>
      <Row title="Tagesziel" desc="Wiederholungen pro Tag für deine Tagesmission.">
        <Input type="number" min={5} max={2000} defaultValue={prefs.dailyGoal} className="w-24" onBlur={(e) => save({ dailyGoal: Math.max(5, Number(e.target.value) || 50) })} />
      </Row>
      <Row title="Neuer Tag beginnt um" desc="Späte Wiederholungen zählen noch zum Vortag.">
        <Select value={prefs.rolloverHour} onChange={(e) => save({ rolloverHour: Number(e.target.value) })} className="w-28">
          {[0, 1, 2, 3, 4, 5, 6].map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </Select>
      </Row>
      <Row title="Tägliche Erinnerung" desc={isNative || isDesktop ? 'Eine sanfte Mitteilung, wenn Karten fällig sind.' : 'In der Mac- und Android-App verfügbar.'}>
        <Toggle
          checked={!!prefs.reminderTime}
          disabled={!isNative && !isDesktop}
          onChange={async (on) => {
            const time = on ? prefs.reminderTime || '19:00' : null;
            const ok = await scheduleDailyReminder(time);
            if (on && !ok) toast.error('Anker darf keine Mitteilungen senden.');
            save({ reminderTime: time });
          }}
        />
        {prefs.reminderTime && (
          <Input
            type="time"
            defaultValue={prefs.reminderTime}
            className="w-32"
            onBlur={async (e) => {
              if (!e.target.value) return;
              await scheduleDailyReminder(e.target.value);
              save({ reminderTime: e.target.value });
            }}
          />
        )}
      </Row>
    </Panel>
  );
}

// ------------------------------------------------------------------ Voice
function VoicePrefs() {
  const [voices, setVoices] = useState(germanVoices());
  const [voice, setVoice] = useState(preferredVoice() ?? '');
  const [rate, setRate] = useState(speechRate());
  useEffect(() => {
    const t = setTimeout(() => setVoices(germanVoices()), 600);
    return () => clearTimeout(t);
  }, []);
  if (!ttsAvailable()) return <Panel className="p-4 text-[15px] text-ink-muted">Text-to-speech isn't available on this device.</Panel>;
  return (
    <Panel className="divide-y divide-line">
      {!isNative && (
        <Row title="Deutsche Stimme" desc={voices.length ? 'macOS: Natürlichere Stimmen gibt es unter Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte.' : 'Keine deutsche Stimme gefunden – installier eine in den Systemeinstellungen.'}>
          <Select
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              setPreferredVoice(e.target.value || null);
            }}
            className="w-56"
          >
            <option value="">Automatisch</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row title="Sprechtempo" desc={`${Math.round(rate * 100)} %`}>
        <input
          type="range"
          min={0.6}
          max={1.3}
          step={0.05}
          value={rate}
          onChange={(e) => {
            setRate(Number(e.target.value));
            setSpeechRate(Number(e.target.value));
          }}
          className="w-40 accent-[var(--hafen)]"
        />
        <Button size="sm" icon={<Volume2 className="size-4" />} onClick={() => void speak('Eichhörnchen essen gern Nüsse im Herbst.')}>
          Testen
        </Button>
      </Row>
    </Panel>
  );
}

// ------------------------------------------------------------------ AI providers
function ProviderCard({ p, prefs, admin, onLogin }: { p: ProviderStatus; prefs: Prefs; admin: boolean; onLogin: () => void }) {
  const model = p.id === 'claude' ? prefs.claudeModel ?? '' : prefs.codexModel ?? '';
  const isDefault = prefs.defaultProvider === p.id;
  return (
    <Panel className={cx('p-4', isDefault && 'border-hafen')}>
      <div className="flex items-start gap-3">
        <div className={cx('flex size-11 shrink-0 items-center justify-center rounded-md text-[17px] font-bold text-white', p.id === 'claude' ? 'bg-[#d97757]' : 'bg-[#10a37f]')}>
          {p.id === 'claude' ? 'C' : '⌘'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-label">{p.name}</span>
            {isDefault && <Chip color="var(--hafen)">Standard</Chip>}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-muted">
            {!p.installed ? (
              'CLI ist auf dem Mac nicht installiert'
            ) : p.loggedIn ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 weight="fill" className="size-4 text-wiese" />
                {p.plan ?? 'Angemeldet'}
                {p.account ? ` · ${p.account}` : ''}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <XCircle className="size-4 text-koralle-ink" /> Nicht angemeldet
              </span>
            )}
          </div>
          {p.detail && <div className="mt-1 text-[13px] text-sonne-ink">{p.detail}</div>}
        </div>
      </div>
      {!p.installed ? (
        <div className="mt-4 rounded-md bg-paper-sunk px-3 py-2 font-mono text-[13px] break-all text-ink-muted">{p.installHint}</div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!p.loggedIn &&
            (admin ? (
              <Button variant="primary" size="sm" loading={p.loginInProgress} icon={<LogIn className="size-4" />} onClick={onLogin}>
                {p.loginInProgress ? 'Im Browser abschließen …' : `Mit ${p.id === 'claude' ? 'Claude' : 'ChatGPT'} anmelden`}
              </Button>
            ) : (
              <span className="t-caption text-ink-muted">Melde dich in der Mac-App an.</span>
            ))}
          <Select
            value={model}
            onChange={(e) => void savePrefs(p.id === 'claude' ? { claudeModel: e.target.value || undefined } : { codexModel: e.target.value || undefined })}
            className="h-9 w-44 text-[13px]"
          >
            {p.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          {!isDefault && (
            <Button size="sm" variant="ghost" onClick={() => void savePrefs({ defaultProvider: p.id })}>
              Als Standard
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function Integrations() {
  const [data, setData] = useState<{
    clients: { target: string; name: string; available: boolean; registered: boolean }[];
    snippets: { claudeDesktop: string; claudeCodeCommand: string; codexCommand: string } | null;
    mcpUrl: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () =>
    hubFetch('/api/integrations', { timeoutMs: 60_000 })
      .then(setData)
      .catch(() => setData(null));
  useEffect(() => {
    void load();
  }, []);
  if (!data) return <div className="flex items-center gap-2 px-1 py-2 text-[15px] text-ink-muted"><Spinner className="size-4" /> Checking Claude Code & Codex…</div>;
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success('Copied'));
  return (
    <div className="space-y-3">
      <Panel className="divide-y divide-line">
        {data.clients.map((c) => (
          <Row
            key={c.target}
            title={c.name}
            desc={!c.available ? 'CLI auf diesem Mac nicht gefunden' : c.registered ? 'Die Anker-Werkzeuge sind in jeder Sitzung verfügbar.' : `${c.name} kann deine Decks aus jeder Terminal-Sitzung lesen und bearbeiten.`}
          >
            {c.available &&
              (c.registered ? (
                <>
                  <Chip color="var(--wiese)">verbunden</Chip>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === c.target}
                    onClick={async () => {
                      setBusy(c.target);
                      await hubFetch(`/api/integrations/${c.target}`, { method: 'DELETE' }).catch((e) => toast.error((e as Error).message));
                      await load();
                      setBusy(null);
                    }}
                  >
                    Entfernen
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plug className="size-4" />}
                  loading={busy === c.target}
                  onClick={async () => {
                    setBusy(c.target);
                    try {
                      const r = await hubFetch<{ ok: boolean; output: string }>(`/api/integrations/${c.target}`, { body: {}, timeoutMs: 60_000 });
                      if (r.ok) toast.success(`Anker zu ${c.name} hinzugefügt`);
                      else toast.error(r.output || 'Fehlgeschlagen');
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                    await load();
                    setBusy(null);
                  }}
                >
                  Verbinden
                </Button>
              ))}
          </Row>
        ))}
      </Panel>
      {data.snippets && (
        <details className="group rounded-md border border-line bg-paper-raised">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-ink-muted group-open:border-b group-open:border-line">
            Andere MCP-Clients (Claude Desktop, Cursor …)
          </summary>
          <div className="space-y-3 p-4">
            <p className="text-[13px] text-ink-muted">
              Füge das in <code className="rounded-xs bg-paper-sunk px-1">claude_desktop_config.json</code> ein (oder in die MCP-Einstellungen deines Clients). Es startet einen kleinen Proxy, der die laufende Anker-App findet.
            </p>
            <div className="relative">
              <pre className="thin-scroll overflow-x-auto rounded-md bg-paper-sunk p-3 text-[11px] leading-relaxed">{data.snippets.claudeDesktop}</pre>
              <button onClick={() => copy(data.snippets!.claudeDesktop)} className="absolute top-2 right-2 rounded-sm bg-paper-raised p-1.5 text-ink-muted hover:text-ink" aria-label="Kopieren">
                <Copy className="size-3.5" />
              </button>
            </div>
            <p className="text-[13px] text-ink-muted">
              Streamable-HTTP-Endpunkt: <code className="rounded-xs bg-paper-sunk px-1">{data.mcpUrl}</code> (Bearer-Token in <code className="rounded-xs bg-paper-sunk px-1">~/.anker/connection.json</code>).
            </p>
          </div>
        </details>
      )}
    </div>
  );
}

function AISection({ prefs, admin }: { prefs: Prefs; admin: boolean }) {
  const hub = useHub();
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (refresh = false) =>
    aiStatus(refresh)
      .then((r) => {
        setProviders(r.providers);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    if (hub) void load(true);
  }, [hub]);
  const loggingIn = providers?.some((p) => p.loginInProgress);
  useEffect(() => {
    if (!loggingIn) return;
    const t = setInterval(() => void load(true), 3000);
    return () => clearInterval(t);
  }, [loggingIn]);

  if (!hub) {
    return (
      <Panel className="p-5 text-[15px] text-ink-muted">
        Der KI-Tutor läuft auf deinem Mac über deine eigenen Claude- und ChatGPT-Abos. Verbinde dieses Gerät zuerst mit deinem Mac.
        <div className="mt-3">
          <Button size="sm" onClick={() => navigate('/connect')}>
            Verbinden
          </Button>
        </div>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Anker steuert die offiziellen CLIs <b>Claude Code</b> und <b>Codex</b> auf deinem Mac, deshalb laufen Anfragen über deine Abos (Claude Pro/Max, ChatGPT Plus/Pro). Die Anmeldung passiert im Browser-Ablauf der CLIs – Anker sieht deine
        Zugangsdaten nie. Die KI kann nur Ankers Deck-Werkzeuge nutzen, kein Terminal und keine Dateien.
      </p>
      {error && <div className="rounded-md bg-koralle-soft px-4 py-3 text-[15px] text-koralle-ink">{error}</div>}
      {!providers ? (
        <div className="flex items-center gap-2 text-[15px] text-ink-muted">
          <Spinner className="size-5" /> Abos werden geprüft …
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              p={p}
              prefs={prefs}
              admin={admin}
              onLogin={async () => {
                const r = await aiLogin(p.id as AIProvider);
                if (!r.started) toast.error(r.error ?? 'Die Anmeldung konnte nicht starten');
                else toast('Schließ die Anmeldung im Browser ab');
                void load(true);
              }}
            />
          ))}
        </div>
      )}
      <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void load(true)}>
        Status aktualisieren
      </Button>
      {admin && (
        <div className="pt-2">
          <div className="t-label mb-2">Anker in Claude Code & Codex nutzen (MCP)</div>
          <Integrations />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Sync & devices
function PairModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<{ code: string; expiresAt: number; addresses: { address: string; kind: string; url: string }[]; lanEnabled: boolean } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setQr(null);
    hubFetch('/api/pair/start', { body: {} })
      .then(setInfo)
      .catch((e) => toast.error((e as Error).message));
  }, [open]);
  const addr = info?.addresses[sel];
  useEffect(() => {
    if (!info || !addr) return;
    void QRCode.toDataURL(`${addr.url}/pair?code=${info.code}`, { margin: 1, width: 440, errorCorrectionLevel: 'M' }).then(setQr);
  }, [info, addr]);
  return (
    <Modal open={open} onClose={onClose} title="Handy koppeln">
      {!info ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !info.addresses.length ? (
        <p className="text-[15px] text-ink-muted">Dieser Mac hat keine Netzwerkadresse. Verbinde ihn mit einem WLAN (oder Tailscale) und versuch es noch mal.</p>
      ) : (
        <div className="space-y-5 text-center">
          <p className="text-[15px] text-ink-muted">Scanne den Code mit der Handykamera und öffne den Link in der Anker-App. Oder gib den Code in Anker auf dem Handy ein.</p>
          <div className="flex justify-center">{qr ? <img src={qr} alt="QR-Code zum Koppeln" className="size-56 rounded-md bg-white p-2" /> : <div className="size-56" />}</div>
          <div>
            <div className="t-overline text-ink-muted">Code</div>
            <div className="font-mono text-[28px] font-bold tracking-[0.2em]">{info.code}</div>
            <div className="t-caption text-ink-muted">10 Minuten gültig</div>
          </div>
          <div>
            <div className="t-overline mb-2 text-ink-muted">Adresse</div>
            <div className="flex flex-wrap justify-center gap-2">
              {info.addresses.map((a, i) => (
                <button
                  key={a.url}
                  onClick={() => setSel(i)}
                  className={cx('rounded-md border px-3 py-1.5 font-mono text-[13px]', i === sel ? 'border-hafen bg-hafen-soft' : 'border-line hover:bg-paper-sunk')}
                >
                  {a.url.replace('http://', '')}
                  <span className="ml-1.5 font-sans text-[11px] text-ink-muted">{a.kind === 'tailscale' ? 'Tailscale' : a.kind === 'lan' ? 'Wi‑Fi' : ''}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-ink-muted">Unterwegs? Installier Tailscale auf beiden Geräten und nimm die 100.x-Adresse.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function HubAdmin() {
  const [hubInfo, setHubInfo] = useState<{ name: string; urls: string[]; lanEnabled: boolean; port: number; dataDir?: string; counts: Record<string, number> } | null>(null);
  const [devices, setDevices] = useState<{ id: string; name: string; createdAt: number; lastSeenAt?: number }[]>([]);
  const [pairOpen, setPairOpen] = useState(false);
  const [confirm, confirmNode] = useConfirm();
  const load = () => {
    void hubFetch('/api/hub').then(setHubInfo);
    void hubFetch('/api/devices').then(setDevices);
  };
  useEffect(load, [pairOpen]);
  if (!hubInfo) return <Spinner />;
  return (
    <div className="space-y-3">
      <Panel className="divide-y divide-line">
        <Row title="Dieser Mac ist der Hub" desc={`Handys synchronisieren mit ihm, und die KI läuft hier. ${hubInfo.counts.notes} Notizen · ${hubInfo.counts.reviews} Wiederholungen gespeichert.`}>
          <Button variant="primary" icon={<Smartphone className="size-4" />} onClick={() => setPairOpen(true)}>
            Handy koppeln
          </Button>
        </Row>
        <Row title="Geräte im Netzwerk erlauben" desc="Nötig für den Handy-Sync. Jede Anfrage braucht trotzdem ein gekoppeltes Gerät.">
          <Toggle
            checked={hubInfo.lanEnabled}
            onChange={async (v) => {
              await hubFetch('/api/hub/settings', { body: { lanEnabled: v } });
              load();
            }}
          />
        </Row>
        <Row title="Name des Hubs">
          <Input defaultValue={hubInfo.name} className="w-52" onBlur={async (e) => e.target.value.trim() && (await hubFetch('/api/hub/settings', { body: { name: e.target.value.trim() } }))} />
        </Row>
        {hubInfo.dataDir && (
          <Row title="Datenordner" desc={<span className="font-mono text-[11px] break-all">{hubInfo.dataDir}</span>}>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const r = await hubFetch<{ file: string }>('/api/backup', { body: {} });
                toast.success(`Sicherung gespeichert: ${r.file.split('/').pop()}`);
              }}
            >
              Jetzt sichern
            </Button>
          </Row>
        )}
      </Panel>
      <div className="t-overline px-1 pt-2 text-ink-muted">Gekoppelte Geräte</div>
      <Panel className="divide-y divide-line">
        {devices.length === 0 ? (
          <div className="px-4 py-4 text-[15px] text-ink-muted">Noch keine Geräte.</div>
        ) : (
          devices.map((d) => (
            <Row key={d.id} title={d.name} desc={`Gekoppelt am ${new Date(d.createdAt).toLocaleDateString('de-DE')}${d.lastSeenAt ? ` · zuletzt gesehen ${new Date(d.lastSeenAt).toLocaleString('de-DE')}` : ''}`}>
              <Button
                size="sm"
                variant="ghost"
                className="text-koralle-ink"
                onClick={async () => {
                  if (!(await confirm(`${d.name} entkoppeln?`, { body: 'Das Gerät synchronisiert nicht mehr, bis du es neu koppelst.', confirm: 'Entkoppeln', danger: true }))) return;
                  await hubFetch(`/api/devices/${d.id}`, { method: 'DELETE' });
                  load();
                }}
              >
                Entkoppeln
              </Button>
            </Row>
          ))
        )}
      </Panel>
      <PairModal open={pairOpen} onClose={() => setPairOpen(false)} />
      {confirmNode}
    </div>
  );
}

function SyncClient() {
  const hub = useHub();
  const sync = useSyncState();
  const [confirm, confirmNode] = useConfirm();
  if (!hub) {
    return (
      <Panel className="p-5">
        <div className="t-label">Nicht verbunden</div>
        <p className="mt-1 text-[15px] text-ink-muted">Anker funktioniert komplett offline. Verbinde dich mit der Anker-App auf deinem Mac, um zu synchronisieren und den KI-Tutor zu nutzen.</p>
        <Button variant="primary" className="mt-4" onClick={() => navigate('/connect')}>
          Mit meinem Mac verbinden
        </Button>
      </Panel>
    );
  }
  return (
    <Panel className="divide-y divide-line">
      <Row
        title={`Verbunden mit ${hub.name ?? 'deinem Mac'}`}
        desc={
          <>
            {hub.url} · {sync.status === 'idle' ? `synchronisiert ${sync.lastSync ? uhrzeit(sync.lastSync) : ''}` : sync.status === 'syncing' ? 'synchronisiert …' : sync.status === 'offline' ? 'nicht erreichbar' : 'Fehler'}
            {sync.error ? ` – ${sync.error}` : ''}
          </>
        }
      >
        <Button size="sm" icon={sync.status === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} onClick={() => void syncNow()}>
          Jetzt synchronisieren
        </Button>
      </Row>
      {hub.urls && hub.urls.length > 1 && (
        <Row title="Bekannte Adressen" desc={hub.urls.join(' · ')}>
          <span />
        </Row>
      )}
      <Row title="Trennen" desc="Deine Karten bleiben auf diesem Gerät, der Sync stoppt.">
        <Button
          size="sm"
          variant="ghost"
          className="text-koralle-ink"
          onClick={async () => {
            if (!(await confirm('Vom Mac trennen?', { confirm: 'Trennen', danger: true }))) return;
            await setHub(null);
            await resetSyncState();
            toast('Getrennt');
          }}
        >
          Trennen
        </Button>
      </Row>
      {confirmNode}
    </Panel>
  );
}

// ------------------------------------------------------------------ Desktop
function DesktopPrefs() {
  const [s, setS] = useState<{ openAtLogin: boolean; shortcut: string } | null>(null);
  useEffect(() => {
    void desktop?.getSettings().then(setS);
  }, []);
  if (!desktop || !s) return null;
  return (
    <Section title="Mac-App">
      <Panel className="divide-y divide-line">
        <Row title="Beim Anmelden öffnen" desc="Hält Sync und MCP-Server für dein Handy und KI-Apps bereit.">
          <Toggle
            checked={s.openAtLogin}
            onChange={async (v) => {
              await desktop!.setOpenAtLogin(v);
              setS({ ...s, openAtLogin: v });
            }}
          />
        </Row>
        <Row title="Kurzbefehl: Schnell hinzufügen" desc="Ein deutsches Wort von überall auf dem Mac festhalten.">
          <Input
            defaultValue={s.shortcut}
            className="w-52 font-mono text-[13px]"
            onBlur={async (e) => {
              const ok = await desktop!.setShortcut(e.target.value.trim());
              if (ok) toast.success('Kurzbefehl gespeichert');
              else toast.error('Dieser Kurzbefehl ist belegt oder ungültig');
            }}
          />
        </Row>
      </Panel>
    </Section>
  );
}

// ------------------------------------------------------------------ Page
export function Settings() {
  const prefs = usePrefs();
  useTheme();
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [confirm, confirmNode] = useConfirm();
  const admin = useIsAdmin();

  const exportBackup = async () => {
    const dump: Record<string, unknown> = { app: 'anker', version: 1, exportedAt: Date.now() };
    for (const t of ['decks', 'notes', 'cards', 'revlog', 'chats', 'prefs'] as const) dump[t] = await db.table(t).toArray();
    const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `anker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="mx-auto max-w-3xl px-5 pt-8 pb-16 md:px-8 md:pt-10">
      <PageHeader title="Einstellungen" />

      <Section title="Lernen">
        <StudyPrefs prefs={prefs} />
      </Section>

      <Section title="KI-Tutor · Claude & Codex">
        <AISection prefs={prefs} admin={admin} />
      </Section>

      <Section title={admin ? 'Sync & Geräte' : 'Sync'}>{admin ? <HubAdmin /> : <SyncClient />}</Section>

      <Section title="Stimme">
        <VoicePrefs />
      </Section>

      <Section title="Darstellung">
        <Panel className="p-4">
          <Segmented
            value={theme}
            onChange={(v) => {
              setTheme(v);
              setThemePref(v);
            }}
            options={[
              { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="size-4" />System</span> },
              { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-4" />Hell</span> },
              { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-4" />Nacht</span> },
            ]}
          />
        </Panel>
      </Section>

      <DesktopPrefs />

      <Section title="Daten">
        <Panel className="divide-y divide-line">
          <Row title="Importieren" desc="Anki-Decks (.apkg), CSV/TSV-Wortlisten oder eine Anker-Sicherung.">
            <Button size="sm" onClick={() => navigate('/import')}>
              Importieren …
            </Button>
          </Row>
          <Row title="Sicherung exportieren" desc="Alles auf diesem Gerät als eine JSON-Datei.">
            <Button size="sm" onClick={() => void exportBackup()}>
              Herunterladen
            </Button>
          </Row>
          {!admin && (
            <Row title="Dieses Gerät zurücksetzen" desc="Löscht alle lokalen Daten. Synchronisierte Daten bleiben auf deinem Mac.">
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  if (!(await confirm('Alle Daten auf diesem Gerät löschen?', { body: 'Karten, die nicht mit einem Mac synchronisiert sind, gehen verloren.', confirm: 'Löschen', danger: true }))) return;
                  await db.delete();
                  localStorage.clear();
                  location.reload();
                }}
              >
                Löschen
              </Button>
            </Row>
          )}
        </Panel>
      </Section>

      <Section title="Über Anker">
        <Panel className="divide-y divide-line">
          <Row title={`Anker ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}`} desc="Karteikarten mit FSRS für Deutsch, mit Claude & Codex über MCP.">
            <Button size="sm" variant="ghost" icon={<Code2 className="size-4" />} onClick={() => openExternal(REPO_URL)}>
              GitHub <ExternalLink className="size-3.5" />
            </Button>
          </Row>
          <Row title="Plattform" desc={isDesktop ? 'Mac-App (Hub)' : isNative ? 'Android-App' : 'Web'}>
            {isDesktop ? <Laptop className="size-5 text-ink-muted" /> : <Smartphone className="size-5 text-ink-muted" />}
          </Row>
        </Panel>
      </Section>
      {confirmNode}
    </div>
  );
}
