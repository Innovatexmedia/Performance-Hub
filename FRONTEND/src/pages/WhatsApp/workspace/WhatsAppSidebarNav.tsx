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
  { label: 'Outreach', tabIds: ['templates', 'approval', 'campaigns', 'broadcasts', 'nurture', 'rules'] },
  { label: 'Operations', tabIds: ['consent', 'logs', 'analytics', 'settings'] },
];

export function WhatsAppSidebarNav({
  activeTab,
  onSelect,
  collapsed,
  approvalBadgeCount,
}: {
  activeTab: string;
  onSelect: (id: string) => void;
  collapsed: boolean;
  approvalBadgeCount: number;
}) {
  const byId = Object.fromEntries(TABS.map((t) => [t.id, t]));

  return (
    <nav aria-label="WhatsApp workspace" className="sidebar-scroll flex-1 overflow-y-auto px-2 py-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-4">
          {!collapsed && (
            <p className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-500">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.tabIds.map((id) => {
              const item = byId[id];
              if (!item) return null;
              const active = activeTab === id;
              const badge = id === 'approval' && approvalBadgeCount > 0 ? approvalBadgeCount : 0;
              return (
                <li key={id} className="group/navitem relative">
                  <button
                    type="button"
                    onClick={() => onSelect(id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition',
                      collapsed && 'justify-center px-0 py-2.5',
                      active
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-ink-300 hover:bg-sidebar-hover hover:text-white',
                    )}
                  >
                    <span className="shrink-0">{TAB_ICONS[id]}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {badge > 0 && (
                      <span
                        className={cn(
                          'flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white',
                          collapsed ? 'absolute -right-0.5 -top-0.5' : 'ml-auto',
                        )}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                  {/* Accessible label for the collapsed, icon-only state --
                      a real CSS tooltip (not just a native title attr) so it
                      matches the rest of the app's visual language. */}
                  {collapsed && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-soft transition-opacity duration-150 group-hover/navitem:opacity-100"
                    >
                      {item.label}
                      {badge > 0 && ` (${badge})`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}