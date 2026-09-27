import type { Deck } from '@anker/core';
import {
  AirplaneIcon,
  BarbellIcon,
  BookOpenTextIcon,
  BriefcaseIcon,
  CardsIcon,
  ChatsCircleIcon,
  ClockIcon,
  CoffeeIcon,
  ForkKnifeIcon,
  HashIcon,
  HouseIcon,
  PuzzlePieceIcon,
  StethoscopeIcon,
  TrainIcon,
  TreeIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react';
import { cx } from './ui';

// Cover palette as solid fills with their text colour (ink stays dark on the
// light fills in both themes).
const COVERS = [
  { bg: 'var(--koralle)', fg: '#141414' },
  { bg: 'var(--tanne)', fg: 'var(--tanne-on)' },
  { bg: 'var(--sonne)', fg: 'var(--on-sonne)' },
  { bg: 'var(--hafen)', fg: 'var(--on-hafen)' },
  { bg: 'var(--krake)', fg: '#141414' },
] as const;

const TOPICS: [RegExp, Icon, number][] = [
  [/verb/i, BarbellIcon, 1],
  [/gramm|fäll|fall|kasus|artikel|präposition/i, PuzzlePieceIcon, 3],
  [/rede|phrase|sätze|satz|gespräch|idiom|ausdr/i, ChatsCircleIcon, 4],
  [/grundwort|wortschatz|vokab|wörter|wort|a1|a2|b1|b2/i, BookOpenTextIcon, 0],
  [/café|kaffee|getränk/i, CoffeeIcon, 0],
  [/essen|küche|restaurant|lebensmittel/i, ForkKnifeIcon, 0],
  [/arzt|gesund|körper|krank/i, StethoscopeIcon, 1],
  [/wohn|haus|zuhause|möbel/i, HouseIcon, 2],
  [/reise|urlaub|flug/i, AirplaneIcon, 3],
  [/bahn|zug|verkehr/i, TrainIcon, 3],
  [/arbeit|büro|beruf|job/i, BriefcaseIcon, 1],
  [/familie|leute|freunde/i, UsersThreeIcon, 4],
  [/natur|wetter|tier/i, TreeIcon, 1],
  [/zahl|nummer/i, HashIcon, 2],
  [/zeit|uhr|datum/i, ClockIcon, 2],
];

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function coverFor(deck: Pick<Deck, 'id' | 'name'>) {
  const topic = TOPICS.find(([re]) => re.test(deck.name));
  const pal = COVERS[topic ? topic[2] : hash(deck.id) % COVERS.length]!;
  return { ...pal, icon: topic ? topic[1] : CardsIcon };
}

/** A deck as a book cover: solid fill, the title in `cover`, one illustration. */
export function DeckCover({ deck, size = 'md', className }: { deck: Pick<Deck, 'id' | 'name'>; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const c = coverFor(deck);
  const I = c.icon;
  if (size === 'xs')
    return (
      <div className={cx('flex h-12 w-9 shrink-0 items-end rounded-xs p-1.5', className)} style={{ background: c.bg, color: c.fg }} aria-hidden>
        <I className="size-5" />
      </div>
    );
  const dims = size === 'sm' ? 'w-[72px] h-[100px] p-2' : size === 'lg' ? 'w-[132px] h-[184px] p-3' : 'w-[104px] h-[144px] p-2.5';
  return (
    <div
      lang="de"
      className={cx('flex shrink-0 flex-col justify-between overflow-hidden rounded-sm', dims, className)}
      style={{ background: c.bg, color: c.fg }}
      aria-hidden
    >
      <p className={cx('line-clamp-3 break-words hyphens-auto', size === 'sm' ? 'font-display text-[15px] leading-[15px] font-extrabold tracking-[-0.02em]' : 't-cover')}>{deck.name}</p>
      <I className={size === 'sm' ? 'size-5' : size === 'lg' ? 'size-9' : 'size-7'} />
    </div>
  );
}
