// Otto, the lilac octopus with the golden anchor: brand mark and tutor.
// Full colour, not recolourable. One Otto per screen, never during review.
export type OttoMood = 'neutral' | 'happy' | 'thinking' | 'sleepy' | 'proud' | 'listening';

const EYE = '#1b1e24';

function Eyes({ mood }: { mood: OttoMood }) {
  if (mood === 'happy' || mood === 'proud')
    return (
      <g stroke={EYE} strokeWidth="4.5" fill="none" strokeLinecap="round">
        <path d="M77 91 Q84 81 91 91" />
        <path d="M109 91 Q116 81 123 91" />
      </g>
    );
  if (mood === 'sleepy')
    return (
      <g stroke={EYE} strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M77 88 Q84 95 91 88" />
        <path d="M109 88 Q116 95 123 88" />
      </g>
    );
  const dx = mood === 'thinking' ? 3 : 0;
  const dy = mood === 'thinking' || mood === 'listening' ? -3 : 0;
  return (
    <g>
      <circle cx={84 + dx} cy={88 + dy} r="7" fill={EYE} />
      <circle cx={116 + dx} cy={88 + dy} r="7" fill={EYE} />
      <circle cx={86 + dx} cy={86 + dy} r="2.2" fill="#fff" />
      <circle cx={118 + dx} cy={86 + dy} r="2.2" fill="#fff" />
    </g>
  );
}

function Mouth({ mood }: { mood: OttoMood }) {
  switch (mood) {
    case 'happy':
    case 'proud':
      return <path d="M88 101 Q100 119 112 101 Q100 107 88 101Z" fill={EYE} />;
    case 'sleepy':
      return <ellipse cx="100" cy="107" rx="3.5" ry="4.5" fill={EYE} />;
    case 'thinking':
      return <path d="M95 108 Q102 105 109 108" stroke={EYE} strokeWidth="3" fill="none" strokeLinecap="round" />;
    case 'listening':
      return <ellipse cx="100" cy="106" rx="5" ry="6" fill={EYE} />;
    default:
      return <path d="M92 104 Q100 112 108 104" stroke={EYE} strokeWidth="3" fill="none" strokeLinecap="round" />;
  }
}

export function Otto({ size = 96, mood = 'neutral', className, title }: { size?: number; mood?: OttoMood; className?: string; title?: string }) {
  return (
    <svg viewBox="30 14 168 172" width={size} height={size} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g stroke="#a895ec" strokeWidth="14" fill="none" strokeLinecap="round">
        <path d="M64 116 Q48 144 60 172" />
        <path d="M86 120 Q76 152 90 180" />
        <path d="M114 120 Q124 152 110 180" />
        <path d="M136 116 Q160 136 164 120" />
      </g>
      <path d="M48 124 Q48 36 100 36 Q152 36 152 124 Z" fill="#b9a7f2" />
      <path d="M60 70 Q70 48 92 44" stroke="#d8ceff" strokeWidth="8" fill="none" strokeLinecap="round" />
      <Eyes mood={mood} />
      <circle cx="70" cy="104" r="7" fill="#f2b3b3" />
      <circle cx="130" cy="104" r="7" fill="#f2b3b3" />
      <Mouth mood={mood} />
      <g stroke="#e0a800" strokeWidth="5" fill="none" strokeLinecap="round">
        <circle cx="176" cy="96" r="5" />
        <path d="M176 102 V132 M166 110 H186 M162 124 Q176 140 190 124" />
      </g>
      {mood === 'proud' && (
        <g>
          <path d="M70 42 Q100 8 130 42 Z" fill="#1b2a4a" />
          <path d="M62 44 Q100 30 138 44 L136 50 Q100 38 64 50 Z" fill="#141414" />
          <circle cx="100" cy="28" r="5" fill="#ffd34d" />
        </g>
      )}
      {mood === 'sleepy' && (
        <path d="M150 30 h11 l-11 13 h11" stroke="#6b4fd8" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {mood === 'thinking' && (
        <g fill="#6b4fd8">
          <circle cx="150" cy="40" r="3.5" />
          <circle cx="160" cy="28" r="5" />
        </g>
      )}
      {mood === 'listening' && (
        <g stroke="#6b4fd8" strokeWidth="3.5" fill="none" strokeLinecap="round">
          <path d="M40 84 Q34 94 40 104" />
          <path d="M160 84 Q166 94 160 104" />
        </g>
      )}
    </svg>
  );
}

/** Otto on his krake-soft backdrop (onboarding, empty states, rewards, tutor avatar). */
export function OttoBadge({ size = 96, mood = 'neutral', className }: { size?: number; mood?: OttoMood; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-krake-soft ${className ?? ''}`} style={{ width: size, height: size }}>
      <Otto size={Math.round(size * 0.78)} mood={mood} />
    </div>
  );
}
