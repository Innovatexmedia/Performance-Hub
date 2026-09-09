import type { ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Zap, ArrowLeft } from 'lucide-react';

export function LegalLayout({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-ink-900">
      <nav className="sticky top-0 z-40 border-b border-ink-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-sm">
              <Zap size={18} fill="white" />
            </div>
            <div className="text-left leading-tight">
              <p className="font-bold text-ink-900">InnovateX</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">Revenue OS</p>
            </div>
          </button>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            <ArrowLeft size={15} /> Back to home
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-bold text-ink-900">{title}</h1>
        {updated && <p className="mt-2 text-sm text-ink-400">Last updated: {updated}</p>}
        <div className="prose-legal mt-8 space-y-6 text-sm leading-relaxed text-ink-700">
          {children}
        </div>
      </main>

      <footer className="border-t border-ink-100 px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-500 text-white">
              <Zap size={12} fill="white" />
            </div>
            InnovateX Revenue OS
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-500">
            <Link to="/contact" className="hover:text-ink-800 hover:underline">Contact Us</Link>
            <Link to="/terms-and-conditions" className="hover:text-ink-800 hover:underline">Terms & Conditions</Link>
            <Link to="/refund-policy" className="hover:text-ink-800 hover:underline">Refund & Cancellation</Link>
            <Link to="/privacy-policy" className="hover:text-ink-800 hover:underline">Privacy Policy</Link>
          </div>
          <p className="text-xs text-ink-400">© 2026 InnovateX Media. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/** Section heading used consistently inside every legal page's body. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}