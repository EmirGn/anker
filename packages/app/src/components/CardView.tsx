import { GENDER_ARTICLE, parseGender, parseVerbForms, pluralDisplay, renderCloze, withArticle, type Gender, type Note } from '@anker/core';
import { renderField } from '../lib/sanitize';
import { speak } from '../lib/tts';
import { Volume2 } from './icons';
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

// Grammatical gender is a colour system: only ever on vocabulary. Plural is ink-muted, never "die" red.
export const GENDER_VAR: Record<Gender, string> = { der: 'var(--der)', die: 'var(--die)', das: 'var(--das)', pl: 'var(--ink-muted)' };
export const GENDER_SOFT: Record<Gender, string> = { der: 'var(--der-soft)', die: 'var(--die-soft)', das: 'var(--das-soft)', pl: 'var(--paper-raised)' };
const GENDER_NAME: Record<Gender, string> = { der: 'maskulin', die: 'feminin', das: 'neutrum', pl: 'Plural' };

/** Inline noun: the article alone takes the gender colour in weight 700, the noun stays ink. */
export function GenderWord({ word, gender, className }: { word: string; gender?: string; className?: string }) {
  const g = parseGender(gender);
  return (
    <span className={className} lang="de">
      {g && (
        <span style={{ color: GENDER_VAR[g] }} className="font-bold">
          {GENDER_ARTICLE[g]}{' '}
        </span>
      )}
      {word}
    </span>
  );
}

/** The gender chip: a pill in der/die/das with on-gender text ("das · neutrum"). */
export function GenderTag({ gender, long, className }: { gender?: string; long?: boolean; className?: string }) {
  const g = parseGender(gender);
  if (!g) return null;
  return (
    <span
      className={cx('inline-flex shrink-0 items-center rounded-full font-bold', long ? 'h-[26px] px-2.5 text-[13px]' : 'h-5 px-2 text-[11px]', className)}
      style={g === 'pl' ? { background: 'var(--paper-sunk)', color: 'var(--ink-muted)' } : { background: GENDER_VAR[g], color: 'var(--on-gender)' }}
    >
      {GENDER_ARTICLE[g]}
      {long && ` · ${GENDER_NAME[g]}`}
    </span>
  );
}

export function SpeakButton({ text, className, slow, tint }: { text: string; className?: string; slow?: boolean; tint?: Gender | null }) {
  const g = tint && tint !== 'pl' ? tint : null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void speak(text, { rate: slow ? 0.7 : 1 });
      }}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-[120ms]',
        g ? 'hover:brightness-95' : 'bg-paper-sunk text-ink hover:text-hafen',
        className,
      )}
      style={g ? { background: GENDER_SOFT[g], color: GENDER_VAR[g] } : undefined}
      aria-label={`Anhören: ${text}`}
      title="Anhören (R)"
    >
      <Volume2 className="size-5" />
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
  const g = parseGender(f.gender);
  const pl = pluralDisplay(f.plural);
  const forms = f.forms?.trim();
  const verb = f.pos === 'verb' ? parseVerbForms(forms) : null;
  const stamm = verb?.present3 ? [verb.present3, verb.preterite, verb.perfect].filter(Boolean).join(' · ') : null;
  return (
    <>
      {pl && <div className="t-caption mt-0.5 text-ink-muted">Plural: {pl}</div>}
      {stamm ? (
        <div className="t-caption mt-0.5 text-ink-muted" lang="de">
          Stammformen: <span className="font-bold text-ink">{stamm}</span>
        </div>
      ) : (
        forms && (
          <div className="t-caption mt-0.5 text-ink-muted" lang="de">
            Formen: <span className="font-bold text-ink">{forms}</span>
          </div>
        )
      )}
      {f.example && (
        <div className="mt-6 flex items-center gap-3 rounded-md bg-paper-raised px-4 py-3">
          <SpeakButton text={f.example} tint={g} className="size-10" />
          <div className="min-w-0 flex-1">
            <Html html={renderField(f.example)} className="t-body-lg" />
            {f.exampleTranslation && <Html html={renderField(f.exampleTranslation)} className="t-caption text-ink-muted" />}
          </div>
        </div>
      )}
      {f.notes && <Html html={renderField(f.notes)} className="t-caption mt-4 text-ink-muted" />}
    </>
  );
}

