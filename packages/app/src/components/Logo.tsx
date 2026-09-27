import { Otto } from './Otto';

/** The brand mark: Otto. */
export function Logo({ size = 30 }: { size?: number }) {
  return <Otto size={size} title="Anker" />;
}

/** Logo row: Otto + the wordmark in Bricolage 800. */
export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={size} />
      <span className="font-display text-[24px] leading-none font-extrabold tracking-[-0.035em]" style={{ fontVariationSettings: "'opsz' 96" }}>
        Anker
      </span>
    </span>
  );
}
