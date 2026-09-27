import {
  ADJ_MIXED,
  ADJ_STRONG,
  ADJ_WEAK,
  CASE_NAME,
  CASE_QUESTION,
  CASES,
  CONTRACTIONS,
  DEFINITE,
  formalTime,
  GENDER_RULES,
  genderHints,
  INDEFINITE,
  informalTime,
  NEGATIVE,
  numberToGerman,
  PERSONAL_PRONOUNS,
  PREPOSITIONS,
  yearToGerman,
  type Case,
  type Gender,
  type PrepCase,
} from '@anker/core';
import { ArrowLeft, ArrowRight, BookOpen, Sparkles, Volume2, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { GENDER_VAR } from '../components/CardView';
import { Button, cx, Input, PageHeader, Panel, Section } from '../components/ui';
import { useHub } from '../lib/hooks';
import { Link, navigate } from '../lib/router';
import { speak } from '../lib/tts';

const G: Gender[] = ['der', 'die', 'das', 'pl'];
const G_HEAD: Record<Gender, string> = { der: 'Maskulin', die: 'Feminin', das: 'Neutrum', pl: 'Plural' };

function Table({ head, rows, genderCols }: { head: ReactNode[]; rows: ReactNode[][]; genderCols?: boolean }) {
  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-0 text-[14.5px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="border-b border-line px-3 py-2 text-left text-[12px] font-semibold tracking-wide text-faint uppercase"
                style={genderCols && i > 0 ? { color: GENDER_VAR[G[i - 1]!] } : undefined}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="even:bg-surface-2/40">
              {r.map((c, j) => (
                <td key={j} className={cx('border-b border-line px-3 py-2.5', j === 0 ? 'font-medium text-muted' : 'font-display text-[16.5px]')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">{children}</div>;
}

function Ex({ de, en }: { de: string; en?: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <button onClick={() => void speak(de)} className="mt-0.5 text-faint hover:text-accent-strong" aria-label="Listen">
        <Volume2 className="size-4" />
      </button>
      <div>
        <div className="font-display text-[16px] italic">{de}</div>
        {en && <div className="text-[13px] text-muted">{en}</div>}
      </div>
    </div>
  );
}

const caseRows = (table: Record<Case, Record<Gender, string>>) => CASES.map((c) => [`${CASE_NAME[c]} · ${CASE_QUESTION[c]}`, ...G.map((g) => table[c][g])]);

function Faelle() {
  return (
    <div className="space-y-6">
      <p className="text-[15px] leading-relaxed text-muted">
        German marks a noun's role with its article. <b>Nominativ</b> = subject, <b>Akkusativ</b> = direct object, <b>Dativ</b> = indirect object (and after many prepositions), <b>Genitiv</b> = possession.
      </p>
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Bestimmter Artikel (the)</div>
        <Table head={['', ...G.map((g) => G_HEAD[g])]} rows={caseRows(DEFINITE)} genderCols />
      </Panel>
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Unbestimmter Artikel (a / an)</div>
        <Table head={['', ...G.map((g) => G_HEAD[g])]} rows={caseRows(INDEFINITE)} genderCols />
      </Panel>
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Negativartikel (kein) — possessives (mein, dein, …) work the same way</div>
        <Table head={['', ...G.map((g) => G_HEAD[g])]} rows={caseRows(NEGATIVE)} genderCols />
      </Panel>
      <Note>
        Only the <b>masculine</b> changes in the Akkusativ: <i>der → den, ein → einen</i>. In the Dativ plural the noun itself usually gets an <b>-n</b>: <i>mit den Kindern</i>. Masculine and neuter nouns take <b>-(e)s</b> in the Genitiv: <i>des Mannes, des Autos</i>.
      </Note>
      <Panel className="p-4">
        <Ex de="Der Mann gibt dem Kind einen Apfel." en="The man (Nom) gives the child (Dat) an apple (Akk)." />
        <Ex de="Das ist das Auto des Lehrers." en="That is the teacher's car (Gen)." />
      </Panel>
    </div>
  );
}

function Praepositionen() {
  const groups: { key: PrepCase; title: string; hint: string }[] = [
    { key: 'akk', title: 'Immer Akkusativ', hint: 'durch · für · gegen · ohne · um (“DOGFU”)' },
    { key: 'dat', title: 'Immer Dativ', hint: 'aus · bei · mit · nach · seit · von · zu (+ gegenüber, außer)' },
    { key: 'wechsel', title: 'Wechselpräpositionen', hint: 'Wo? → Dativ (location) · Wohin? → Akkusativ (direction)' },
    { key: 'gen', title: 'Genitiv', hint: 'wegen · trotz · während · (an)statt — in speech often Dativ' },
  ];
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <Panel key={g.key} className="p-4">
          <div className="font-semibold">{g.title}</div>
          <div className="mb-3 text-[13px] text-muted">{g.hint}</div>
          <div className="divide-y divide-line">
            {PREPOSITIONS.filter((p) => p.case === g.key).map((p) => (
              <div key={p.word} className="grid grid-cols-[110px_1fr] gap-3 py-2">
                <div>
                  <div className="font-display text-[17px] font-semibold">{p.word}</div>
                  <div className="text-[12px] text-faint">{p.meaning}</div>
                </div>
                <Ex de={p.example} />
              </div>
            ))}
          </div>
        </Panel>
      ))}
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Contractions</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CONTRACTIONS).map(([k, v]) => (
            <span key={k} className="rounded-xl bg-surface-2 px-3 py-1.5 text-[14px]">
              {k} → <b>{v}</b>
            </span>
          ))}
        </div>
      </Panel>
      <Note>
        <b>Wo oder wohin?</b> <i>Ich bin in der Küche</i> (Wo? → Dativ) vs. <i>Ich gehe in die Küche</i> (Wohin? → Akkusativ). Verb pairs help: liegen/legen, stehen/stellen, sitzen/setzen, hängen/hängen.
      </Note>
    </div>
  );
}

