import { GENDER_ARTICLE, parseGender, parseVerbForms, pluralDisplay, renderCloze, withArticle, type Gender, type Note } from '@anker/core';
import { Volume2 } from 'lucide-react';
import { renderField } from '../lib/sanitize';
import { speak } from '../lib/tts';
import { cx } from './ui';

export const POS_LABEL: Record<string, string> = {
  noun: 'Nomen',
  verb: 'Verb',
  adjective: 'Adjektiv',
  adverb: 'Adverb',
  preposition: 'Präposition',
  conjunction: 'Konjunktion',
  pronoun: 'Pronomen',
  phrase: 'Ausdruck',
  other: '',
};

export const GENDER_VAR: Record<Gender, string> = { der: 'var(--der)', die: 'var(--die)', das: 'var(--das)', pl: 'var(--pl)' };

export function GenderWord({ word, gender, className }: { word: string; gender?: string; className?: string }) {
  const g = parseGender(gender);
  return (
    <span className={className}>
      {g && (
        <span style={{ color: GENDER_VAR[g] }} className="font-semibold">
          {GENDER_ARTICLE[g]}{' '}
        </span>
      )}
      {word}
    </span>
  );
}

export function GenderTag({ gender, className }: { gender?: string; className?: string }) {
  const g = parseGender(gender);
  if (!g) return null;
  return (
    <span
      className={cx('inline-flex items-center rounded-md px-1.5 py-px text-[11px] font-bold tracking-wide', className)}
      style={{ color: GENDER_VAR[g], background: `color-mix(in srgb, ${GENDER_VAR[g]} 14%, transparent)` }}
    >
      {g === 'pl' ? 'pl.' : g}
    </span>
  );
}

export function SpeakButton({ text, className, slow }: { text: string; className?: string; slow?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void speak(text, { rate: slow ? 0.7 : 1 });
      }}
      className={cx('inline-flex size-9 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-accent-strong', className)}
      aria-label={`Listen: ${text}`}
      title="Listen (R)"
    >
      <Volume2 className="size-[18px]" />
    </button>
  );
}

