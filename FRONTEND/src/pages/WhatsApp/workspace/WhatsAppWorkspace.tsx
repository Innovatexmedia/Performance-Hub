import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Menu, PanelLeftClose, PanelLeftOpen, X, Zap } from 'lucide-react';
import { cn } from '@/components/ui';
import { WhatsAppPanel } from '../WhatsAppPanel';
import { WhatsAppSidebarNav } from './WhatsAppSidebarNav';
import { CampaignsPicker, type CampaignKind } from './CampaignsPicker';
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

/**
 * The rail starts COLLAPSED unless the user has explicitly opened it before.
 *
 * `=== '1'` would have done that too, but it can't tell "never chose" from
 * "chose collapsed", so the default has to be stated rather than implied: an
 * absent key means collapsed, and only a stored '0' counts as a deliberate
 * choice to keep it open. The workspace is where people read conversations,
 * so the default should hand that space to the content.
 */
function readInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored === null) return true;
    return stored === '1';
  } catch {
    return true;
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

  // No hover-to-expand. It was tried and removed: expanding the rail on hover
  // and showing a tooltip on hover are the same gesture, so the rail always
  // won and the tooltips -- the thing that actually makes an icon rail usable
  // -- could never appear. Hover now does one job: name the icon. Opening the
  // rail is a deliberate click on the header toggle.
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

  // Campaigns covers four different things -- two sending modes and two
  // filtered views -- so clicking it opens a chooser instead of dropping the
  // user into whichever list happened to be first. See CampaignsPicker.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState<'all' | 'broadcast' | 'scheduled'>('all');

  const selectTab = (id: string) => {
    if (id === 'campaigns') {
      setPickerOpen(true);
      setMobileNavOpen(false);
      return;
    }
    setActiveTab(id);
    setMobileNavOpen(false);
  };

  const chooseCampaignKind = (kind: CampaignKind) => {
    setPickerOpen(false);
    setMobileNavOpen(false);

    if (kind === 'api') {
      setActiveTab('api-campaigns');
      return;
    }

    // Broadcast and Scheduled are filters over the same list, not separate
    // destinations -- so they land on the Campaigns tab with the filter
    // pre-selected rather than on a tab of their own.
    setCampaignFilter(kind === 'campaigns' ? 'all' : kind);
    setActiveTab('campaigns');
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
      {/* No top bar.
          It was a full-width dark strip carrying three controls and a title,
          and it cost ~48px of every screen to say what the rail already says.
          Its contents moved to where they belong: branding and the collapse
          toggle into the rail itself, and Exit to the top-right of the
          content, where a "leave this place" control is normally looked for. */}

      <div className="relative flex min-h-0 flex-1">
        {/* ---- Desktop vertical nav (collapsible rail) ----
            overflow-visible, not hidden: the collapsed rail's tooltips are
            positioned outside its own 68px, and clipping them would leave the
            icons with no labels at all. */}
        <aside
          className={cn(
            'hidden shrink-0 flex-col overflow-visible bg-sidebar lg:flex',
            'transition-[width] duration-200 ease-out motion-reduce:transition-none',
            // 48px collapsed: a 16px icon inside a 32px hit area, plus 8px of
            // breathing room each side. Anything wider is padding pretending
            // to be layout.
            collapsed ? 'w-12' : 'w-56',
          )}
        >
          {/* Rail head. The logo doubles as the collapse toggle when the rail
              is closed -- a separate toggle button would take a second row in
              a 48px column, and the logo is already the obvious thing to
              click. Expanded, the toggle appears beside it. */}
          <div className={cn('flex shrink-0 items-center py-2', collapsed ? 'justify-center px-1.5' : 'gap-2 px-3')}>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              className="group/logo flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 shadow-sm transition-transform duration-150 hover:scale-105 motion-reduce:transition-none"
            >
              <Zap size={15} fill="white" className={cn(collapsed && 'group-hover/logo:hidden')} />
              {collapsed && <PanelLeftOpen size={15} className="hidden text-white group-hover/logo:block" />}
            </button>

            {!collapsed && (
              <>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">WhatsApp</p>
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  aria-label="Collapse navigation"
                  title="Collapse navigation"
                  className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-sidebar-hover hover:text-white motion-reduce:transition-none"
                >
                  <PanelLeftClose size={16} />
                </button>
              </>
            )}
          </div>

          <WhatsAppSidebarNav
            activeTab={activeTab}
            onSelect={selectTab}
            expanded={!collapsed}
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
                expanded
                approvalBadgeCount={approvalBadgeCount}
              />
            </div>
          </div>
        )}

        {/* ---- Active view ---- */}
        <main className="relative min-w-0 flex-1 overflow-hidden bg-ink-50">
          {/* Exit, and the mobile nav opener, float over the content instead
              of occupying a bar of their own. Both are small, both are at the
              edges, and neither takes a row from the page. */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open WhatsApp navigation"
            className="absolute left-3 top-3 z-20 rounded-lg border border-ink-200 bg-white/90 p-1.5 text-ink-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-ink-900 lg:hidden motion-reduce:transition-none"
          >
            <Menu size={16} />
          </button>

          <button
            ref={exitButtonRef}
            type="button"
            onClick={exit}
            title="Exit WhatsApp Workspace"
            aria-label="Exit WhatsApp Workspace"
            className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white/90 px-2.5 py-1.5 text-xs font-medium text-ink-600 shadow-sm backdrop-blur transition-colors hover:border-ink-300 hover:bg-white hover:text-ink-900 motion-reduce:transition-none"
          >
            <ChevronLeft size={14} /> Exit
          </button>

          <WhatsAppPanel tab={activeTab} onApprovalBadgeChange={setApprovalBadgeCount} onNavigateTab={selectTab} campaignFilter={campaignFilter} onOpenCampaignPicker={() => setPickerOpen(true)} />

          <CampaignsPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={chooseCampaignKind}
          />
        </main>
      </div>
    </div>
  );
}