function Genus() {
  const [word, setWord] = useState('');
  const hits = word.trim() ? genderHints(word.trim()) : [];
  return (
    <div className="space-y-6">
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Try it: type a noun</div>
        <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="z. B. Freundschaft, Häuschen, Motor…" className="font-display text-[18px]" />
        <div className="mt-3 min-h-8">
          {word.trim() &&
            (hits.length ? (
              <div className="space-y-1.5">
                {hits.slice(0, 3).map((h, i) => (
                  <div key={h.rule.id} className={cx('text-[14px]', i > 0 && 'text-muted')}>
                    <b style={{ color: GENDER_VAR[h.gender] }}>{h.gender}</b> {word.trim()} — nouns in {h.rule.label} are {h.rule.reliability === 'always' ? 'always' : h.rule.reliability === 'mostly' ? 'almost always' : 'often'} {h.gender}
                    {h.rule.exceptions?.length ? <span className="text-faint"> (exceptions: {h.rule.exceptions.join(', ')})</span> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[14px] text-muted">No rule matches — this one you simply have to learn (with its article!).</div>
            ))}
        </div>
      </Panel>
      {(['die', 'der', 'das'] as const).map((g) => (
        <Panel key={g} className="p-4">
          <div className="mb-3 font-display text-[20px] font-semibold" style={{ color: GENDER_VAR[g] }}>
            {g} — {G_HEAD[g].toLowerCase()}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {GENDER_RULES.filter((r) => r.gender === g).map((r) => (
              <div key={r.id} className="rounded-xl bg-surface-2/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.label}</span>
                  <span className="text-[11px] font-medium text-faint">{r.reliability}</span>
                </div>
                <div className="text-[13px] text-muted">{r.examples.join(', ')}</div>
                {r.exceptions && <div className="text-[12px] text-faint">but: {r.exceptions.join(', ')}</div>}
              </div>
            ))}
          </div>
        </Panel>
      ))}
      <Note>
        Always learn nouns <b>with their article</b> — Anker colours them: <b style={{ color: 'var(--der)' }}>der</b> blue, <b style={{ color: 'var(--die)' }}>die</b> red, <b style={{ color: 'var(--das)' }}>das</b> green. Compound nouns take the gender of the <b>last</b> part: <i>das Haus + die Tür → die Haustür</i>.
      </Note>
    </div>
  );
}

function Adjektive() {
  const t = (table: Record<Case, Record<Gender, string>>) => CASES.map((c) => [CASE_NAME[c], ...G.map((g) => table[c][g])]);
  return (
    <div className="space-y-6">
      <Panel className="p-4">
        <div className="mb-1 font-semibold">After der / die / das (weak)</div>
        <div className="mb-2 text-[13px] text-muted">der alte Mann · die alte Frau · mit dem alten Auto</div>
        <Table head={['', ...G.map((g) => G_HEAD[g])]} rows={t(ADJ_WEAK)} genderCols />
      </Panel>
      <Panel className="p-4">
        <div className="mb-1 font-semibold">After ein / kein / mein (mixed)</div>
        <div className="mb-2 text-[13px] text-muted">ein alter Mann · ein altes Haus · meine alten Freunde</div>
        <Table head={['', ...G.map((g) => G_HEAD[g])]} rows={t(ADJ_MIXED)} genderCols />
      </Panel>
      <Panel className="p-4">
        <div className="mb-1 font-semibold">No article (strong)</div>
        <div className="mb-2 text-[13px] text-muted">kalter Kaffee · frisches Brot · mit heißem Wasser</div>
        <Table head={['', ...G.map((g) => G_HEAD[g])]} rows={t(ADJ_STRONG)} genderCols />
      </Panel>
      <Note>
        Rule of thumb: the gender/case signal must appear <b>once</b>. If the article already shows it (der, dem, des…), the adjective takes a lazy <b>-e/-en</b>. If there's no article (or <i>ein</i> without an ending), the adjective carries the signal itself: <i>ein gut<b>er</b> Wein, gut<b>es</b> Bier</i>.
      </Note>
    </div>
  );
}

function Pronomen() {
  const poss = [
    ['ich', 'mein', 'meine'],
    ['du', 'dein', 'deine'],
    ['er / es', 'sein', 'seine'],
    ['sie', 'ihr', 'ihre'],
    ['wir', 'unser', 'unsere'],
    ['ihr', 'euer', 'eure'],
    ['sie / Sie', 'ihr / Ihr', 'ihre / Ihre'],
  ];
  return (
    <div className="space-y-6">
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Personalpronomen</div>
        <Table head={['', 'Nominativ', 'Akkusativ', 'Dativ']} rows={PERSONAL_PRONOUNS.map((p) => [p.person, p.nom, p.akk, p.dat])} />
      </Panel>
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Possessivartikel (Nominativ)</div>
        <Table head={['', 'der / das', 'die / Plural']} rows={poss} />
        <p className="mt-3 text-[13px] text-muted">They decline like <i>kein</i>: meinen Bruder (Akk), mit meiner Schwester (Dat), unseren Freunden (Dat pl).</p>
      </Panel>
      <Panel className="p-4">
        <Ex de="Ich gebe es dir morgen." en="I'll give it to you tomorrow. (Akk pronoun before Dat pronoun)" />
        <Ex de="Kannst du mir helfen?" en="Can you help me? — helfen takes the Dativ!" />
      </Panel>
    </div>
  );
}

function Zahlen() {
  const [n, setN] = useState('1984');
  const [t, setT] = useState('07:30');
  const num = Number(n);
  const valid = Number.isInteger(num) && num >= 0 && num < 1e12;
  const [hh, mm] = t.split(':').map(Number) as [number, number];
  const tValid = Number.isFinite(hh) && Number.isFinite(mm);
  const round5 = tValid ? Math.round(mm / 5) * 5 : 0;
  return (
    <div className="space-y-6">
      <Panel className="space-y-3 p-4">
        <div className="font-semibold">Number → Deutsch</div>
        <Input value={n} onChange={(e) => setN(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="font-mono text-[18px]" />
        {valid && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-display text-[20px]">
              {numberToGerman(num)}
              <button onClick={() => void speak(String(num))} className="text-faint hover:text-accent-strong" aria-label="Listen">
                <Volume2 className="size-4" />
              </button>
            </div>
            {num >= 1100 && num < 2000 && <div className="text-[14px] text-muted">as a year: {yearToGerman(num)}</div>}
          </div>
        )}
      </Panel>
      <Note>
        German says the ones before the tens: <b>21 = einundzwanzig</b> (“one-and-twenty”). Numbers below a million are written as one word. Watch out: <i>sechzehn, sechzig</i> (no s), <i>siebzehn, siebzig</i> (no en), <i>dreißig</i> (ß).
      </Note>
      <Panel className="space-y-3 p-4">
        <div className="font-semibold">Wie spät ist es?</div>
        <Input type="time" value={t} onChange={(e) => setT(e.target.value)} className="w-40" />
        {tValid && (
          <div className="space-y-1 text-[15px]">
            <div>
              <span className="text-muted">Official: </span>
              <b>{formalTime(hh, mm)}</b>
            </div>
            <div>
              <span className="text-muted">Everyday: </span>
              <b>{round5 < 60 ? informalTime(hh, round5) : informalTime((hh + 1) % 24, 0)}</b>
              {round5 !== mm && <span className="text-faint"> (≈ {String(hh).padStart(2, '0')}:{String(round5 % 60).padStart(2, '0')})</span>}
            </div>
          </div>
        )}
      </Panel>
      <Note>
        <b>halb acht</b> means 7:30 — “half (way) to eight”! And <i>Viertel nach/vor</i> = quarter past/to. In the south you'll also hear <i>viertel acht</i> (7:15) and <i>dreiviertel acht</i> (7:45).
      </Note>
    </div>
  );
}

function Satzbau() {
  const modal = [
    ['ich', 'kann', 'muss', 'will', 'soll', 'darf', 'möchte'],
    ['du', 'kannst', 'musst', 'willst', 'sollst', 'darfst', 'möchtest'],
    ['er/sie/es', 'kann', 'muss', 'will', 'soll', 'darf', 'möchte'],
    ['wir', 'können', 'müssen', 'wollen', 'sollen', 'dürfen', 'möchten'],
    ['ihr', 'könnt', 'müsst', 'wollt', 'sollt', 'dürft', 'möchtet'],
    ['sie/Sie', 'können', 'müssen', 'wollen', 'sollen', 'dürfen', 'möchten'],
  ];
  const aux = [
    ['ich', 'bin', 'habe', 'werde'],
    ['du', 'bist', 'hast', 'wirst'],
    ['er/sie/es', 'ist', 'hat', 'wird'],
    ['wir', 'sind', 'haben', 'werden'],
    ['ihr', 'seid', 'habt', 'werdet'],
    ['sie/Sie', 'sind', 'haben', 'werden'],
  ];
  return (
    <div className="space-y-6">
      <Panel className="space-y-2 p-4">
        <div className="font-semibold">1 · The verb is always in position 2</div>
        <Ex de="Ich lerne heute Deutsch." />
        <Ex de="Heute lerne ich Deutsch." en="Something else first? The subject moves behind the verb." />
        <Ex de="Was lernst du heute?" en="W-questions: question word + verb." />
        <Ex de="Lernst du heute Deutsch?" en="Yes/no questions: the verb comes first." />
      </Panel>
      <Panel className="space-y-2 p-4">
        <div className="font-semibold">2 · The sentence bracket (Satzklammer)</div>
        <Ex de="Ich muss heute Deutsch lernen." en="Modal verb in position 2, infinitive at the end." />
        <Ex de="Ich habe gestern Deutsch gelernt." en="Perfekt: haben/sein in position 2, participle at the end." />
        <Ex de="Ich stehe jeden Tag um sieben Uhr auf." en="Separable verbs (aufstehen): the prefix goes to the end." />
      </Panel>
      <Panel className="space-y-2 p-4">
        <div className="font-semibold">3 · Subordinate clauses: verb at the very end</div>
        <Ex de="Ich lerne Deutsch, weil ich in Berlin arbeiten möchte." />
        <Ex de="Weil ich müde bin, gehe ich früh ins Bett." en="Subordinate clause first → the main clause starts with the verb." />
        <p className="text-[13px] text-muted">weil · dass · wenn · ob · als · obwohl · damit · bevor · nachdem · während · bis · seit(dem)</p>
        <p className="text-[13px] text-muted">
          But <b>und, aber, oder, denn, sondern</b> (“ADUSO”) don't change word order: <i>Ich bin müde, denn ich habe schlecht geschlafen.</i>
        </p>
      </Panel>
      <Panel className="space-y-2 p-4">
        <div className="font-semibold">4 · TeKaMoLo — the order of details</div>
        <Ex de="Ich fahre morgen wegen des Streiks mit dem Fahrrad zur Arbeit." en="Temporal (wann?) · Kausal (warum?) · Modal (wie?) · Lokal (wo/wohin?)" />
      </Panel>
      <Panel className="p-4">
        <div className="mb-2 font-semibold">sein · haben · werden</div>
        <Table head={['', 'sein', 'haben', 'werden']} rows={aux} />
      </Panel>
      <Panel className="p-4">
        <div className="mb-2 font-semibold">Modalverben</div>
        <Table head={['', 'können', 'müssen', 'wollen', 'sollen', 'dürfen', 'möchten']} rows={modal} />
      </Panel>
      <Note>
        <b>Perfekt with sein</b>: verbs of movement from A to B or a change of state — <i>gehen, fahren, kommen, fliegen, laufen, reisen, aufstehen, einschlafen, werden, sterben, passieren</i> — plus <i>sein</i> and <i>bleiben</i>. Everything else uses <b>haben</b>.
      </Note>
    </div>
  );
}

export const TOPICS: { id: string; title: string; desc: string; body: () => ReactNode; drill?: string; ask: string }[] = [
  { id: 'faelle', title: 'Artikel & Fälle', desc: 'der/den/dem/des — all four cases', body: Faelle, drill: 'kasus', ask: 'Explain the four German cases with simple examples and a trick to remember when to use each.' },
  { id: 'praepositionen', title: 'Präpositionen', desc: 'Which case after which preposition', body: Praepositionen, drill: 'kasus', ask: 'Explain Wechselpräpositionen (Wo? vs. Wohin?) with 6 contrasting example pairs.' },
  { id: 'genus', title: 'Genus-Regeln', desc: 'Guess der/die/das from the ending', body: Genus, drill: 'artikel', ask: 'Teach me the most reliable rules for guessing the gender of German nouns, with memorable examples.' },
  { id: 'adjektive', title: 'Adjektivendungen', desc: 'guter Wein, das gute Brot…', body: Adjektive, ask: 'Explain German adjective endings with a simple system I can apply while speaking.' },
  { id: 'pronomen', title: 'Pronomen', desc: 'ich/mich/mir, mein/meine…', body: Pronomen, ask: 'Quiz me on personal pronouns in Akkusativ and Dativ with 8 short sentences.' },
  { id: 'zahlen', title: 'Zahlen & Uhrzeit', desc: 'einundzwanzig, halb acht', body: Zahlen, drill: 'zahlen', ask: 'Give me 10 tricky German numbers and times to read aloud, with the answers hidden at the end.' },
  { id: 'satzbau', title: 'Satzbau & Verben', desc: 'Verb position, Perfekt, Modalverben', body: Satzbau, drill: 'verben', ask: 'Explain German word order (V2, verb-final in subordinate clauses, separable verbs) with examples.' },
];

export function Grammar({ topic }: { topic: string | null }) {
  const hub = useHub();
  const t = TOPICS.find((x) => x.id === topic);
  if (!t) {
    return (
      <div className="mx-auto max-w-4xl px-4 pt-6 pb-12 md:px-8 md:pt-10">
        <PageHeader title="Grammatik" subtitle="Compact tables and rules — with live examples you can listen to." />
        <div className="grid gap-3 sm:grid-cols-2">
          {TOPICS.map((x) => (
            <Link key={x.id} to={`/grammar/${x.id}`} className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:shadow-card">
              <BookOpen className="size-6 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[19px] font-semibold">{x.title}</div>
                <div className="text-[13.5px] text-muted">{x.desc}</div>
              </div>
              <ArrowRight className="size-5 text-faint transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>
    );
  }
  const Body = t.body;
  return (
    <div className="mx-auto max-w-4xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <Link to="/grammar" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Grammatik
      </Link>
      <PageHeader
        title={t.title}
        subtitle={t.desc}
        actions={
          <>
            {t.drill && (
              <Button onClick={() => navigate(`/practice/${t.drill}`)} icon={<Zap className="size-4" />}>
                Practice
              </Button>
            )}
            {hub && (
              <Button variant="primary" onClick={() => navigate(`/tutor?q=${encodeURIComponent(t.ask)}`)} icon={<Sparkles className="size-4" />}>
                Ask the tutor
              </Button>
            )}
          </>
        }
      />
      <Section title="">
        <Body />
      </Section>
    </div>
  );
}
