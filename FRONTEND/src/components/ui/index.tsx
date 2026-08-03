import React, { useEffect } from 'react';
import { X, ChevronRight, Search, Inbox } from 'lucide-react';
import { initials } from '@/utils/formatters';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---- Button ----------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: { variant?: ButtonVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const map: Record<ButtonVariant, string> = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  };
  return (
    <button className={cn(map[variant], className)} {...props}>
      {children}
    </button>
  );
}

// ---- Card ------------------------------------------------------------------
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('card', className)}>{children}</div>;
}
export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---- Badge -----------------------------------------------------------------
export type BadgeTone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal' | 'pink';
const toneMap: Record<BadgeTone, string> = {
  gray: 'bg-ink-100 text-ink-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-violet-50 text-violet-700',
  teal: 'bg-teal-50 text-teal-700',
  pink: 'bg-pink-50 text-pink-700',
};
export function Badge({ tone = 'gray', children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', toneMap[tone], className)}>
      {children}
    </span>
  );
}

// Maps domain statuses to tones
export function statusTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (['won', 'paid', 'active', 'connected', 'completed', 'delivered', 'read', 'provider approved', 'internally approved', 'approved', 'replied', 'sent'].includes(s)) return 'green';
  if (['hot', 'failed', 'lost', 'rejected', 'rejected internally', 'provider rejected', 'cancelled', 'disconnected', 'blocked by opt-out', 'no show'].includes(s)) return 'red';
  if (['warm', 'pending', 'pending approval', 'proposal sent', 'scheduled', 'changes requested', 'provider pending', 'sending', 'simulation', 'rescheduled'].includes(s)) return 'amber';
  if (['qualified', 'booked', 'new', 'open', 'contacted'].includes(s)) return 'blue';
  if (['nurture', 'draft', 'paused', 'cold', 'inactive'].includes(s)) return 'gray';
  if (['call completed', 'submitted to provider', 'submitted for internal review'].includes(s)) return 'violet';
  return 'gray';
}
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

// ---- Avatar ----------------------------------------------------------------
export function Avatar({ name, color, size = 32 }: { name: string; color?: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: color ?? '#6366f1', width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

// ---- Modal -----------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className={cn('mt-[6vh] w-full rounded-2xl bg-white shadow-soft animate-slide-up', widths[size])}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-100 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Drawer ----------------------------------------------------------------
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className={cn('h-full w-full overflow-y-auto bg-white shadow-soft animate-slide-in', width)} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white/90 px-6 py-4 backdrop-blur">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ---- Inputs ----------------------------------------------------------------
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', props.className)} {...props} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('input', props.className)} {...props} />;
}
export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input', props.className)} {...props}>
      {children}
    </select>
  );
}

// ---- Toggle ----------------------------------------------------------------
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition', checked ? 'bg-brand-600' : 'bg-ink-300')}
    >
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

// ---- Tabs ------------------------------------------------------------------
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; count?: number; tone?: 'red' | 'green' }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition',
            active === t.id ? 'text-brand-700' : 'text-ink-500 hover:text-ink-800',
          )}
        >
          {t.label}
          {t.count != null && (
            <span
              className={cn(
                'ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold',
                t.tone === 'red' ? 'bg-red-100 text-red-700'
                  : t.tone === 'green' ? 'bg-emerald-100 text-emerald-700'
                  : active === t.id ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500',
              )}
            >
              {t.count}
            </span>
          )}
          {active === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}
        </button>
      ))}
    </div>
  );
}

// ---- Search Input ----------------------------------------------------------
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className="input pl-9"
      />
    </div>
  );
}

// ---- Empty State -----------------------------------------------------------
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-white p-3 text-ink-400 shadow-card">{icon ?? <Inbox size={22} />}</div>
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---- Page Header -----------------------------------------------------------
export function PageHeader({ title, description, actions, breadcrumb }: { title: string; description?: string; actions?: React.ReactNode; breadcrumb?: string[] }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {breadcrumb && (
          <nav className="mb-1 flex items-center gap-1 text-xs text-ink-400">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} />}
                <span className={i === breadcrumb.length - 1 ? 'text-ink-600' : ''}>{b}</span>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-bold text-ink-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- Simple Table ----------------------------------------------------------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('whitespace-nowrap border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500', className)}>{children}</th>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('whitespace-nowrap border-b border-ink-100 px-4 py-3 text-ink-700', className)}>{children}</td>;
}
export function Tr({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr onClick={onClick} className={cn(onClick && 'cursor-pointer transition hover:bg-brand-50/40', className)}>
      {children}
    </tr>
  );
}