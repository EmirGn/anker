import { CheckIcon, WarningIcon } from '@phosphor-icons/react';
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from './icons';
import { Otto, type OttoMood } from './Otto';
import { tr } from '../lib/i18n';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ Button
// One `primary` (hafen) per screen; everything else is secondary on paper-sunk.
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-hafen text-on-hafen hover:brightness-110 active:brightness-95',
  secondary: 'bg-paper-sunk text-ink hover:bg-line',
  ghost: 'text-ink-muted hover:text-ink hover:bg-paper-sunk',
  danger: 'bg-koralle-soft text-koralle-ink hover:brightness-[0.97]',
  outline: 'border border-line bg-paper-raised text-ink hover:bg-paper-sunk',
};
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px] gap-1.5',
  md: 'h-11 px-4 text-[15px] gap-2',
  lg: 'h-[52px] px-6 text-[15px] gap-2',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-md leading-5 font-semibold whitespace-nowrap transition-[background,filter,color,transform] duration-[120ms] ease-out active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink disabled:opacity-40',
        active && 'bg-paper-sunk text-hafen',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Inputs
// Input wells sit on paper-sunk; focus is the calm .field-focus style from styles.css.
const field =
  'rounded-md border border-transparent bg-paper-sunk px-3.5 text-[15px] text-ink placeholder:text-ink-muted outline-none transition-[border,background,box-shadow] duration-[120ms] field-focus';

/** Full width unless the caller sets an explicit width (Tailwind can't reliably override w-full). */
const width = (className?: string) => (className && /(^|\s)(w-|min-w-|max-w-|flex-1)/.test(className) ? '' : 'w-full');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(field, width(className), 'h-11', className)} {...rest} />;
});

/** Multi-line input that grows with its content (never resized by hand), up to 60% of the screen. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 2, onInput, ...rest },
  ref,
) {
  const el = useRef<HTMLTextAreaElement | null>(null);
  const fit = useCallback(() => {
    const t = el.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  }, []);
  useLayoutEffect(fit, [fit, rest.value]);
  return (
    <textarea
      {...rest}
      rows={rows}
      ref={(node) => {
        el.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
      className={cx(field, width(className), 'block max-h-[60vh] resize-none overflow-y-auto py-2.5 leading-[22px]', className)}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(field, width(className), 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: CHEVRON }} {...rest}>
      {children}
    </select>
  );
}
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236f685c' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function Label({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-1.5 flex items-baseline justify-between gap-2', className)}>
      <span className="t-caption font-semibold text-ink">{children}</span>
      {hint && <span className="t-caption text-ink-muted">{hint}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-hafen' : 'bg-line', disabled && 'opacity-50')}
    >
      <span className={cx('absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-card transition-transform duration-200', checked && 'translate-x-5')} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cx('inline-flex rounded-md bg-paper-sunk p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex flex-1 items-center justify-center gap-1.5 rounded-sm font-semibold whitespace-nowrap transition-colors duration-[120ms]',
            size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[15px]',
            value === o.value ? 'bg-paper-raised text-ink shadow-card' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Surfaces
/** Cards and rows: paper-raised on paper, hairline border, radius-md. */
export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-md border border-line bg-paper-raised', className)} {...rest}>
      {children}
    </div>
  );
}

export function Chip({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <span
      className={cx('inline-flex h-6 items-center gap-1 rounded-full bg-paper-sunk px-2.5 text-[13px] font-semibold text-ink-muted', className)}
      style={color ? { color, background: `color-mix(in srgb, ${color} 13%, var(--paper-raised))` } : undefined}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-paper-sunk px-1 font-sans text-[11px] font-semibold text-ink-muted">
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-6 animate-spin text-ink-muted', className)} />;
}

/** Empty states show Otto (never flat icons). */
export function Empty({ mood = 'neutral', title, children, action }: { mood?: OttoMood; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <div className="mb-5 flex size-28 items-center justify-center rounded-full bg-krake-soft">
        <Otto size={88} mood={mood} />
      </div>
      <h3 className="t-heading">{title}</h3>
      {children && <div className="mt-2 max-w-sm text-[15px] text-ink-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  overline,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  overline?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-6 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {overline && <div className="t-overline mb-1.5 text-ink-muted">{overline}</div>}
        <h1 className="t-title">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mb-6', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="t-heading">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ Modal / sheet
// Phones: a bottom sheet (radius-lg on top, shadow-sheet). Wide screens: a dialog.
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal>
      <div className="anim-fade absolute inset-0 bg-[#14141466]" onClick={onClose} />
      <div
        ref={panel}
        className={cx(
          'anim-sheet pb-safe shadow-sheet relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg bg-paper-raised md:rounded-lg',
          wide ? 'md:max-w-3xl' : 'md:max-w-lg',
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line md:hidden" />
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2 md:pt-5">
            <div className="t-heading min-w-0">{title}</div>
            <IconButton label={tr('Schließen')} onClick={onClose} className="-mr-2">
              <X className="size-6" />
            </IconButton>
          </div>
        )}
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pt-2 pb-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ title: string; body?: ReactNode; confirm: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (title: string, opts: { body?: ReactNode; confirm?: string; danger?: boolean } = {}) =>
    new Promise<boolean>((resolve) => setState({ title, body: opts.body, confirm: opts.confirm ?? tr('OK'), danger: opts.danger, resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const node = (
    <Modal
      open={!!state}
      onClose={() => close(false)}
      title={state?.title}
      footer={
        <>
          <Button onClick={() => close(false)}>{tr('Abbrechen')}</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {state?.confirm}
          </Button>
        </>
      }
    >
      <div className="text-[15px] text-ink-muted">{state?.body}</div>
    </Modal>
  );
  return [ask, node] as const;
}

// ------------------------------------------------------------------ Toasts
type Toast = { id: number; text: ReactNode; kind: 'info' | 'success' | 'error'; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastSeq = 0;

function emitToasts() {
  toastListeners.forEach((f) => f());
}

export function toast(text: ReactNode, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 3200) {
  const id = ++toastSeq;
  toasts = [...toasts, { id, text, kind, action }];
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emitToasts();
  }, ms);
}
toast.success = (t: ReactNode, action?: Toast['action']) => toast(t, 'success', action);
toast.error = (t: ReactNode) => toast(t, 'error', undefined, 5000);

export function Toaster() {
  const list = useSyncExternalStore(
    (f) => {
      toastListeners.add(f);
      return () => toastListeners.delete(f);
    },
    () => toasts,
  );
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+var(--safe-bottom))] z-[60] flex flex-col items-center gap-2 px-5 md:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            'anim-in pointer-events-auto flex max-w-md items-center gap-3 rounded-md px-4 py-3 text-[15px] font-semibold shadow-xl',
            t.kind === 'error' ? 'bg-koralle-soft text-koralle-ink' : 'bg-ink text-paper',
          )}
        >
          {t.kind === 'success' && <CheckIcon weight="bold" className="size-5 shrink-0 text-wiese" />}
          {t.kind === 'error' && <WarningIcon weight="bold" className="size-5 shrink-0" />}
          <span>{t.text}</span>
          {t.action && (
            <button
              className="rounded-xs px-2 py-1 font-bold underline underline-offset-4"
              onClick={() => {
                t.action!.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                emitToasts();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ Progress
export function Ring({ value, size = 64, stroke = 7, color = 'var(--hafen)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--paper-sunk)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset .32s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Progress bar on a paper-sunk track. */
export function Bar({ value, color = 'var(--hafen)', className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-paper-sunk', className)}>
      <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}
