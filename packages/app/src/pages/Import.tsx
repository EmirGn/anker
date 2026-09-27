import { isNewer, SYNC_TABLES, type AnyRecord, type NoteInput, type TableName } from '@anker/core';
import { Download, FileSpreadsheet, FileUp, Package, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { DeckSelect } from '../components/DeckSelect';
import { Button, Chip, Input, Label, PageHeader, Panel, Section, Segmented, Select, Spinner, Textarea, toast, Toggle } from '../components/ui';
import { importAnkiPackage, parseAnkiPackage, type AnkiPackage } from '../lib/anki';
import { db, TABLES } from '../lib/db';
import { addNotes, commit, createDeckPath } from '../lib/repo';
import { navigate } from '../lib/router';

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
      toast.success(`Imported ${r.notes} notes${r.reviews ? ` with ${r.reviews} reviews` : ''}`);
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
        <Package className="size-6 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Anki deck (.apkg / .colpkg)</div>
          <div className="text-[13px] text-muted">Decks, tags, images and — optionally — your review history, replayed through FSRS.</div>
        </div>
        <Picker accept=".apkg,.colpkg,.zip" onFile={load} label="Choose file" icon={<FileUp className="size-4" />} />
      </div>
      {status && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" /> {status}
        </div>
      )}
      {pkg && !busy && (
        <div className="mt-5 space-y-4 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            <Chip>{pkg.format}</Chip>
            <Chip>{pkg.notes.length} notes</Chip>
            <Chip>{pkg.decks.length} decks</Chip>
            <Chip>{pkg.revlog.length} reviews</Chip>
            {pkg.images > 0 && <Chip>{pkg.images} images</Chip>}
          </div>
          <div className="text-[13px] text-muted">{pkg.decks.slice(0, 8).join(' · ')}{pkg.decks.length > 8 ? ' …' : ''}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label hint="optional">Put decks under</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. Anki" />
            </div>
            <div className="flex items-end gap-3 pb-2">
              <Toggle checked={keepHistory} onChange={setKeepHistory} label="Keep progress" />
              <span className="text-[14px]">Keep review history & progress</span>
            </div>
          </div>
          <Button variant="primary" onClick={run} loading={busy}>
            Import {pkg.notes.length} notes
          </Button>
        </div>
      )}
    </Panel>
  );
}

const COLS = [
  { v: 'ignore', l: 'Ignore' },
  { v: 'german', l: 'German' },
  { v: 'english', l: 'Meaning' },
  { v: 'gender', l: 'Gender' },
  { v: 'plural', l: 'Plural' },
  { v: 'forms', l: 'Forms' },
  { v: 'example', l: 'Example' },
  { v: 'exampleTranslation', l: 'Example translation' },
  { v: 'notes', l: 'Notes' },
  { v: 'tags', l: 'Tags' },
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
      if (r.errors.length) toast.error(`${r.errors.length} rows skipped (${r.errors[0]})`);
      toast.success(`Imported ${r.added} words`);
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <FileSpreadsheet className="size-6 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Word list (CSV / TSV)</div>
          <div className="text-[13px] text-muted">Paste from a spreadsheet or pick a file. Articles in the German column are detected automatically.</div>
        </div>
        <Picker accept=".csv,.tsv,.txt" onFile={(f) => void f.text().then(setText)} label="Choose file" icon={<FileUp className="size-4" />} />
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="mt-4 font-mono text-[12.5px]" rows={5} placeholder={'der Tisch\ttable\t\tTische\ndie Zeitung\tnewspaper\t\tZeitungen'} />
      {rows.length > 0 && (
        <div className="mt-4 space-y-4">
          <div className="thin-scroll overflow-x-auto">
            <table className="text-[12.5px]">
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, i) => (
                    <th key={i} className="pr-2 pb-2 text-left">
                      <Select value={map[i] ?? 'ignore'} onChange={(e) => setMap((m) => Object.assign([...m], { [i]: e.target.value }))} className="h-8 w-36 text-[12px]">
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
                      <td key={j} className="max-w-40 truncate border-t border-line py-1 pr-2 text-muted">
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
              <Toggle checked={skipHeader} onChange={setSkipHeader} label="First row is a header" /> First row is a header
            </label>
            <Button variant="primary" onClick={run} loading={busy} disabled={!map.includes('german') || !map.includes('english')}>
              Import {data.length} words
            </Button>
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
      if (dump?.app !== 'anker') throw new Error('Not an Anker backup file');
      let n = 0;
      for (const t of SYNC_TABLES) {
        const recs = (dump[t] ?? []) as AnyRecord[];
        if (!recs.length) continue;
        const local = await TABLES[t as TableName]().bulkGet(recs.map((r) => r.id));
        const newer = recs.filter((r, i) => isNewer(r, local[i] as AnyRecord | undefined));
        for (let i = 0; i < newer.length; i += 1000) await commit([{ table: t, put: newer.slice(i, i + 1000) }]);
        n += newer.length;
      }
      toast.success(`Restored ${n} records`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="flex flex-wrap items-center gap-3 p-5">
      <Upload className="size-6 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Anker backup (.json)</div>
        <div className="text-[13px] text-muted">Merges a backup into this device — newer versions win.</div>
      </div>
      {busy ? <Spinner /> : <Picker accept=".json" onFile={load} label="Choose file" icon={<FileUp className="size-4" />} />}
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
      <Download className="size-6 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Export</div>
        <div className="text-[13px] text-muted">Your vocabulary as CSV, or a full backup.</div>
      </div>
      <Segmented
        value={what}
        onChange={setWhat}
        size="sm"
        options={[
          { value: 'csv', label: 'Words (CSV)' },
          { value: 'json', label: 'Backup (JSON)' },
        ]}
      />
      <Button onClick={() => void run()}>Download</Button>
    </Panel>
  );
}

export function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <PageHeader title="Import & export" subtitle="Bring your Anki decks and word lists along." />
      <Section title="Import">
        <div className="space-y-3">
          <AnkiImport />
          <CsvImport />
          <BackupImport />
        </div>
      </Section>
      <Section title="Export">
        <Export />
      </Section>
    </div>
  );
}
