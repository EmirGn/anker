import { Loader2, X } from 'lucide-react';
import {
  forwardRef,
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

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-105 active:brightness-95 shadow-sm',
  secondary: 'bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'bg-again/10 text-again hover:bg-again/15',
  outline: 'border border-line text-ink hover:bg-surface-2',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-2xl',
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
        'inline-flex select-none items-center justify-center font-medium whitespace-nowrap transition-[background,filter,color,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
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
        'inline-flex size-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40',
        active && 'bg-surface-2 text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Inputs
const field =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint outline-none transition-[border,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(field, 'h-11', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(field, 'min-h-[88px] resize-y py-2.5 leading-relaxed', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(field, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: CHEVRON }} {...rest}>
      {children}
    </select>
  );
}
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function Label({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-1.5 flex items-baseline justify-between gap-2', className)}>
      <span className="text-[13px] font-medium text-muted">{children}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
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
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3', disabled && 'opacity-50')}
    >
      <span className={cx('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
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
    <div className={cx('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-lg font-medium whitespace-nowrap transition-all',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Surfaces
export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-2xl border border-line bg-surface', className)} {...rest}>
      {children}
    </div>
  );
}

export function Chip({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-muted', className)}
      style={color ? { color, background: `color-mix(in srgb, ${color} 14%, transparent)` } : undefined}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-faint">
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-faint', className)} />;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">{icon}</div>}
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-6 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mb-8', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ Modal / sheet
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
      <div className="anim-fade absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className={cx(
          'anim-in pb-safe relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-2xl md:rounded-3xl',
          wide ? 'md:max-w-3xl' : 'md:max-w-lg',
        )}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 text-[17px] font-semibold">{title}</div>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X className="size-5" />
            </IconButton>
          </div>
        )}
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ title: string; body?: ReactNode; confirm: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (title: string, opts: { body?: ReactNode; confirm?: string; danger?: boolean } = {}) =>
    new Promise<boolean>((resolve) => setState({ title, body: opts.body, confirm: opts.confirm ?? 'OK', danger: opts.danger, resolve }));
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
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {state?.confirm}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{state?.body}</div>
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
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+var(--safe-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            'anim-in pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl',
            t.kind === 'error' ? 'bg-again text-white' : 'bg-ink text-bg',
          )}
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              className="rounded-lg px-2 py-1 font-semibold text-accent hover:bg-white/10"
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

// ------------------------------------------------------------------ Progress ring
export function Ring({ value, size = 64, stroke = 7, color = 'var(--accent)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
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
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
