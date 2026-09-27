import { plainText, type Note } from '@anker/core';
import { Brain, Lightbulb, ListPlus, MessageCircle, Sparkles } from './icons';
import { useEffect, useRef, useState } from 'react';
import { streamTask, type TaskKind } from '../lib/ai';
import { useHub } from '../lib/hooks';
import { renderMarkdown } from '../lib/markdown';
import { navigate } from '../lib/router';
import { Button, Modal, Segmented, Spinner } from './ui';

export function cardContext(note: Note): string {
  const lines = [`Note type: ${note.type}`];
  for (const [k, v] of Object.entries(note.fields)) if (v?.trim()) lines.push(`${k}: ${plainText(v)}`);
  if (note.tags.length) lines.push(`tags: ${note.tags.join(', ')}`);
  return lines.join('\n');
}

const cache = new Map<string, string>();

export function Markdown({ text, className }: { text: string; className?: string }) {
  // The tutor marks corrections with a pencil emoji; the UI shows no emoji.
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(text.replace(/\u270F\uFE0F?\s*/gu, '')) }} />;
}

export function AISheet({ note, open, onClose, initial = 'explain' }: { note: Note | null; open: boolean; onClose: () => void; initial?: TaskKind }) {
  const hub = useHub();
  const [kind, setKind] = useState<TaskKind>(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) setKind(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open || !note || !hub) return;
    const key = `${note.id}:${note.updatedAt}:${kind}`;
    const hit = cache.get(key);
    setError(null);
    if (hit) {
      setText(hit);
      setLoading(false);
      return;
    }
    setText('');
    setLoading(true);
    const ac = new AbortController();
    abort.current = ac;
    const input: Record<string, string> =
      kind === 'examples'
        ? { word: plainText(note.fields.german ?? note.fields.front ?? note.fields.text ?? ''), meaning: plainText(note.fields.english ?? note.fields.back ?? '') }
        : { card: cardContext(note) };
    streamTask(kind, input, (t) => setText(t), { signal: ac.signal })
      .then((final) => {
        cache.set(key, final);
        setText(final);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError((e as Error).message);
      })
      .finally(() => !ac.signal.aborted && setLoading(false));
    return () => ac.abort();
  }, [open, note, kind, hub]);

  return (
    <Modal
      open={open}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-5" /> KI-Hilfe
        </span>
      }
      wide
      footer={
        note && (
          <Button
            icon={<MessageCircle className="size-4" />}
            onClick={() => {
              onClose();
              navigate(`/tutor?note=${note.id}`);
            }}
          >
            Mit dem Tutor besprechen
          </Button>
        )
      }
    >
      {!hub ? (
        <p className="text-[15px] text-ink-muted">Verbinde dieses Gerät mit deinem Mac (Einstellungen → Sync), um Claude oder Codex zu nutzen.</p>
      ) : (
        <>
          <Segmented
            value={kind}
            onChange={setKind}
            className="mb-4"
            options={[
              { value: 'explain', label: <span className="flex items-center gap-1.5"><Lightbulb className="size-4" />Erklären</span> },
              { value: 'examples', label: <span className="flex items-center gap-1.5"><ListPlus className="size-4" />Beispiele</span> },
              { value: 'mnemonic', label: <span className="flex items-center gap-1.5"><Brain className="size-4" />Eselsbrücke</span> },
            ]}
          />
          {error ? (
            <div className="rounded-md bg-koralle-soft px-4 py-3 text-[15px] text-koralle-ink">{error}</div>
          ) : text ? (
            <Markdown text={text} className="text-[15px]" />
          ) : (
            <div className="flex items-center gap-3 py-6 text-[15px] text-ink-muted">
              <Spinner /> Thinking…
            </div>
          )}
          {loading && text && <Spinner className="mt-3 size-4" />}
        </>
      )}
    </Modal>
  );
}
