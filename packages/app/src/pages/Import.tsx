import { isNewer, SYNC_TABLES, type AnyRecord, type NoteInput, type TableName } from '@anker/core';
import { Download, FileSpreadsheet, FileUp, Package, Upload } from '../components/icons';
import { useMemo, useRef, useState } from 'react';
import { DeckSelect } from '../components/DeckSelect';
import { Button, Chip, Input, Label, PageHeader, Panel, Section, Segmented, Select, Spinner, Textarea, toast, Toggle } from '../components/ui';
import { importAnkiPackage, parseAnkiPackage, type AnkiPackage } from '../lib/anki';
import { db, TABLES } from '../lib/db';
import { addNotes, commit, createDeckPath } from '../lib/repo';
import { navigate } from '../lib/router';
import { tr } from '../lib/i18n';

function Picker({ accept, onFile, label, icon }: { accept: string; onFile: (f: File) => void; label: string; icon: React.ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <Button onClick={() => ref.current?.click()} icon={icon}>
        {label}
      </Button>
    </>
  );
}

function AnkiImport() {
  const [pkg, setPkg] = useState<AnkiPackage | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [keepHistory, setKeepHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = async (f: File) => {
    setBusy(true);
    setPkg(null);
    try {
      setPkg(await parseAnkiPackage(f, setStatus));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };
  const run = async () => {
    if (!pkg) return;
    setBusy(true);
    try {
      const r = await importAnkiPackage(pkg, { prefix, keepHistory }, setStatus);
      toast.success(tr('{0} Notizen importiert{1}', r.notes, r.reviews ? tr(', mit {0} Wiederholungen', r.reviews) : ''));
      navigate('/decks');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Package className="size-6 text-ink" />
        <div className="min-w-0 flex-1">
          <div className="t-label">{tr('Anki-Deck (.apkg / .colpkg)')}</div>
          <div className="t-caption text-ink-muted">{tr('Decks, Tags, Bilder und auf Wunsch dein Lernverlauf, neu berechnet mit FSRS.')}</div>
        </div>
        <Picker accept=".apkg,.colpkg,.zip" onFile={load} label={tr('Datei wählen')} icon={<FileUp className="size-4" />} />
      </div>
      {status && (
        <div className="mt-4 flex items-center gap-2 text-[15px] text-ink-muted">
          <Spinner className="size-4" /> {status}
        </div>
      )}
      {pkg && !busy && (
        <div className="mt-5 space-y-4 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            <Chip>{pkg.format}</Chip>
            <Chip>{pkg.notes.length}{' '}{tr('Notizen')}</Chip>
            <Chip>{pkg.decks.length}{' '}{tr('Decks')}</Chip>
            <Chip>{pkg.revlog.length}{' '}{tr('Wiederholungen')}</Chip>
            {pkg.images > 0 && <Chip>{pkg.images}{' '}{tr('Bilder')}</Chip>}
          </div>
          <div className="t-caption text-ink-muted">{pkg.decks.slice(0, 8).join(' · ')}{pkg.decks.length > 8 ? ' …' : ''}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label hint={tr('optional')}>{tr('Decks einordnen unter')}</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={tr('z. B. Anki')} />
            </div>
            <div className="flex items-end gap-3 pb-2">
              <Toggle checked={keepHistory} onChange={setKeepHistory} label={tr('Fortschritt behalten')} />
              <span className="text-[15px]">{tr('Lernverlauf und Fortschritt behalten')}</span>
            </div>
          </div>
          <Button variant="primary" onClick={run} loading={busy}>
            {tr('{0} Notizen importieren', pkg.notes.length)}</Button>
        </div>
      )}
    </Panel>
  );
}

const COLS = [
  { v: 'ignore', l: tr('Ignorieren') },
  { v: 'german', l: tr('Deutsch') },
  { v: 'english', l: tr('Bedeutung') },
  { v: 'gender', l: tr('Genus') },
  { v: 'plural', l: tr('Plural') },
  { v: 'forms', l: tr('Formen') },
  { v: 'example', l: tr('Beispiel') },
  { v: 'exampleTranslation', l: tr('Übersetzung') },
  { v: 'notes', l: tr('Notizen') },
  { v: 'tags', l: tr('Tags') },
];

function parseDelimited(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) return [];
  const sample = lines.slice(0, 5).join('\n');
  const delim = sample.includes('\t') ? '\t' : (sample.match(/;/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? ';' : ',';
  return lines.map((line) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

function CsvImport() {
  const [text, setText] = useState('');
  const [deckId, setDeckId] = useState<string | null>(null);
  const [skipHeader, setSkipHeader] = useState(false);
  const [map, setMap] = useState<string[]>(['german', 'english', 'gender', 'plural', 'example', 'exampleTranslation']);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseDelimited(text), [text]);
  const data = skipHeader ? rows.slice(1) : rows;
  const width = Math.max(0, ...rows.slice(0, 20).map((r) => r.length));
  const run = async () => {
    setBusy(true);
    try {
      const target = deckId ?? (await createDeckPath('Deutsch::Import')).id;
      const inputs: NoteInput[] = data.map((r) => {
        const fields: Record<string, string> = {};
        let tags: string[] = [];
        r.forEach((cell, i) => {
          const key = map[i] ?? 'ignore';
          if (key === 'ignore' || !cell) return;
          if (key === 'tags') tags = cell.split(/[\s,]+/);
          else fields[key] = cell;
        });
        return { deckId: target, type: 'word', fields, tags, source: 'import' };
      });
      const r = await addNotes(inputs);
      if (r.errors.length) toast.error(tr('{0} Zeilen übersprungen ({1})', r.errors.length, r.errors[0]));
      toast.success(tr('{0} Wörter importiert', r.added));
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <FileSpreadsheet className="size-6 text-ink" />
        <div className="min-w-0 flex-1">
          <div className="t-label">{tr('Wortliste (CSV / TSV)')}</div>
          <div className="t-caption text-ink-muted">{tr('Aus einer Tabelle einfügen oder Datei wählen. Artikel in der deutschen Spalte werden automatisch erkannt.')}</div>
        </div>
        <Picker accept=".csv,.tsv,.txt" onFile={(f) => void f.text().then(setText)} label={tr('Datei wählen')} icon={<FileUp className="size-4" />} />
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="mt-4 font-mono text-[13px]" rows={5} placeholder={tr('der Tisch	table		Tische\ndie Zeitung	newspaper		Zeitungen')} />
      {rows.length > 0 && (
        <div className="mt-4 space-y-4">
          <div className="thin-scroll overflow-x-auto">
            <table className="text-[13px]">
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, i) => (
                    <th key={i} className="pr-2 pb-2 text-left">
                      <Select value={map[i] ?? 'ignore'} onChange={(e) => setMap((m) => Object.assign([...m], { [i]: e.target.value }))} className="h-8 w-36 text-[13px]">
                        {COLS.map((c) => (
                          <option key={c.v} value={c.v}>
                            {c.l}
                          </option>
                        ))}
                      </Select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    {Array.from({ length: width }, (_, j) => (
                      <td key={j} className="max-w-40 truncate border-t border-line py-1 pr-2 text-ink-muted">
                        {r[j] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DeckSelect value={deckId} onChange={setDeckId} className="w-60" />
            <label className="flex items-center gap-2 text-[13.5px]">
              <Toggle checked={skipHeader} onChange={setSkipHeader} label={tr('Erste Zeile ist eine Überschrift')} />{' '}{tr('Erste Zeile ist eine Überschrift')}</label>
            <Button variant="primary" onClick={run} loading={busy} disabled={!map.includes('german') || !map.includes('english')}>
              {tr('{0} Wörter importieren', data.length)}</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function BackupImport() {
  const [busy, setBusy] = useState(false);
  const load = async (f: File) => {
    setBusy(true);
    try {
      const dump = JSON.parse(await f.text());
      if (dump?.app !== 'anker') throw new Error(tr('Keine Anker-Sicherungsdatei'));
      let n = 0;
      for (const t of SYNC_TABLES) {
        const recs = (dump[t] ?? []) as AnyRecord[];
        if (!recs.length) continue;
        const local = await TABLES[t as TableName]().bulkGet(recs.map((r) => r.id));
        const newer = recs.filter((r, i) => isNewer(r, local[i] as AnyRecord | undefined));
        for (let i = 0; i < newer.length; i += 1000) await commit([{ table: t, put: newer.slice(i, i + 1000) }]);
        n += newer.length;
      }
      toast.success(tr('{0} Einträge wiederhergestellt', n));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="flex flex-wrap items-center gap-3 p-5">
      <Upload className="size-6 text-ink" />
      <div className="min-w-0 flex-1">
        <div className="t-label">{tr('Anker-Sicherung (.json)')}</div>
        <div className="t-caption text-ink-muted">{tr('Führt eine Sicherung mit diesem Gerät zusammen – neuere Versionen gewinnen.')}</div>
      </div>
      {busy ? <Spinner /> : <Picker accept=".json" onFile={load} label={tr('Datei wählen')} icon={<FileUp className="size-4" />} />}
    </Panel>
  );
}

function Export() {
  const [what, setWhat] = useState<'csv' | 'json'>('csv');
  const run = async () => {
    let blob: Blob;
    let name: string;
    if (what === 'csv') {
      const notes = await db.notes.where('type').equals('word').toArray();
      const esc = (s = '') => `"${s.replace(/"/g, '""')}"`;
      const lines = [['german', 'gender', 'plural', 'english', 'pos', 'forms', 'example', 'exampleTranslation', 'tags'].join(',')];
      for (const n of notes) {
        const f = n.fields;
        lines.push([f.german, f.gender, f.plural, f.english, f.pos, f.forms, f.example, f.exampleTranslation, n.tags.join(' ')].map(esc).join(','));
      }
      blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      name = 'anker-words.csv';
    } else {
      const dump: Record<string, unknown> = { app: 'anker', version: 1, exportedAt: Date.now() };
      for (const t of SYNC_TABLES) dump[t] = await TABLES[t]().toArray();
      blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
      name = `anker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  return (
    <Panel className="flex flex-wrap items-center gap-3 p-5">
      <Download className="size-6 text-ink" />
      <div className="min-w-0 flex-1">
        <div className="t-label">{tr('Exportieren')}</div>
        <div className="t-caption text-ink-muted">{tr('Dein Wortschatz als CSV oder eine komplette Sicherung.')}</div>
      </div>
      <Segmented
        value={what}
        onChange={setWhat}
        size="sm"
        options={[
          { value: 'csv', label: tr('Wörter (CSV)') },
          { value: 'json', label: tr('Sicherung (JSON)') },
        ]}
      />
      <Button onClick={() => void run()}>{tr('Herunterladen')}</Button>
    </Panel>
  );
}

export function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 pt-8 pb-16 md:px-8 md:pt-10">
      <PageHeader title={tr('Import & Export')} subtitle={tr('Bring deine Anki-Decks und Wortlisten mit.')} />
      <Section title={tr('Importieren')}>
        <div className="space-y-3">
          <AnkiImport />
          <CsvImport />
          <BackupImport />
        </div>
      </Section>
      <Section title={tr('Exportieren')}>
        <Export />
      </Section>
    </div>
  );
}
