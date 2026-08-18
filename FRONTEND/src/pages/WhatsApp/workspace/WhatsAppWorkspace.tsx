import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, PanelLeftClose, PanelLeftOpen, X, Zap } from 'lucide-react';
import { Button, Modal, cn } from '@/components/ui';
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
  const [exitOpen, setExitOpen] = useState(false);
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

  const requestExit = () => setExitOpen(true);
  const confirmExit = () => {
    setExitOpen(false);
    navigate(getLastRoute());
  };

  // Escape exits back to a confirmation, but only when the user isn't
  // mid-typing (search boxes, the composer, etc.) and no other dialog is
  // already open -- so it never fights with existing input/modal behavior.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || exitOpen) return;
      const el = document.activeElement;
      const isTyping = el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (isTyping) return;
      requestExit();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [exitOpen]);

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
            onClick={requestExit}
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
          <WhatsAppPanel tab={activeTab} onApprovalBadgeChange={setApprovalBadgeCount} />
        </main>
      </div>

      <ExitWorkspaceDialog open={exitOpen} onCancel={() => setExitOpen(false)} onConfirm={confirmExit} />
    </div>
  );
}

function ExitWorkspaceDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Minimal focus trap: only two real actions in this dialog (Cancel /
  // Exit Workspace), so Tab / Shift+Tab just cycles between them instead
  // of escaping to whatever is (invisibly, underneath this fixed overlay)
  // still mounted in the page behind it.
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const focusCancel = document.activeElement !== cancelRef.current;
      (focusCancel ? cancelRef.current : confirmRef.current)?.focus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Exit WhatsApp Workspace?"
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button ref={confirmRef} onClick={onConfirm}>Exit Workspace</Button>
        </>
      }
    >
      <p className="text-sm text-ink-600">
        Are you sure you want to exit the WhatsApp workspace? You can return to WhatsApp anytime from the main InnovateX workspace.
      </p>
    </Modal>
  );
}