function Html({ html, className }: { html: string; className?: string }) {
  return <div className={cx('card-html', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** German text to speak automatically when this side appears (null = nothing). */
export function autoSpeech(note: Note, ord: number, side: 'question' | 'answer'): string | null {
  const f = note.fields;
  switch (note.type) {
    case 'word': {
      const de = withArticle(f.german ?? '', f.gender);
      if (ord === 0 && side === 'question') return de;
      if (ord === 1 && side === 'answer') return de;
      return null;
    }
    case 'basic':
      return side === 'question' ? f.front ?? null : null;
    case 'reversed':
      return (ord === 0 && side === 'question') || (ord === 1 && side === 'answer') ? f.front ?? null : null;
    case 'typing':
      return side === 'answer' ? f.back ?? null : null;
    case 'cloze':
      return side === 'answer' ? renderCloze(f.text ?? '', ord + 1, 'answer') : null;
  }
}

function WordDetails({ note }: { note: Note }) {
  const f = note.fields;
  const pl = pluralDisplay(f.plural);
  const forms = f.forms?.trim();
  const verb = f.pos === 'verb' ? parseVerbForms(forms) : null;
  return (
    <div className="mx-auto mt-6 w-full max-w-md space-y-4 text-left">
      {(pl || forms) && (
        <div className="flex flex-wrap gap-2">
          {pl && (
            <div className="rounded-xl bg-surface-2 px-3 py-2">
              <div className="text-[10.5px] font-semibold tracking-wider text-faint uppercase">Plural</div>
              <div className="mt-0.5 text-[15px] font-medium">
                {pl.startsWith('die ') ? (
                  <>
                    <span style={{ color: 'var(--pl)' }} className="font-semibold">
                      die
                    </span>{' '}
                    {pl.slice(4)}
                  </>
                ) : (
                  pl
                )}
              </div>
            </div>
          )}
          {verb?.present3 ? (
            <div className="flex flex-wrap gap-2">
              {[
                ['Präsens', verb.present3],
                ['Präteritum', verb.preterite],
                ['Perfekt', verb.perfect],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
                    <div className="text-[10.5px] font-semibold tracking-wider text-faint uppercase">{k}</div>
                    <div className="mt-0.5 text-[15px] font-medium">{v}</div>
                  </div>
                ))}
            </div>
          ) : (
            forms && (
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                <div className="text-[10.5px] font-semibold tracking-wider text-faint uppercase">Forms</div>
                <div className="mt-0.5 text-[15px] font-medium">{forms}</div>
              </div>
            )
          )}
        </div>
      )}
      {f.example && (
        <div className="rounded-2xl border border-line px-4 py-3">
          <div className="flex items-start gap-2">
            <Html html={renderField(f.example)} className="flex-1 font-display text-[17px] leading-snug italic" />
            <SpeakButton text={f.example} className="-mt-1 -mr-2 size-8 shrink-0" />
          </div>
          {f.exampleTranslation && <Html html={renderField(f.exampleTranslation)} className="mt-1 text-[14px] text-muted" />}
        </div>
      )}
      {f.notes && <Html html={renderField(f.notes)} className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-[14px] leading-relaxed" />}
    </div>
  );
}

/** Renders one side of a card. The answer side includes the question on top (like Anki). */
export function CardView({ note, ord, side, hideProductionHint }: { note: Note; ord: number; side: 'question' | 'answer'; hideProductionHint?: boolean }) {
  const f = note.fields;
  const answer = side === 'answer';

  if (note.type === 'word') {
    const g = parseGender(f.gender);
    const pos = POS_LABEL[f.pos ?? ''] ?? '';
    const de = withArticle(f.german ?? '', f.gender);
    const germanBlock = (
      <div className="flex flex-col items-center">
        {pos && <div className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-faint uppercase">{pos}</div>}
        <div className="flex items-center gap-1">
          <h2 className="font-display text-[40px] leading-tight font-semibold tracking-tight md:text-[52px]">
            <GenderWord word={f.german ?? ''} gender={f.gender} />
          </h2>
          <SpeakButton text={de} className="ml-1" />
        </div>
      </div>
    );
    const meaningBlock = (big: boolean) => (
      <Html html={renderField(f.english)} className={cx(big ? 'font-display text-[30px] leading-tight font-medium md:text-[36px]' : 'text-[19px] text-muted')} />
    );
    if (ord === 0) {
      return (
        <div className="flex w-full flex-col items-center text-center">
          {germanBlock}
          {answer && (
            <>
              <div className="my-5 h-px w-16 bg-line" />
              {meaningBlock(true)}
              <WordDetails note={note} />
            </>
          )}
        </div>
      );
    }
    return (
      <div className="flex w-full flex-col items-center text-center">
        {!answer && (
          <>
            {pos && <div className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-faint uppercase">{pos}</div>}
            {meaningBlock(true)}
            {!hideProductionHint && (
              <div className="mt-3 text-[13px] text-faint">{f.pos === 'noun' || g ? 'Say it in German — with the article' : 'Say it in German'}</div>
            )}
          </>
        )}
        {answer && (
          <>
            {meaningBlock(false)}
            <div className="my-4 h-px w-16 bg-line" />
            {germanBlock}
            <WordDetails note={note} />
          </>
        )}
      </div>
    );
  }

  if (note.type === 'cloze') {
    const html = renderField(renderCloze(f.text ?? '', ord + 1, side));
    return (
      <div className="flex w-full flex-col items-center text-center">
        <div className="flex items-start gap-1">
          <Html html={html} className="font-display text-[26px] leading-snug md:text-[30px]" />
          {answer && <SpeakButton text={renderCloze(f.text ?? '', ord + 1, 'answer')} className="mt-1 shrink-0" />}
        </div>
        {answer && f.extra && <Html html={renderField(f.extra)} className="mt-5 max-w-lg text-[15px] text-muted" />}
      </div>
    );
  }

  const front = note.type === 'reversed' && ord === 1 ? f.back : f.front;
  const back = note.type === 'reversed' && ord === 1 ? f.front : f.back;
  const frontIsGerman = !(note.type === 'reversed' && ord === 1) && note.type !== 'typing';
  return (
    <div className="flex w-full flex-col items-center text-center">
      <div className="flex items-start gap-1">
        <Html html={renderField(front)} className="font-display text-[28px] leading-snug md:text-[34px]" />
        {frontIsGerman && front && <SpeakButton text={front} className="mt-1 shrink-0" />}
      </div>
      {answer && (
        <>
          <div className="my-5 h-px w-16 bg-line" />
          <div className="flex items-start gap-1">
            <Html html={renderField(back)} className="text-[22px] leading-snug md:text-[24px]" />
            {!frontIsGerman && back && <SpeakButton text={back} className="shrink-0" />}
          </div>
          {note.type === 'typing' && f.extra && <Html html={renderField(f.extra)} className="mt-4 max-w-lg text-[15px] text-muted" />}
        </>
      )}
    </div>
  );
}

/** Colored accent for the card frame (gender of nouns, once it's no secret). */
export function cardAccent(note: Note, ord: number, side: 'question' | 'answer'): string | null {
  if (note.type !== 'word') return null;
  const g = parseGender(note.fields.gender);
  if (!g) return null;
  if (ord === 1 && side === 'question') return null;
  return GENDER_VAR[g];
}
