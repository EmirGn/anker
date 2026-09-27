import type { AIProvider, Prefs } from '@anker/core';
import { CheckCircle2, Code2, Copy, ExternalLink, Laptop, Loader2, LogIn, Monitor, Moon, Plug, RefreshCw, Smartphone, Sun, Trash2, Volume2, XCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Chip, cx, Input, Modal, PageHeader, Panel, Section, Segmented, Select, Spinner, toast, Toggle, useConfirm } from '../components/ui';
import { aiLogin, aiStatus, type ProviderStatus } from '../lib/ai';
import { db } from '../lib/db';
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-[14.5px] font-medium">{title}</div>
        {desc && <div className="text-[12.5px] text-muted">{desc}</div>}
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
      <Row title="Your name" desc="Used for the greeting on the Today page.">
        <Input defaultValue={prefs.name ?? ''} placeholder="Optional" className="w-44" onBlur={(e) => save({ name: e.target.value.trim() || undefined })} />
      </Row>
      <Row title="German level" desc="The AI tutor adapts examples and explanations to it.">
        <Select value={prefs.level} onChange={(e) => save({ level: e.target.value as Prefs['level'] })} className="w-28">
          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
      </Row>
      <Row title="Explanations in" desc="Language for meanings, translations and grammar notes.">
        <Select value={prefs.nativeLanguage} onChange={(e) => save({ nativeLanguage: e.target.value })} className="w-40">
          {['English', 'Türkçe', 'Español', 'Français', 'Italiano', 'Português', 'Polski', 'Русский', 'Українська', 'العربية', 'فارسی', '中文', '日本語', 'Deutsch'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
      </Row>
      <Row title="Daily goal" desc="Reviews per day for the progress ring.">
        <Input type="number" min={5} max={2000} defaultValue={prefs.dailyGoal} className="w-24" onBlur={(e) => save({ dailyGoal: Math.max(5, Number(e.target.value) || 50) })} />
      </Row>
      <Row title="Next day starts at" desc="Late-night reviews still count for the previous day.">
        <Select value={prefs.rolloverHour} onChange={(e) => save({ rolloverHour: Number(e.target.value) })} className="w-28">
          {[0, 1, 2, 3, 4, 5, 6].map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </Select>
      </Row>
      <Row title="Daily reminder" desc={isNative || isDesktop ? 'A gentle notification if you have cards due.' : 'Available in the Mac and Android apps.'}>
        <Toggle
          checked={!!prefs.reminderTime}
          disabled={!isNative && !isDesktop}
          onChange={async (on) => {
            const time = on ? prefs.reminderTime || '19:00' : null;
            const ok = await scheduleDailyReminder(time);
            if (on && !ok) toast.error('Notifications are not allowed for Anker.');
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
  if (!ttsAvailable()) return <Panel className="p-4 text-sm text-muted">Text-to-speech isn't available on this device.</Panel>;
  return (
    <Panel className="divide-y divide-line">
      {!isNative && (
        <Row title="German voice" desc={voices.length ? 'macOS: install more natural voices in System Settings → Accessibility → Spoken Content.' : 'No German voice found — install one in your system settings.'}>
          <Select
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              setPreferredVoice(e.target.value || null);
            }}
            className="w-56"
          >
            <option value="">Automatic</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row title="Speaking speed" desc={`${Math.round(rate * 100)}%`}>
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
          className="w-40 accent-[var(--accent)]"
        />
        <Button size="sm" icon={<Volume2 className="size-4" />} onClick={() => void speak('Eichhörnchen essen gern Nüsse im Herbst.')}>
          Test
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
    <Panel className={cx('p-5', isDefault && 'ring-2 ring-accent/40')}>
      <div className="flex items-start gap-3">
        <div className={cx('flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white', p.id === 'claude' ? 'bg-[#d97757]' : 'bg-[#10a37f]')}>
          {p.id === 'claude' ? 'C' : '⌘'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold">{p.name}</span>
            {isDefault && <Chip color="var(--accent-strong)">default</Chip>}
          </div>
          <div className="mt-0.5 text-[13px] text-muted">
            {!p.installed ? (
              'CLI not installed on the hub'
            ) : p.loggedIn ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-good" />
                {p.plan ?? 'Signed in'}
                {p.account ? ` · ${p.account}` : ''}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <XCircle className="size-3.5 text-again" /> Not signed in
              </span>
            )}
          </div>
          {p.detail && <div className="mt-1 text-[12px] text-hard">{p.detail}</div>}
        </div>
      </div>
      {!p.installed ? (
        <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2 font-mono text-[12px] break-all text-muted">{p.installHint}</div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!p.loggedIn &&
            (admin ? (
              <Button variant="primary" size="sm" loading={p.loginInProgress} icon={<LogIn className="size-4" />} onClick={onLogin}>
                {p.loginInProgress ? 'Finish in your browser…' : `Sign in with ${p.id === 'claude' ? 'Claude' : 'ChatGPT'}`}
              </Button>
            ) : (
              <span className="text-[12.5px] text-muted">Sign in from the Mac app.</span>
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
              Make default
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
  if (!data) return <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted"><Spinner className="size-4" /> Checking Claude Code & Codex…</div>;
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success('Copied'));
  return (
    <div className="space-y-3">
      <Panel className="divide-y divide-line">
        {data.clients.map((c) => (
          <Row
            key={c.target}
            title={c.name}
            desc={!c.available ? 'CLI not found on this Mac' : c.registered ? 'Anker tools are available in every session.' : `Let ${c.name} read and edit your decks from any terminal session.`}
          >
            {c.available &&
              (c.registered ? (
                <>
                  <Chip color="var(--good)">connected</Chip>
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
                    Remove
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
                      if (r.ok) toast.success(`Added Anker to ${c.name}`);
                      else toast.error(r.output || 'Failed');
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                    await load();
                    setBusy(null);
                  }}
                >
                  Connect
                </Button>
              ))}
          </Row>
        ))}
      </Panel>
      {data.snippets && (
        <details className="group rounded-2xl border border-line bg-surface">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13.5px] font-medium text-muted group-open:border-b group-open:border-line">
            Other MCP clients (Claude Desktop, Cursor, …)
          </summary>
          <div className="space-y-3 p-4">
            <p className="text-[12.5px] text-muted">
              Add this to <code className="rounded bg-surface-2 px-1">claude_desktop_config.json</code> (or your client's MCP settings). It launches a tiny proxy that finds the running Anker app.
            </p>
            <div className="relative">
              <pre className="thin-scroll overflow-x-auto rounded-xl bg-surface-2 p-3 text-[11.5px] leading-relaxed">{data.snippets.claudeDesktop}</pre>
              <button onClick={() => copy(data.snippets!.claudeDesktop)} className="absolute top-2 right-2 rounded-lg bg-surface p-1.5 text-faint hover:text-ink" aria-label="Copy">
                <Copy className="size-3.5" />
              </button>
            </div>
            <p className="text-[12.5px] text-muted">
              Streamable HTTP endpoint: <code className="rounded bg-surface-2 px-1">{data.mcpUrl}</code> (Bearer token in <code className="rounded bg-surface-2 px-1">~/.anker/connection.json</code>).
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
      <Panel className="p-5 text-sm text-muted">
        The AI tutor runs on your Mac through your own Claude and ChatGPT subscriptions. Connect this device to your Mac hub first.
        <div className="mt-3">
          <Button size="sm" onClick={() => navigate('/connect')}>
            Connect
          </Button>
        </div>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-muted">
        Anker drives the official <b>Claude Code</b> and <b>Codex</b> CLIs on your Mac, so requests use your Claude Pro/Max and ChatGPT Plus/Pro subscriptions. Sign-in happens in the CLIs' own browser flow — Anker never sees your
        credentials. Agents can only use Anker's deck tools (no shell or file access).
      </p>
      {error && <div className="rounded-xl bg-again/10 px-4 py-3 text-sm text-again">{error}</div>}
      {!providers ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" /> Checking subscriptions…
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
                if (!r.started) toast.error(r.error ?? 'Could not start sign-in');
                else toast('Complete the sign-in in your browser');
                void load(true);
              }}
            />
          ))}
        </div>
      )}
      <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void load(true)}>
        Refresh status
      </Button>
      {admin && (
        <div className="pt-2">
          <div className="mb-2 text-[13.5px] font-semibold">Use Anker from Claude Code & Codex (MCP)</div>
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
    <Modal open={open} onClose={onClose} title="Pair a phone">
      {!info ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !info.addresses.length ? (
        <p className="text-sm text-muted">This Mac has no network address. Connect to Wi‑Fi (or Tailscale) and try again.</p>
      ) : (
        <div className="space-y-5 text-center">
          <p className="text-[14px] text-muted">Scan with your phone's camera, then tap “Open in the Anker app”. Or enter the code manually in Anker on your phone.</p>
          <div className="flex justify-center">{qr ? <img src={qr} alt="Pairing QR code" className="size-56 rounded-2xl bg-white p-2" /> : <div className="size-56" />}</div>
          <div>
            <div className="text-[12px] font-semibold tracking-wide text-faint uppercase">Code</div>
            <div className="font-mono text-[38px] font-bold tracking-[0.2em]">{info.code}</div>
            <div className="text-[12px] text-faint">valid for 10 minutes</div>
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold tracking-wide text-faint uppercase">Address</div>
            <div className="flex flex-wrap justify-center gap-2">
              {info.addresses.map((a, i) => (
                <button
                  key={a.url}
                  onClick={() => setSel(i)}
                  className={cx('rounded-xl border px-3 py-1.5 font-mono text-[13px]', i === sel ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
                >
                  {a.url.replace('http://', '')}
                  <span className="ml-1.5 font-sans text-[11px] text-faint">{a.kind === 'tailscale' ? 'Tailscale' : a.kind === 'lan' ? 'Wi‑Fi' : ''}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-faint">Away from home? Install Tailscale on both devices and use the 100.x address.</p>
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
        <Row title="This Mac is the hub" desc={`Phones sync with it and the AI runs here. ${hubInfo.counts.notes} notes · ${hubInfo.counts.reviews} reviews stored.`}>
          <Button variant="primary" icon={<Smartphone className="size-4" />} onClick={() => setPairOpen(true)}>
            Pair a phone
          </Button>
        </Row>
        <Row title="Allow devices on my network" desc="Needed for phone sync. Every request still requires a paired device token.">
          <Toggle
            checked={hubInfo.lanEnabled}
            onChange={async (v) => {
              await hubFetch('/api/hub/settings', { body: { lanEnabled: v } });
              load();
            }}
          />
        </Row>
        <Row title="Hub name">
          <Input defaultValue={hubInfo.name} className="w-52" onBlur={async (e) => e.target.value.trim() && (await hubFetch('/api/hub/settings', { body: { name: e.target.value.trim() } }))} />
        </Row>
        {hubInfo.dataDir && (
          <Row title="Data folder" desc={<span className="font-mono text-[11.5px] break-all">{hubInfo.dataDir}</span>}>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const r = await hubFetch<{ file: string }>('/api/backup', { body: {} });
                toast.success(`Backup saved: ${r.file.split('/').pop()}`);
              }}
            >
              Back up now
            </Button>
          </Row>
        )}
      </Panel>
      <div className="px-1 pt-2 text-[12px] font-semibold tracking-wide text-faint uppercase">Paired devices</div>
      <Panel className="divide-y divide-line">
        {devices.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted">No devices yet.</div>
        ) : (
          devices.map((d) => (
            <Row key={d.id} title={d.name} desc={`Paired ${new Date(d.createdAt).toLocaleDateString()}${d.lastSeenAt ? ` · last seen ${new Date(d.lastSeenAt).toLocaleString()}` : ''}`}>
              <Button
                size="sm"
                variant="ghost"
                className="text-again"
                onClick={async () => {
                  if (!(await confirm(`Unpair ${d.name}?`, { body: 'It will stop syncing until you pair it again.', confirm: 'Unpair', danger: true }))) return;
                  await hubFetch(`/api/devices/${d.id}`, { method: 'DELETE' });
                  load();
                }}
              >
                Unpair
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
        <div className="font-medium">Not connected</div>
        <p className="mt-1 text-sm text-muted">Anker works fully offline. Connect to the Anker app on your Mac to sync and use the AI tutor.</p>
        <Button variant="primary" className="mt-4" onClick={() => navigate('/connect')}>
          Connect to my Mac
        </Button>
      </Panel>
    );
  }
  return (
    <Panel className="divide-y divide-line">
      <Row
        title={`Connected to ${hub.name ?? 'hub'}`}
        desc={
          <>
            {hub.url} · {sync.status === 'idle' ? `synced ${sync.lastSync ? new Date(sync.lastSync).toLocaleTimeString() : ''}` : sync.status}
            {sync.error ? ` — ${sync.error}` : ''}
          </>
        }
      >
        <Button size="sm" icon={sync.status === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} onClick={() => void syncNow()}>
          Sync now
        </Button>
      </Row>
      {hub.urls && hub.urls.length > 1 && (
        <Row title="Known addresses" desc={hub.urls.join(' · ')}>
          <span />
        </Row>
      )}
      <Row title="Disconnect" desc="Keeps your cards on this device; stops syncing.">
        <Button
          size="sm"
          variant="ghost"
          className="text-again"
          onClick={async () => {
            if (!(await confirm('Disconnect from the hub?', { confirm: 'Disconnect', danger: true }))) return;
            await setHub(null);
            await resetSyncState();
            toast('Disconnected');
          }}
        >
          Disconnect
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
    <Section title="Mac app">
      <Panel className="divide-y divide-line">
        <Row title="Open at login" desc="Keeps sync and the MCP server available for your phone and AI apps.">
          <Toggle
            checked={s.openAtLogin}
            onChange={async (v) => {
              await desktop!.setOpenAtLogin(v);
              setS({ ...s, openAtLogin: v });
            }}
          />
        </Row>
        <Row title="Quick-add shortcut" desc="Capture a German word from anywhere on your Mac.">
          <Input
            defaultValue={s.shortcut}
            className="w-52 font-mono text-[13px]"
            onBlur={async (e) => {
              const ok = await desktop!.setShortcut(e.target.value.trim());
              if (ok) toast.success('Shortcut saved');
              else toast.error('That shortcut is taken or invalid');
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
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <PageHeader title="Settings" />

      <Section title="Study">
        <StudyPrefs prefs={prefs} />
      </Section>

      <Section title="AI tutor · Claude & Codex">
        <AISection prefs={prefs} admin={admin} />
      </Section>

      <Section title={admin ? 'Sync & devices' : 'Sync'}>{admin ? <HubAdmin /> : <SyncClient />}</Section>

      <Section title="Voice">
        <VoicePrefs />
      </Section>

      <Section title="Appearance">
        <Panel className="p-4">
          <Segmented
            value={theme}
            onChange={(v) => {
              setTheme(v);
              setThemePref(v);
            }}
            options={[
              { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="size-3.5" />System</span> },
              { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-3.5" />Light</span> },
              { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
            ]}
          />
        </Panel>
      </Section>

      <DesktopPrefs />

      <Section title="Data">
        <Panel className="divide-y divide-line">
          <Row title="Import" desc="Anki decks (.apkg), CSV/TSV word lists or an Anker backup.">
            <Button size="sm" onClick={() => navigate('/import')}>
              Import…
            </Button>
          </Row>
          <Row title="Export backup" desc="Everything on this device as one JSON file.">
            <Button size="sm" onClick={() => void exportBackup()}>
              Download
            </Button>
          </Row>
          {!admin && (
            <Row title="Erase this device" desc="Deletes all local data. Synced data stays on your hub.">
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  if (!(await confirm('Erase all data on this device?', { body: 'Cards that are not synced to a hub will be lost.', confirm: 'Erase', danger: true }))) return;
                  await db.delete();
                  localStorage.clear();
                  location.reload();
                }}
              >
                Erase
              </Button>
            </Row>
          )}
        </Panel>
      </Section>

      <Section title="About">
        <Panel className="divide-y divide-line">
          <Row title={`Anker ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}`} desc="Spaced repetition (FSRS) for German, with Claude & Codex over MCP.">
            <Button size="sm" variant="ghost" icon={<Code2 className="size-4" />} onClick={() => openExternal(REPO_URL)}>
              GitHub <ExternalLink className="size-3.5" />
            </Button>
          </Row>
          <Row title="Platform" desc={isDesktop ? 'Mac app (hub)' : isNative ? 'Android app' : 'Web'}>
            {isDesktop ? <Laptop className="size-5 text-faint" /> : <Smartphone className="size-5 text-faint" />}
          </Row>
        </Panel>
      </Section>
      {confirmNode}
    </div>
  );
}
