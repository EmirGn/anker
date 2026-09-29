import {
  CardState,
  duplicateKey,
  genderHints,
  makeNote,
  normalizeFields,
  NOTE_TYPE_ORDER,
  NOTE_TYPES,
  parseGender,
  splitArticle,
  validateNote,
  type Card,
  type Gender,
  type Note,
  type NoteType,
} from '@anker/core';
import { ArrowLeft, Eye, RotateCcw, Sparkles, Trash2, Wand2 } from '../components/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CardView, GENDER_VAR, POS_LABEL } from '../components/CardView';
import { DeckSelect } from '../components/DeckSelect';
import { TagInput } from '../components/TagInput';
import { UmlautBar, insertAtCaret } from '../components/UmlautBar';
import { Button, cx, Input, Label, Panel, Segmented, Spinner, Textarea, toast, useConfirm } from '../components/ui';
import { erklaereGenus, fehlerDe, fieldDe, ruleLabel, templateDe, TYPE_DE } from '../lib/de';
import { relativ } from '../lib/format';
import { runTask } from '../lib/ai';
import { db } from '../lib/db';
import { useDecks, useHotkeys, useHub, useIsWide, useLiveQuery } from '../lib/hooks';
import { isNative, isPhoneApp, modKey } from '../lib/platform';
import { addNote, createDeckPath, deleteNotes, forgetNotes, suspendNotes, updateNote } from '../lib/repo';
import { goBack, navigate, useRoute } from '../lib/router';
import { lang, tr } from '../lib/i18n';

const LAST_DECK = 'anker-last-deck';
const LAST_TYPE = 'anker-last-type';
const POS_OPTIONS = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'preposition', 'conjunction', 'pronoun', 'other'];
const STATE_LABEL: Record<CardState, string> =
  lang === 'de' ? { 0: 'Neu', 1: 'In Arbeit', 2: 'Wiederholung', 3: 'Wieder in Arbeit' } : { 0: 'New', 1: 'Learning', 2: 'Review', 3: 'Relearning' };

function emptyFields(type: NoteType): Record<string, string> {
  return Object.fromEntries(NOTE_TYPES[type].fields.map((f) => [f.key, '']));
}

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface NoteEditorProps {
  noteId?: string;
  embedded?: boolean;
  onSaved?: (note: Note) => void;
  defaults?: { deckId?: string; type?: NoteType; fields?: Record<string, string>; tags?: string[] };
}