/** Renders one side of a card. The answer side includes the question (like Anki). */
export function CardView({ note, ord, side, hideProductionHint }: { note: Note; ord: number; side: 'question' | 'answer'; hideProductionHint?: boolean }) {
  const f = note.fields;
  const answer = side === 'answer';

  if (note.type === 'word') {
    const g = parseGender(f.gender);
    const pos = POS_LABEL[f.pos ?? ''] ?? '';
    const de = withArticle(f.german ?? '', f.gender);
    if (ord === 1 && !answer) {
      // English → German: the prompt carries no gender colour.
      return (
        <div className="w-full text-left">
          {pos && <div className="t-overline text-ink-muted">{pos}</div>}
          <Html html={renderField(f.english)} className="t-title mt-3" />
          {!hideProductionHint && (
            <div className="t-caption mt-3 text-ink-muted">{f.pos === 'noun' || g ? 'Sag es auf Deutsch – mit Artikel.' : 'Sag es auf Deutsch.'}</div>
          )}
        </div>
      );
    }
    return (
      <div className="w-full text-left">
        {g ? <GenderTag gender={f.gender} long /> : pos && <div className="t-overline text-ink-muted">{pos}</div>}
        <div className="mt-3 flex items-start justify-between gap-3">
          <h2 className="t-word min-w-0 break-words" lang="de">
            {f.german}
          </h2>
          <SpeakButton text={de} tint={g} />
        </div>
        {answer && (
          <>
            <Html html={renderField(f.english)} className="t-body-lg mt-2" />
            <WordDetails note={note} />
          </>
        )}
      </div>
    );
  }

  if (note.type === 'cloze') {
    const html = renderField(renderCloze(f.text ?? '', ord + 1, side));
    return (
      <div className="w-full text-left">
        <div className="flex items-start gap-3">
          <Html html={html} className="min-w-0 flex-1 text-[22px] leading-8 font-medium" />
          {answer && <SpeakButton text={renderCloze(f.text ?? '', ord + 1, 'answer')} />}
        </div>
        {answer && f.extra && <Html html={renderField(f.extra)} className="t-body mt-5 text-ink-muted" />}
      </div>
    );
  }

  const front = note.type === 'reversed' && ord === 1 ? f.back : f.front;
  const back = note.type === 'reversed' && ord === 1 ? f.front : f.back;
  const frontIsGerman = !(note.type === 'reversed' && ord === 1) && note.type !== 'typing';
  return (
    <div className="w-full text-left">
      <div className="flex items-start gap-3">
        <Html html={renderField(front)} className="t-title min-w-0 flex-1" />
        {frontIsGerman && front && <SpeakButton text={front} />}
      </div>
      {answer && (
        <>
          <div className="my-5 h-px bg-line" />
          <div className="flex items-start gap-3">
            <Html html={renderField(back)} className="min-w-0 flex-1 text-[20px] leading-7 font-medium" />
            {!frontIsGerman && back && <SpeakButton text={back} />}
          </div>
          {note.type === 'typing' && f.extra && <Html html={renderField(f.extra)} className="t-body mt-4 text-ink-muted" />}
        </>
      )}
    </div>
  );
}

/** Background tint of the card: the noun's gender, once it's no secret. */
export function cardTint(note: Note, ord: number, side: 'question' | 'answer'): string | null {
  if (note.type !== 'word') return null;
  const g = parseGender(note.fields.gender);
  if (!g || g === 'pl') return null;
  if (ord === 1 && side === 'question') return null;
  return GENDER_SOFT[g];
}
