export function AnchorGlyph({ className, strokeWidth = 4.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="32" cy="12.5" r="5.5" />
      <path d="M32 18v35" />
      <path d="M21 27h22" />
      <path d="M12.5 37c1.8 10 10 16 19.5 16s17.7-6 19.5-16" />
      <path d="M8.5 40.5 12.5 35l5 4" />
      <path d="M55.5 40.5 51.5 35l-5 4" />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-[28%] shadow-sm"
      style={{ width: size, height: size, background: 'linear-gradient(145deg,#27324a,#161c2b)' }}
    >
      <AnchorGlyph className="text-[#f0b458]" strokeWidth={5.5} />
    </div>
  );
}
