import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/components/ui';
import { TABS, TAB_ICONS } from '../WhatsAppPanel';

// Purely a presentation grouping of the same TABS/ids WhatsAppPanel already
// defines -- doesn't change which tabs exist or what they do, just clusters
// them the way the main app Sidebar groups its own nav (Revenue/Growth/Admin)
// for a consistent design language between the two.
//
// 'ai' (the standalone AI Reply Assistant tab) is intentionally left out of
// every group below -- AI reply generation now lives only in the chat
// composer (see Composer.tsx's "AI" menu), so the dedicated sidebar entry
// point is removed. The AIAssistantTab component and its logic in
// WhatsAppPanel.tsx are untouched; it's simply unreachable from this nav.
const NAV_GROUPS: { label: string; tabIds: string[] }[] = [
  { label: 'Messaging', tabIds: ['inbox', 'contacts', 'groups'] },
  // 'api-campaigns' is deliberately absent: it is reached through the
  // Campaigns picker, not as a sibling of Campaigns. Listing both would say
  // they are two separate features, when an API campaign is one of the four
  // things Campaigns covers -- the picker is what makes that relationship
  // visible. The tab itself still exists in WhatsAppPanel's TABS; it is just
  // not its own nav entry.
  { label: 'Outreach', tabIds: ['templates', 'approval', 'campaigns', 'broadcasts', 'nurture', 'rules'] },
  { label: 'Operations', tabIds: ['consent', 'logs', 'analytics', 'settings'] },
];

/**
 * WhatsAppSidebarNav
 *
 * `expanded` is the VISUAL state (pinned open, or temporarily open because the
 * pointer is over the rail). `pinned` is the user's actual preference.
 *
 * WHY LABELS ARE NEVER UNMOUNTED
 * ──────────────────────────────
 * They used to render behind `!collapsed && <span>`, so collapsing animated
 * the rail's width smoothly while the text simply vanished and reappeared on
 * the far side of the animation. That single-frame pop is what made the whole
 * thing feel cheap no matter how smooth the width transition was. Labels now
 * stay mounted and animate their own opacity and offset, so text and rail move
 * together.
 *
 * Collapsed labels are hidden with opacity and pointer-events rather than
 * `display: none`, which would be unanimatable; `aria-hidden` keeps them out
 * of the accessibility tree while invisible, and the button's own aria-label
 * carries the name either way.
 */
export function WhatsAppSidebarNav({
  activeTab,
  onSelect,
  expanded,
  approvalBadgeCount,
}: {
  activeTab: string;
  onSelect: (id: string) => void;
  expanded: boolean;
  approvalBadgeCount: number;
}) {
  const byId = Object.fromEntries(TABS.map((t) => [t.id, t]));

  /**
   * Tooltips are rendered through a portal with fixed positioning, not as an
   * absolutely-positioned child of the button.
   *
   * The nav scrolls vertically, and a scroll container cannot have
   * `overflow-x: visible` on the other axis -- the browser promotes it to
   * auto. So any tooltip sitting inside it gets clipped at the rail's 68px,
   * which is exactly the width it needs to escape. A portal puts it outside
   * that container entirely; the coordinates come from the icon's own
   * bounding box, so it still tracks the item it belongs to.
   */
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);

  const showTip = (label: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (expanded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
  };

  return (
    <nav aria-label="WhatsApp workspace" className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2 pt-1">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-3">
          {/* The group heading collapses its own height as well as fading, so
              the icons close up into an even rail instead of leaving gaps
              where the headings used to be. */}
          <p
            aria-hidden={!expanded}
            className={cn(
              'overflow-hidden whitespace-nowrap px-2.5 text-[10px] font-bold uppercase tracking-widest text-ink-500',
              'transition-all duration-200 ease-out motion-reduce:transition-none',
              expanded ? 'h-5 pb-1.5 opacity-100' : 'h-0 pb-0 opacity-0',
            )}
          >
            {group.label}
          </p>

          <ul className="space-y-0.5">
            {group.tabIds.map((id) => {
              const item = byId[id];
              if (!item) return null;
              // API Campaigns has no nav entry of its own, so while it's
              // open nothing would appear selected and the sidebar would look
              // like it had lost its place. Campaigns stays lit, which is also
              // the truth: that's where the user is.
              const active = activeTab === id || (id === 'campaigns' && activeTab === 'api-campaigns');
              const badge = id === 'approval' && approvalBadgeCount > 0 ? approvalBadgeCount : 0;

              return (
                <li
                  key={id}
                  className="relative"
                  onMouseEnter={showTip(badge > 0 ? `${item.label} (${badge})` : item.label)}
                  onMouseLeave={() => setTip(null)}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(id)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}
                    className={cn(
                      'relative flex w-full items-center gap-3 rounded-lg py-1.5 text-sm font-medium',
                      'transition-colors duration-150 ease-out motion-reduce:transition-none',
                      // Padding stays constant so the icon does not slide
                      // sideways as the rail resizes -- it sits at the same x
                      // in both states, and only the label moves.
                      // Constant padding so the icon sits at the same x in
                      // both states -- only the label moves when the rail
                      // resizes.
                      'px-2.5',
                      active
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-ink-300 hover:bg-sidebar-hover hover:text-white',
                    )}
                  >
                    <span className="shrink-0">{TAB_ICONS[id]}</span>

                    <span
                      aria-hidden={!expanded}
                      className={cn(
                        'min-w-0 flex-1 truncate text-left',
                        'transition-all duration-200 ease-out motion-reduce:transition-none',
                        expanded
                          ? 'translate-x-0 opacity-100'
                          : 'pointer-events-none -translate-x-1 opacity-0',
                      )}
                    >
                      {item.label}
                    </span>

                    {badge > 0 && (
                      <span
                        className={cn(
                          'flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white',
                          'transition-all duration-200 ease-out motion-reduce:transition-none',
                          // Collapsed, the count can't sit in a row it has no
                          // room for, so it becomes a corner dot on the icon --
                          // still visible, which is the point of a badge.
                          expanded ? 'static' : 'absolute right-1.5 top-1',
                        )}
                      >
                        {badge}
                      </span>
                    )}
                  </button>

                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {tip && !expanded && createPortal(
        <span
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs font-medium text-white shadow-soft"
        >
          {tip.label}
        </span>,
        document.body
      )}
    </nav>
  );
}