import type { AIProvider, Prefs } from '@anker/core';
import { CheckCircle2, Code2, Copy, ExternalLink, Laptop, Loader2, LogIn, Monitor, Moon, Plug, RefreshCw, Smartphone, Sun, Trash2, Volume2, XCircle } from '../components/icons';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Chip, cx, Input, Label, Modal, PageHeader, Panel, Section, Segmented, Select, Spinner, toast, Toggle, useConfirm } from '../components/ui';
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
import { lang, LOCALE, setLang, tr, type Lang } from '../lib/i18n';
import { VOICES } from '../lib/voice';

const LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

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
      <Row title={tr('Dein Name')} desc={tr('Für die Begrüßung auf „Heute“.')}>
        <Input defaultValue={prefs.name ?? ''} placeholder={tr('Optional')} className="w-44" onBlur={(e) => save({ name: e.target.value.trim() || undefined })} />
      </Row>
      <Row title={tr('Deutschniveau')} desc={tr('Der KI-Tutor passt Beispiele und Erklärungen daran an.')}>
        <Select value={prefs.level} onChange={(e) => save({ level: e.target.value as Prefs['level'] })} className="w-28">
          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
      </Row>
      <Row title={tr('Erklärungen auf')} desc={tr('Sprache für Bedeutungen, Übersetzungen und Grammatikhinweise.')}>
        <Select value={prefs.nativeLanguage} onChange={(e) => save({ nativeLanguage: e.target.value })} className="w-40">
          {['English', 'Türkçe', 'Español', 'Français', 'Italiano', 'Português', 'Polski', 'Русский', 'Українська', 'العربية', 'فارسی', '中文', '日本語', 'Deutsch'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
      </Row>
      <Row title={tr('Tagesziel')} desc={tr('Wiederholungen pro Tag für deine Tagesmission.')}>
        <Input type="number" min={5} max={2000} defaultValue={prefs.dailyGoal} className="w-24" onBlur={(e) => save({ dailyGoal: Math.max(5, Number(e.target.value) || 50) })} />
      </Row>
      <Row title={tr('Neuer Tag beginnt um')} desc={tr('Späte Wiederholungen zählen noch zum Vortag.')}>
        <Select value={prefs.rolloverHour} onChange={(e) => save({ rolloverHour: Number(e.target.value) })} className="w-28">
          {[0, 1, 2, 3, 4, 5, 6].map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </Select>
      </Row>
      <Row title={tr('Tägliche Erinnerung')} desc={isNative || isDesktop ? tr('Eine sanfte Mitteilung, wenn Karten fällig sind.') : tr('In der Mac- und Android-App verfügbar.')}>
        <Toggle
          checked={!!prefs.reminderTime}
          disabled={!isNative && !isDesktop}
          onChange={async (on) => {
            const time = on ? prefs.reminderTime || '19:00' : null;
            const ok = await scheduleDailyReminder(time);
            if (on && !ok) toast.error(tr('Anker darf keine Mitteilungen senden.'));
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
  if (!ttsAvailable()) return <Panel className="p-4 text-[15px] text-ink-muted">{tr('Sprachausgabe ist auf diesem Gerät nicht verfügbar.')}</Panel>;
  return (
    <Panel className="divide-y divide-line">
      {!isNative && (
        <Row title={tr('Deutsche Stimme')} desc={voices.length ? tr('macOS: Natürlichere Stimmen gibt es unter Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte.') : tr('Keine deutsche Stimme gefunden – installier eine in den Systemeinstellungen.')}>
          <Select
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              setPreferredVoice(e.target.value || null);
            }}
            className="w-56"
          >
            <option value="">{tr('Automatisch')}</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row title={tr('Sprechtempo')} desc={`${Math.round(rate * 100)} %`}>
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
        <Button size="sm" icon={<Volume2 className="size-4" />} onClick={() => void speak('Eichhörnchen essen gern Nüsse im Herbst.')}>{tr('Testen')}</Button>
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
          {p.id === 'claude' ? tr('C') : '⌘'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-label">{p.name}</span>
            {isDefault && <Chip color="var(--hafen)">{tr('Standard')}</Chip>}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-muted">
            {!p.installed ? (
              tr('CLI ist auf dem Mac nicht installiert')
            ) : p.loggedIn ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 weight="fill" className="size-4 text-wiese" />
                {p.plan ?? tr('Angemeldet')}
                {p.account ? ` · ${p.account}` : ''}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <XCircle className="size-4 text-koralle-ink" />{' '}{tr('Nicht angemeldet')}</span>
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
                {p.loginInProgress ? tr('Im Browser abschließen …') : tr('Mit {0} anmelden', p.id === 'claude' ? tr('Claude') : tr('ChatGPT'))}
              </Button>
            ) : (
              <span className="t-caption text-ink-muted">{tr('Melde dich in der Mac-App an.')}</span>
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
          {p.id === 'codex' && (
            <Select value={prefs.voice ?? VOICES[0]} onChange={(e) => void savePrefs({ voice: e.target.value })} aria-label={tr('Ottos Stimme im Sprachchat')} className="h-9 w-48 text-[13px]">
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  {tr('Ottos Stimme: {0}', v[0]!.toUpperCase() + v.slice(1))}
                </option>
              ))}
            </Select>
          )}
          {!isDefault && (
            <Button size="sm" variant="ghost" onClick={() => void savePrefs({ defaultProvider: p.id })}>{tr('Als Standard')}</Button>
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
  if (!data) return <div className="flex items-center gap-2 px-1 py-2 text-[15px] text-ink-muted"><Spinner className="size-4" />{' '}{tr('Claude Code & Codex werden geprüft …')}</div>;
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success(tr('Kopiert')));
  return (
    <div className="space-y-3">
      <Panel className="divide-y divide-line">
        {data.clients.map((c) => (
          <Row
            key={c.target}
            title={c.name}
            desc={!c.available ? tr('CLI auf diesem Mac nicht gefunden') : c.registered ? tr('Die Anker-Werkzeuge sind in jeder Sitzung verfügbar.') : tr('{0} kann deine Decks aus jeder Terminal-Sitzung lesen und bearbeiten.', c.name)}
          >
            {c.available &&
              (c.registered ? (
                <>
                  <Chip color="var(--wiese)">{tr('verbunden')}</Chip>
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
                  >{tr('Entfernen')}</Button>
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
                      if (r.ok) toast.success(tr('Anker zu {0} hinzugefügt', c.name));
                      else toast.error(r.output || tr('Fehlgeschlagen'));
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                    await load();
                    setBusy(null);
                  }}
                >{tr('Verbinden')}</Button>
              ))}
          </Row>
        ))}
      </Panel>
      {data.snippets && (
        <details className="group rounded-md border border-line bg-paper-raised">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-ink-muted group-open:border-b group-open:border-line">{tr('Andere MCP-Clients (Claude Desktop, Cursor …)')}</summary>
          <div className="space-y-3 p-4">
            <p className="text-[13px] text-ink-muted">{tr('Füge das in')}{' '}<code className="rounded-xs bg-paper-sunk px-1">claude_desktop_config.json</code>{' '}{tr('ein (oder in die MCP-Einstellungen deines Clients). Es startet einen kleinen Proxy, der die laufende Anker-App findet.')}</p>
            <div className="relative">
              <pre className="thin-scroll overflow-x-auto rounded-md bg-paper-sunk p-3 text-[11px] leading-relaxed">{data.snippets.claudeDesktop}</pre>
              <button onClick={() => copy(data.snippets!.claudeDesktop)} className="absolute top-2 right-2 rounded-sm bg-paper-raised p-1.5 text-ink-muted hover:text-ink" aria-label={tr('Kopieren')}>
                <Copy className="size-3.5" />
              </button>
            </div>
            <p className="text-[13px] text-ink-muted">{tr('Streamable-HTTP-Endpunkt:')}{' '}<code className="rounded-xs bg-paper-sunk px-1">{data.mcpUrl}</code>{' '}{tr('(Bearer-Token in')}{' '}<code className="rounded-xs bg-paper-sunk px-1">~/.anker/connection.json</code>).
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
      <Panel className="p-5 text-[15px] text-ink-muted">{tr('Der KI-Tutor läuft auf deinem Mac über deine eigenen Claude- und ChatGPT-Abos. Verbinde dieses Gerät zuerst mit deinem Mac.')}<div className="mt-3">
          <Button size="sm" onClick={() => navigate('/connect')}>{tr('Verbinden')}</Button>
        </div>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">{tr('Anker steuert die offiziellen CLIs')}{' '}<b>{tr('Claude Code')}</b>{' '}{tr('und')}{' '}<b>{tr('Codex')}</b>{' '}{tr('auf deinem Mac, deshalb laufen Anfragen über deine Abos (Claude Pro/Max, ChatGPT Plus/Pro). Die Anmeldung passiert im Browser-Ablauf der CLIs – Anker sieht deine Zugangsdaten nie. Die KI kann nur Ankers Deck-Werkzeuge nutzen, kein Terminal und keine Dateien.')}</p>
      {error && <div className="rounded-md bg-koralle-soft px-4 py-3 text-[15px] text-koralle-ink">{error}</div>}
      {!providers ? (
        <div className="flex items-center gap-2 text-[15px] text-ink-muted">
          <Spinner className="size-5" />{' '}{tr('Abos werden geprüft …')}</div>
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
                if (!r.started) toast.error(r.error ?? tr('Die Anmeldung konnte nicht starten'));
                else toast(tr('Schließ die Anmeldung im Browser ab'));
                void load(true);
              }}
            />
          ))}
        </div>
      )}
      <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void load(true)}>{tr('Status aktualisieren')}</Button>
      {admin && (
        <div className="pt-2">
          <div className="t-label mb-2">{tr('Anker in Claude Code & Codex nutzen (MCP)')}</div>
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
    <Modal open={open} onClose={onClose} title={tr('Handy koppeln')}>
      {!info ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !info.addresses.length ? (
        <p className="text-[15px] text-ink-muted">{tr('Dieser Mac hat keine Netzwerkadresse. Verbinde ihn mit einem WLAN (oder Tailscale) und versuch es noch mal.')}</p>
      ) : (
        <div className="space-y-5 text-center">
          <p className="text-[15px] text-ink-muted">{tr('Scanne den Code mit der Handykamera und öffne den Link in der Anker-App. Oder gib den Code in Anker auf dem Handy ein.')}</p>
          <div className="flex justify-center">{qr ? <img src={qr} alt={tr('QR-Code zum Koppeln')} className="size-56 rounded-md bg-white p-2" /> : <div className="size-56" />}</div>
          <div>
            <div className="t-overline text-ink-muted">{tr('Code')}</div>
            <div className="font-mono text-[28px] font-bold tracking-[0.2em]">{info.code}</div>
            <div className="t-caption text-ink-muted">{tr('10 Minuten gültig')}</div>
          </div>
          <div>
            <div className="t-overline mb-2 text-ink-muted">{tr('Adresse')}</div>
            <div className="flex flex-wrap justify-center gap-2">
              {info.addresses.map((a, i) => (
                <button
                  key={a.url}
                  onClick={() => setSel(i)}
                  className={cx('rounded-md border px-3 py-1.5 font-mono text-[13px]', i === sel ? 'border-hafen bg-hafen-soft' : 'border-line hover:bg-paper-sunk')}
                >
                  {a.url.replace('http://', '')}
                  <span className="ml-1.5 font-sans text-[11px] text-ink-muted">{a.kind === 'tailscale' ? tr('Tailscale') : a.kind === 'lan' ? tr('Wi‑Fi') : ''}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-ink-muted">{tr('Unterwegs? Installier Tailscale auf beiden Geräten und nimm die 100.x-Adresse.')}</p>
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
        <Row title={tr('Dieser Mac ist der Hub')} desc={tr('Handys synchronisieren mit ihm, und die KI läuft hier. {0} Notizen · {1} Wiederholungen gespeichert.', hubInfo.counts.notes, hubInfo.counts.reviews)}>
          <Button variant="primary" icon={<Smartphone className="size-4" />} onClick={() => setPairOpen(true)}>{tr('Handy koppeln')}</Button>
        </Row>
        <Row title={tr('Geräte im Netzwerk erlauben')} desc={tr('Nötig für den Handy-Sync. Jede Anfrage braucht trotzdem ein gekoppeltes Gerät.')}>
          <Toggle
            checked={hubInfo.lanEnabled}
            onChange={async (v) => {
              await hubFetch('/api/hub/settings', { body: { lanEnabled: v } });
              load();
            }}
          />
        </Row>
        <Row title={tr('Name des Hubs')}>
          <Input defaultValue={hubInfo.name} className="w-52" onBlur={async (e) => e.target.value.trim() && (await hubFetch('/api/hub/settings', { body: { name: e.target.value.trim() } }))} />
        </Row>
        {hubInfo.dataDir && (
          <Row title={tr('Datenordner')} desc={<span className="font-mono text-[11px] break-all">{hubInfo.dataDir}</span>}>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const r = await hubFetch<{ file: string }>('/api/backup', { body: {} });
                toast.success(tr('Sicherung gespeichert: {0}', r.file.split('/').pop()));
              }}
            >{tr('Jetzt sichern')}</Button>
          </Row>
        )}
      </Panel>
      <div className="t-overline px-1 pt-2 text-ink-muted">{tr('Gekoppelte Geräte')}</div>
      <Panel className="divide-y divide-line">
        {devices.length === 0 ? (
          <div className="px-4 py-4 text-[15px] text-ink-muted">{tr('Noch keine Geräte.')}</div>
        ) : (
          devices.map((d) => (
            <Row key={d.id} title={d.name} desc={tr('Gekoppelt am {0}{1}', new Date(d.createdAt).toLocaleDateString(LOCALE), d.lastSeenAt ? tr(' · zuletzt gesehen {0}', new Date(d.lastSeenAt).toLocaleString(LOCALE)) : '')}>
              <Button
                size="sm"
                variant="ghost"
                className="text-koralle-ink"
                onClick={async () => {
                  if (!(await confirm(tr('{0} entkoppeln?', d.name), { body: tr('Das Gerät synchronisiert nicht mehr, bis du es neu koppelst.'), confirm: tr('Entkoppeln'), danger: true }))) return;
                  await hubFetch(`/api/devices/${d.id}`, { method: 'DELETE' });
                  load();
                }}
              >{tr('Entkoppeln')}</Button>
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
        <div className="t-label">{tr('Nicht verbunden')}</div>
        <p className="mt-1 text-[15px] text-ink-muted">{tr('Anker funktioniert komplett offline. Verbinde dich mit der Anker-App auf deinem Mac, um zu synchronisieren und den KI-Tutor zu nutzen.')}</p>
        <Button variant="primary" className="mt-4" onClick={() => navigate('/connect')}>{tr('Mit meinem Mac verbinden')}</Button>
      </Panel>
    );
  }
  return (
    <Panel className="divide-y divide-line">
      <Row
        title={tr('Verbunden mit {0}', hub.name ?? tr('deinem Mac'))}
        desc={
          <>
            {hub.url} · {sync.status === 'idle' ? tr('synchronisiert {0}', sync.lastSync ? uhrzeit(sync.lastSync) : '') : sync.status === 'syncing' ? tr('synchronisiert …') : sync.status === 'offline' ? tr('nicht erreichbar') : tr('Sync-Fehler')}
            {sync.error ? ` – ${sync.error}` : ''}
          </>
        }
      >
        <Button size="sm" icon={sync.status === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} onClick={() => void syncNow()}>{tr('Jetzt synchronisieren')}</Button>
      </Row>
      {hub.urls && hub.urls.length > 1 && (
        <Row title={tr('Bekannte Adressen')} desc={hub.urls.join(' · ')}>
          <span />
        </Row>
      )}
      <Row title={tr('Trennen')} desc={tr('Deine Karten bleiben auf diesem Gerät, der Sync stoppt.')}>
        <Button
          size="sm"
          variant="ghost"
          className="text-koralle-ink"
          onClick={async () => {
            if (!(await confirm(tr('Vom Mac trennen?'), { confirm: tr('Trennen'), danger: true }))) return;
            await setHub(null);
            await resetSyncState();
            toast(tr('Getrennt'));
          }}
        >{tr('Trennen')}</Button>
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
    <Section title={tr('Mac-App')}>
      <Panel className="divide-y divide-line">
        <Row title={tr('Beim Anmelden öffnen')} desc={tr('Hält Sync und MCP-Server für dein Handy und KI-Apps bereit.')}>
          <Toggle
            checked={s.openAtLogin}
            onChange={async (v) => {
              await desktop!.setOpenAtLogin(v);
              setS({ ...s, openAtLogin: v });
            }}
          />
        </Row>
        <Row title={tr('Kurzbefehl: Schnell hinzufügen')} desc={tr('Ein deutsches Wort von überall auf dem Mac festhalten.')}>
          <Input
            defaultValue={s.shortcut}
            className="w-52 font-mono text-[13px]"
            onBlur={async (e) => {
              const ok = await desktop!.setShortcut(e.target.value.trim());
              if (ok) toast.success(tr('Kurzbefehl gespeichert'));
              else toast.error(tr('Dieser Kurzbefehl ist belegt oder ungültig'));
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
      <PageHeader title={tr('Einstellungen')} />

      <Section title={tr('Lernen')}>
        <StudyPrefs prefs={prefs} />
      </Section>

      <Section title={tr('KI-Tutor · Claude & Codex')}>
        <AISection prefs={prefs} admin={admin} />
      </Section>

      <Section title={admin ? tr('Sync & Geräte') : tr('Sync')}>{admin ? <HubAdmin /> : <SyncClient />}</Section>

      <Section title={tr('Stimme')}>
        <VoicePrefs />
      </Section>

      <Section title={tr('Darstellung')}>
        <Panel className="space-y-4 p-4">
          <div>
            <Label>{tr('Sprache der App')}</Label>
            <Segmented value={lang} onChange={(v) => setLang(v)} options={LANGS} />
            <p className="t-caption mt-1.5 text-ink-muted">{tr('Die Oberfläche ist auf Deutsch oder Englisch. Deine Karten bleiben, wie sie sind.')}</p>
          </div>
          <Segmented
            value={theme}
            onChange={(v) => {
              setTheme(v);
              setThemePref(v);
            }}
            options={[
              { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="size-4" />{tr('System')}</span> },
              { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-4" />{tr('Hell')}</span> },
              { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-4" />{tr('Nacht')}</span> },
            ]}
          />
        </Panel>
      </Section>

      <DesktopPrefs />

      <Section title={tr('Daten')}>
        <Panel className="divide-y divide-line">
          <Row title={tr('Importieren')} desc={tr('Anki-Decks (.apkg), CSV/TSV-Wortlisten oder eine Anker-Sicherung.')}>
            <Button size="sm" onClick={() => navigate('/import')}>{tr('Importieren …')}</Button>
          </Row>
          <Row title={tr('Sicherung exportieren')} desc={tr('Alles auf diesem Gerät als eine JSON-Datei.')}>
            <Button size="sm" onClick={() => void exportBackup()}>{tr('Herunterladen')}</Button>
          </Row>
          {!admin && (
            <Row title={tr('Dieses Gerät zurücksetzen')} desc={tr('Löscht alle lokalen Daten. Synchronisierte Daten bleiben auf deinem Mac.')}>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  if (!(await confirm(tr('Alle Daten auf diesem Gerät löschen?'), { body: tr('Karten, die nicht mit einem Mac synchronisiert sind, gehen verloren.'), confirm: tr('Löschen'), danger: true }))) return;
                  await db.delete();
                  localStorage.clear();
                  location.reload();
                }}
              >{tr('Löschen')}</Button>
            </Row>
          )}
        </Panel>
      </Section>

      <Section title={tr('Über Anker')}>
        <Panel className="divide-y divide-line">
          <Row title={tr('Anker {0}', typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '')} desc={tr('Karteikarten mit FSRS für Deutsch, mit Claude & Codex über MCP.')}>
            <Button size="sm" variant="ghost" icon={<Code2 className="size-4" />} onClick={() => openExternal(REPO_URL)}>{tr('GitHub')}{' '}<ExternalLink className="size-3.5" />
            </Button>
          </Row>
          <Row title={tr('Plattform')} desc={isDesktop ? tr('Mac-App (Hub)') : isNative ? tr('Android-App') : tr('Web')}>
            {isDesktop ? <Laptop className="size-5 text-ink-muted" /> : <Smartphone className="size-5 text-ink-muted" />}
          </Row>
        </Panel>
      </Section>
      {confirmNode}
    </div>
  );
}