export function NoteEditor({ noteId, embedded, onSaved, defaults }: NoteEditorProps) {
  const decks = useDecks();
  const hub = useHub();
  const wide = useIsWide();
  const [confirm, confirmNode] = useConfirm();
  const editing = !!noteId;
  const [loaded, setLoaded] = useState(!editing);
  const [type, setType] = useState<NoteType>(() => defaults?.type ?? ((ls(LAST_TYPE) as NoteType) || 'word'));
  const [deckId, setDeckId] = useState<string | null>(defaults?.deckId ?? ls(LAST_DECK));
  const [fields, setFields] = useState<Record<string, string>>(() => ({ ...emptyFields(defaults?.type ?? ((ls(LAST_TYPE) as NoteType) || 'word')), ...(defaults?.fields ?? {}) }));
  const [tags, setTags] = useState<string[]>(defaults?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewOrd, setPreviewOrd] = useState(0);
  const lastFocused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const lastKey = useRef<string | null>(null);
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const note = useLiveQuery(() => (noteId ? db.notes.get(noteId) : undefined), [noteId]);
  const cards = useLiveQuery(() => (noteId ? db.cards.where('noteId').equals(noteId).toArray() : []), [noteId]);

  useEffect(() => {
    if (note && !loaded) {
      setType(note.type);
      setDeckId(note.deckId);
      setFields({ ...emptyFields(note.type), ...note.fields });
      setTags(note.tags);
      setLoaded(true);
    }
  }, [note, loaded]);

  useEffect(() => {
    if (!decks || editing) return;
    if (deckId && decks.some((d) => d.id === deckId)) return;
    const first = decks.find((d) => !d.parentId) ?? decks[0];
    if (first) setDeckId(first.id);
  }, [decks, deckId, editing]);

  const set = (key: string, v: string) => setFields((f) => ({ ...f, [key]: v }));

  const changeType = (t: NoteType) => {
    setType(t);
    setFields((prev) => {
      const next = emptyFields(t);
      const main = prev.german || prev.front || prev.text || '';
      const second = prev.english || prev.back || '';
      if (t === 'word') Object.assign(next, { german: main, english: second });
      else if (t === 'cloze') Object.assign(next, { text: main, extra: second });
      else Object.assign(next, { front: main, back: second });
      return next;
    });
    setPreviewOrd(0);
  };

  // Duplicate detection
  const dupKey = useMemo(() => duplicateKey({ type, fields }), [type, fields]);
  const duplicate = useLiveQuery(async () => {
    if (!dupKey || dupKey.length < 2) return null;
    const all = await db.notes.toArray();
    return all.find((n) => n.id !== noteId && duplicateKey(n) === dupKey) ?? null;
  }, [dupKey, noteId]);
  const dupDeck = decks?.find((d) => d.id === duplicate?.deckId);

  const gender = parseGender(fields.gender);
  const hints = type === 'word' && fields.german && !gender && /^[A-ZÄÖÜ]/.test(fields.german.trim()) ? genderHints(fields.german) : [];

  const previewNote: Note | null = useMemo(() => {
    try {
      if (!deckId) return null;
      const n = makeNote({ deckId, type, fields, tags }, Date.now()).note;
      return n;
    } catch {
      return null;
    }
  }, [deckId, type, fields, tags]);
  const ords = previewNote ? (type === 'cloze' ? [...new Set((fields.text ?? '').match(/\{\{c(\d+)::/g)?.map((m) => Number(m.slice(3, -2)) - 1) ?? [])].sort() : NOTE_TYPES[type].templates.map((_, i) => i)) : [];

  const aiFill = async () => {
    const word = (fields.german || fields.english || '').trim();
    if (!word) {
      toast(tr('Gib zuerst ein Wort ein'));
      return;
    }
    setFilling(true);
    try {
      const r = await runTask<Record<string, string>>('fill-word', { word, hint: fields.english && fields.german ? fields.english : '' });
      if (!r.ok || !r.structured) throw new Error(r.error ?? tr('Kein Ergebnis'));
      const s = r.structured;
      setFields((f) => {
        const next = { ...f };
        for (const [k, v] of Object.entries(s)) {
          if (typeof v !== 'string') continue;
          if (k === 'german' && f.german && f.german.trim()) continue;
          if (!next[k]?.trim()) next[k] = v;
        }
        return normalizeFields('word', next);
      });
      toast.success(tr('Von der KI ausgefüllt – bitte prüfen'));
    } catch (e) {
      toast.error(tr('KI-Ausfüllen fehlgeschlagen: {0}', (e as Error).message));
    } finally {
      setFilling(false);
    }
  };

  const reset = () => {
    setFields(emptyFields(type));
    requestAnimationFrame(() => firstRef.current?.focus());
  };

  const save = async () => {
    if (saving) return;
    let targetDeck = deckId;
    if (!targetDeck) {
      targetDeck = (await createDeckPath('Deutsch')).id;
      setDeckId(targetDeck);
    }
    const err = validateNote({ type, fields: normalizeFields(type, fields) });
    if (err) {
      toast.error(fehlerDe(type, err));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const n = await updateNote(noteId!, { fields, tags, deckId: targetDeck });
        toast.success(tr('Gespeichert'));
        onSaved?.(n);
      } else {
        const r = await addNote({ deckId: targetDeck, type, fields, tags });
        try {
          localStorage.setItem(LAST_DECK, targetDeck);
          localStorage.setItem(LAST_TYPE, type);
        } catch {
          // ignore
        }
        toast.success(r.cards.length === 1 ? tr('1 Karte hinzugefügt') : tr('{0} Karten hinzugefügt', r.cards.length), {
          label: tr('Rückgängig'),
          run: () => void deleteNotes([r.note.id]),
        });
        onSaved?.(r.note);
        reset();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  useHotkeys({ 'mod+enter': (e) => { e.preventDefault(); void save(); } }, [fields, tags, type, deckId, saving], true);

  if (!loaded || (editing && note === undefined)) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (editing && note === null) return <p className="py-10 text-center text-ink-muted">{tr('Diese Notiz gibt es nicht mehr.')}</p>;

  const focusProps = (key: string, ref?: boolean) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      lastFocused.current = e.currentTarget;
      lastKey.current = key;
    },
    ...(ref ? { ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => (firstRef.current = el) } : {}),
  });

  const fieldInput = (key: string, label: string, opts: { placeholder?: string; multiline?: boolean; big?: boolean; first?: boolean; hint?: string; lang?: string } = {}) => (
    <div key={key}>
      <Label hint={opts.hint}>{tr(label)}</Label>
      {opts.multiline ? (
        <Textarea
          value={fields[key] ?? ''}
          onChange={(e) => set(key, e.target.value)}
          placeholder={opts.placeholder}
          rows={2}
          lang={opts.lang}
          {...(focusProps(key, opts.first) as object)}
        />
      ) : (
        <Input
          value={fields[key] ?? ''}
          onChange={(e) => set(key, e.target.value)}
          placeholder={opts.placeholder}
          lang={opts.lang}
          className={opts.big ? 'h-13 font-display text-[22px] font-semibold' : undefined}
          autoCapitalize={opts.lang === 'de' ? 'sentences' : undefined}
          {...(focusProps(key, opts.first) as object)}
        />
      )}
    </div>
  );

  const wordForm = (
    <div className="space-y-4">
      <div>
        <Label hint={hub ? undefined : tr('Tipp: „der Tisch“ tippen – der Artikel wird erkannt')}>{tr('Deutsch')}</Label>
        <div className="flex gap-2">
          <Input
            value={fields.german ?? ''}
            onChange={(e) => set('german', e.target.value)}
            onBlur={() => {
              const sp = splitArticle(fields.german ?? '');
              if (sp.gender) setFields((f) => ({ ...f, german: sp.word, gender: f.gender || sp.gender!, pos: f.pos || 'noun' }));
            }}
            placeholder={tr('z. B. die Zeitung, fahren, gemütlich')}
            lang="de"
            autoFocus={!editing && !isNative}
            className="h-13 font-display text-[22px] font-semibold"
            {...(focusProps('german', true) as object)}
          />
          {hub && (
            <Button onClick={aiFill} loading={filling} className="h-13 shrink-0" title={tr('Genus, Plural, Formen und ein Beispiel mit KI ausfüllen')} icon={!filling && <Wand2 className="size-4" />}>
              <span className="hidden sm:inline">{tr('Ausfüllen')}</span>
            </Button>
          )}
        </div>
        {hints.length > 0 && (
          <button
            type="button"
            onClick={() => setFields((f) => ({ ...f, gender: hints[0]!.gender, pos: f.pos || 'noun' }))}
            className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-paper-sunk px-2.5 py-1 text-[13px] text-ink-muted hover:text-ink"
          >
            <Sparkles className="size-4" />{tr('Wahrscheinlich')}{' '}<b style={{ color: GENDER_VAR[hints[0]!.gender] }}>{hints[0]!.gender}</b> ({ruleLabel(hints[0]!.rule)}{tr(') – antippen zum Übernehmen')}</button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(['der', 'die', 'das', 'pl'] as Gender[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setFields((f) => ({ ...f, gender: f.gender === g ? '' : g, pos: f.gender === g ? f.pos : f.pos || 'noun' }))}
            className={cx('h-11 min-w-14 rounded-full border px-4 text-[15px] font-bold transition-colors duration-[120ms]', gender === g ? 'border-transparent' : 'border-line bg-paper-raised hover:bg-paper-sunk')}
            style={gender === g ? (g === 'pl' ? { background: 'var(--paper-sunk)', color: 'var(--ink-muted)' } : { background: GENDER_VAR[g], color: 'var(--on-gender)' }) : { color: GENDER_VAR[g] }}
          >
            {g === 'pl' ? 'Pl.' : g}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        <div className="flex flex-wrap gap-1">
          {POS_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set('pos', fields.pos === p ? '' : p)}
              className={cx('h-9 rounded-full px-3 text-[13px] font-semibold transition-colors duration-[120ms]', fields.pos === p ? 'bg-ink text-paper' : 'text-ink-muted hover:bg-paper-sunk')}
            >
              {POS_LABEL[p] || tr('Andere')}
            </button>
          ))}
        </div>
      </div>
      {fieldInput('english', 'Bedeutung', { placeholder: tr('newspaper') })}
      {(fields.pos === 'noun' || gender) && fieldInput('plural', 'Plural', { placeholder: tr('Zeitungen  (oder „-“, wenn es keinen gibt)'), lang: 'de' })}
      {['verb', 'adjective', 'preposition'].includes(fields.pos ?? '') &&
        fieldInput('forms', fields.pos === 'verb' ? 'Verbformen' : fields.pos === 'adjective' ? 'Komparativ · Superlativ' : 'Kasus', {
          placeholder: fields.pos === 'verb' ? tr('fährt · fuhr · ist gefahren') : fields.pos === 'adjective' ? tr('größer · am größten') : tr('+ Dativ'),
          lang: 'de',
        })}
      {fieldInput('example', 'Beispielsatz', { placeholder: tr('Ich lese jeden Morgen die Zeitung.'), multiline: true, lang: 'de' })}
      {fieldInput('exampleTranslation', 'Übersetzung', { placeholder: 'I read the newspaper every morning.', multiline: true })}
      {fieldInput('notes', 'Notizen', { placeholder: tr('Eselsbrücke, Gebrauch, falsche Freunde …'), multiline: true })}
    </div>
  );

  const genericForm = (
    <div className="space-y-4">
      {NOTE_TYPES[type].fields.map((f, i) => (
        <div key={f.key}>
          {fieldInput(f.key, fieldDe(type, f.key).label, { placeholder: f.placeholder, multiline: f.multiline, first: i === 0, hint: fieldDe(type, f.key).help, lang: f.german ? 'de' : undefined })}
          {type === 'cloze' && f.key === 'text' && (
            <div className="mt-2 flex flex-wrap gap-2">
              {[false, true].map((same) => (
                <Button
                  key={String(same)}
                  size="sm"
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const el = lastFocused.current;
                    const text = fields.text ?? '';
                    const nums = [...text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]));
                    const n = same ? Math.max(1, ...nums) : (nums.length ? Math.max(...nums) : 0) + 1;
                    const start = el?.selectionStart ?? text.length;
                    const end = el?.selectionEnd ?? text.length;
                    const sel = text.slice(start, end) || '…';
                    set('text', `${text.slice(0, start)}{{c${n}::${sel}}}${text.slice(end)}`);
                  }}
                >
                  {same ? tr('Lücke (gleiche Karte)') : tr('[…] Neue Lücke')}
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className={cx(!embedded && 'grid gap-6 lg:grid-cols-[1fr_380px]')}>
      <div>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {!editing && (
            <Segmented
              value={type}
              onChange={changeType}
              size={wide ? 'md' : 'sm'}
              options={NOTE_TYPE_ORDER.map((t) => ({ value: t, label: TYPE_DE[t].short }))}
            />
          )}
          <DeckSelect value={deckId} onChange={setDeckId} className="max-w-full min-w-48 flex-1 sm:max-w-72" />
        </div>
        <p className="t-caption -mt-2 mb-5 text-ink-muted">{TYPE_DE[type].description}</p>

        {duplicate && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-sonne px-3.5 py-2 text-[15px] text-on-sonne">
            <span className="flex-1">{tr('Schon in')}{' '}<b>{dupDeck?.name ?? tr('deiner Sammlung')}</b>: {duplicate.fields.german || duplicate.fields.front || '…'}
            </span>
            <Button size="sm" variant="ghost" className="text-on-sonne hover:bg-[#3a2a0014] hover:text-on-sonne" onClick={() => navigate(`/edit/${duplicate.id}`)}>{tr('Öffnen')}</Button>
          </div>
        )}

        {type === 'word' ? wordForm : genericForm}

        <div className="mt-4">
          <Label>{tr('Tags')}</Label>
          <TagInput value={tags} onChange={setTags} placeholder={tr('A2, küche, verb-trennbar…')} />
        </div>

        {!isPhoneApp && (
          <UmlautBar
            className="mt-4"
            onInsert={(ch) => {
              const el = lastFocused.current;
              const key = lastKey.current;
              if (el && key) insertAtCaret(el, ch, (v) => set(key, v));
            }}
          />
        )}

        <div className="sticky bottom-0 z-10 -mx-1 mt-6 flex flex-wrap items-center gap-2 bg-gradient-to-t from-paper via-paper to-transparent px-1 pt-4 pb-4">
          <Button variant="primary" size="lg" onClick={save} loading={saving} className="min-w-32">
            {editing ? tr('Speichern') : tr('Hinzufügen')}
          </Button>
          <span className="hidden text-[13px] text-ink-muted sm:inline">{modKey}{tr('+Enter')}</span>
          {!wide && (
            <Button variant="ghost" onClick={() => setPreview((v) => !v)} icon={<Eye className="size-5" />}>{tr('Vorschau')}</Button>
          )}
          {editing && !embedded && (
            <Button variant="ghost" className="ml-auto" onClick={() => goBack('/browse')}>{tr('Fertig')}</Button>
          )}
        </div>
      </div>

      {(!embedded && (wide || preview)) && (
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="t-overline text-ink-muted">{tr('Vorschau')}</span>
              {ords.length > 1 && (
                <Segmented
                  size="sm"
                  value={String(Math.min(previewOrd, ords.length - 1))}
                  onChange={(v) => setPreviewOrd(Number(v))}
                  options={ords.map((o, i) => ({ value: String(i), label: type === 'cloze' ? tr('c{0}', o + 1) : templateDe(type, o).split(' ')[0] ?? `#${i + 1}` }))}
                />
              )}
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-6">
              {previewNote && ords.length ? (
                <div className="space-y-8">
                  <div className="opacity-90">
                    <CardView note={previewNote} ord={ords[Math.min(previewOrd, ords.length - 1)]!} side="question" />
                  </div>
                  <div className="h-px bg-line" />
                  <CardView note={previewNote} ord={ords[Math.min(previewOrd, ords.length - 1)]!} side="answer" />
                </div>
              ) : (
                <p className="text-center text-[15px] text-ink-muted">{tr('Füll die Felder aus, um deine Karte zu sehen.')}</p>
              )}
            </div>
          </Panel>
          {type === 'word' && gender && fields.german && erklaereGenus(fields.german, gender) && (
            <Panel className="t-caption px-4 py-3 text-ink-muted">{erklaereGenus(fields.german, gender)}</Panel>
          )}
        </div>
      )}

      {editing && cards && cards.length > 0 && (
        <div className={cx(!embedded && 'lg:col-span-2')}>
          <Panel className="mt-2 p-4">
            <div className="t-overline mb-3 text-ink-muted">{tr('Karten')}</div>
            <div className="space-y-2">
              {cards
                .sort((a: Card, b: Card) => a.ord - b.ord)
                .map((c: Card) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                    <span className="w-44 font-semibold">{type === 'cloze' ? tr('Lücke {0}', c.ord + 1) : templateDe(type, c.ord)}</span>
                    <span className="text-ink-muted">{c.suspended ? tr('Ausgesetzt') : STATE_LABEL[c.state]}</span>
                    {c.state !== CardState.New && <span className="text-ink-muted">{tr('fällig')}{' '}{relativ(c.due)}</span>}
                    <span className="text-ink-muted">
                      {c.reps}{' '}{tr('Wiederholungen ·')}{' '}{c.lapses}{' '}{tr('Fehler')}</span>
                  </div>
                ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={async () => { await forgetNotes([noteId!]); toast.success(tr('Fortschritt zurückgesetzt – die Karten sind wieder neu')); }}>{tr('Fortschritt zurücksetzen')}</Button>
              <Button size="sm" onClick={async () => { const s = !cards.every((c) => c.suspended); await suspendNotes([noteId!], s); toast.success(s ? tr('Ausgesetzt') : tr('Wieder aktiv')); }}>
                {cards.every((c) => c.suspended) ? tr('Wieder aktivieren') : tr('Aussetzen')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  if (!(await confirm(tr('Diese Notiz löschen?'), { body: tr('Ihre Karten und der Lernverlauf werden auf allen Geräten entfernt.'), confirm: tr('Löschen'), danger: true }))) return;
                  await deleteNotes([noteId!]);
                  toast.success(tr('Gelöscht'));
                  if (embedded) onSaved?.(note!);
                  else goBack('/browse');
                }}
              >{tr('Löschen')}</Button>
            </div>
          </Panel>
        </div>
      )}
      {confirmNode}
    </div>
  );
}

export function Editor({ noteId }: { noteId?: string }) {
  const { query } = useRoute();
  const defaults = noteId
    ? undefined
    : {
        deckId: query.get('deck') ?? undefined,
        type: (query.get('type') as NoteType) ?? undefined,
        fields: Object.fromEntries(['german', 'english', 'gender', 'front', 'back', 'text'].filter((k) => query.get(k)).map((k) => [k, query.get(k)!])),
      };
  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 pb-4 md:px-8 md:pt-10">
      <div className="mb-6 flex items-center gap-3">
        {noteId && (
          <button onClick={() => goBack('/browse')} className="flex size-11 items-center justify-center rounded-md text-ink-muted hover:bg-paper-sunk" aria-label={tr('Zurück')}>
            <ArrowLeft className="size-5" />
          </button>
        )}
        <h1 className="t-title">{noteId ? tr('Notiz bearbeiten') : tr('Neue Karte')}</h1>
      </div>
      <NoteEditor noteId={noteId} defaults={defaults} onSaved={noteId ? () => goBack('/browse') : undefined} />
    </div>
  );
}
