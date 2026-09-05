import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, PanelLeftClose, PanelLeftOpen, X, Zap } from 'lucide-react';
import { cn } from '@/components/ui';
import { WhatsAppPanel } from '../WhatsAppPanel';
import { WhatsAppSidebarNav } from './WhatsAppSidebarNav';
import { getLastRoute } from './lastRoute';

const COLLAPSE_KEY = 'innovatex:whatsapp-sidebar-collapsed';
const LAST_TAB_KEY = 'innovatex:whatsapp-last-tab';

function readInitialTab(): string {
  try {
    return sessionStorage.getItem(LAST_TAB_KEY) || 'inbox';
  } catch {
    return 'inbox';
  }
}

function readInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Dedicated full-screen operating environment for WhatsApp, entered from
 * the main InnovateX sidebar (see components/layout/nav.ts -- the
 * "WhatsApp Panel" link still routes to /whatsapp, this is just what now
 * renders there). All actual WhatsApp functionality -- inbox, templates,
 * campaigns, AI, settings, etc. -- is untouched and still lives in
 * WhatsAppPanel; this component only supplies the workspace shell around
 * it: header, vertical nav (replacing the old horizontal tabs), a mobile
 * drawer, and a confirmed exit flow back to wherever the user came from.
 */
export function WhatsAppWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(readInitialTab);
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [approvalBadgeCount, setApprovalBadgeCount] = useState(0);
  const exitButtonRef = useRef<HTMLButtonElement>(null);

  // Entrance transition: a quick fade on mount, so switching into the
  // workspace reads as "a dedicated surface just became present" rather
  // than an instant page swap. Opacity-only (no scale/translate) is
  // deliberate -- this container is `fixed inset-0` and must always
  // cover the full viewport with zero gap; any transform like scale()
  // shrinks it from its center, which would briefly expose a sliver of
  // whatever's behind it at the edges during the animation. Starts
  // false so the initial paint is the "before" state, then flips true
  // on the next frame so the browser actually animates the transition
  // instead of skipping straight to the end state.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // The workspace covers the whole viewport, so the page underneath
  // shouldn't also be scrollable while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(LAST_TAB_KEY, activeTab); } catch { /* non-critical */ }
  }, [activeTab]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* non-critical */ }
      return next;
    });
  };

  const selectTab = (id: string) => {
    setActiveTab(id);
    setMobileNavOpen(false);
  };

  // Exit is now direct -- no confirmation step. It never protected
  // against real data loss (its own copy just reassured "you can return
  // anytime"), and having it on this button but not on the browser's
  // native back button (which reaches the same place with no dialog at
  // all) was a real, confusing inconsistency. Matches how leaving any
  // other section of the app already works.
  const exit = () => navigate(getLastRoute());

  // Escape exits directly too, same reasoning as the X button above --
  // but only when the user isn't mid-typing (search boxes, the
  // composer, etc.), so it never fights with existing input behavior.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement;
      const isTyping = el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (isTyping) return;
      exit();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-white transition-opacity duration-200 ease-out motion-reduce:transition-none',
        entered ? 'opacity-100' : 'opacity-0',
      )}
    >
      {/* ---- Header ---- */}
      <header className="flex h-14 shrink-0 items-center gap-3 bg-sidebar px-3 text-white lg:px-4">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="rounded-lg p-2 text-ink-300 hover:bg-sidebar-hover hover:text-white lg:hidden"
          aria-label="Open WhatsApp navigation"
        >
          <Menu size={18} />
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden rounded-lg p-2 text-ink-300 hover:bg-sidebar-hover hover:text-white lg:inline-flex"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 shadow-sm">
            <Zap size={15} fill="white" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-white">WhatsApp Workspace</p>
            <p className="truncate text-[11px] text-ink-400">InnovateX Revenue OS</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            ref={exitButtonRef}
            type="button"
            onClick={exit}
            title="Exit WhatsApp Workspace"
            aria-label="Exit WhatsApp Workspace"
            className="rounded-lg bg-white/10 p-2 text-white transition hover:bg-red-500/90 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ---- Desktop vertical nav (collapsible rail) ---- */}
        <aside
          className={cn(
            'sidebar-scroll hidden shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-200 ease-out lg:flex',
            collapsed ? 'w-[68px]' : 'w-60',
          )}
        >
          <WhatsAppSidebarNav
            activeTab={activeTab}
            onSelect={selectTab}
            collapsed={collapsed}
            approvalBadgeCount={approvalBadgeCount}
          />
        </aside>

        {/* ---- Mobile nav drawer ---- */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileNavOpen(false)} />
            <div className="sidebar-scroll absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-sidebar shadow-soft animate-slide-in">
              <div className="flex items-center justify-between px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-widest text-ink-400">WhatsApp</p>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-lg p-1.5 text-ink-300 hover:bg-sidebar-hover hover:text-white"
                  aria-label="Close navigation"
                >
                  <X size={16} />
                </button>
              </div>
              <WhatsAppSidebarNav
                activeTab={activeTab}
                onSelect={selectTab}
                collapsed={false}
                approvalBadgeCount={approvalBadgeCount}
              />
            </div>
          </div>
        )}

        {/* ---- Active view ---- */}
        <main className="min-w-0 flex-1 overflow-hidden bg-ink-50">
          <WhatsAppPanel tab={activeTab} onApprovalBadgeChange={setApprovalBadgeCount} onNavigateTab={selectTab} />
        </main>
      </div>
    </div>
  );
}