import { NavLink } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { visibleNav } from './nav';
import { useAuthStore } from '@/store/authStore';
import { usePlanTrack } from '@/hooks/usePlanTrack';
import { usePlanStore } from '@/store/planStore';
import { cn } from '@/components/ui';

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const C = (Icons as unknown as Record<string, React.FC<{ size?: number; className?: string }>>)[name];
  return C ? <C size={size} /> : <Icons.Circle size={size} />;
}

/**
 * NavSkeleton — a handful of pulsing placeholder bars shown while the
 * plan track is still loading, instead of guessing which nav set to
 * show. planStore previously defaulted an unknown track to "show
 * everything" specifically to avoid a different flash (fewer items
 * suddenly expanding to more) -- but that traded it for a worse one,
 * confirmed in practice: a WhatsApp-only tenant briefly seeing
 * AI Qualification/Automations/Payments/etc in the sidebar on every
 * refresh before it correctly narrowed back down. Neither guess looks
 * professional; a brief, honest loading state does.
 */
function NavSkeleton() {
  return (
    <div className="space-y-2 px-3 pt-1" aria-hidden="true">
      {[1, 0.85, 0.7, 0.9, 0.6, 0.8].map((width, i) => (
        <div key={i} className="h-8 animate-pulse rounded-lg bg-sidebar-hover/60" style={{ width: `${width * 100}%` }} />
      ))}
    </div>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const planTrack = usePlanTrack();
  const planLoaded = usePlanStore((s) => s.loaded);
  if (!user) return null;
  const items = visibleNav(user.role, planTrack);
  const groups = ['Revenue', 'Growth', 'Admin'];

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink-950/50 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'sidebar-scroll fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto bg-sidebar text-ink-300 transition-transform',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-lg">
            <Icons.Zap size={18} fill="white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">InnovateX</p>
            <p className="text-[11px] font-medium text-brand-300">Revenue OS</p>
          </div>
        </div>

        <nav className="flex-1 px-3 pb-4">
          {!planLoaded ? (
            <NavSkeleton />
          ) : (
            groups.map((group) => {
              const groupItems = items.filter((i) => i.group === group);
              if (!groupItems.length) return null;
              return (
                <div key={group} className="mb-4">
                  <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-500">{group}</p>
                  <ul className="space-y-0.5">
                    {groupItems.map((item) => (
                      <li key={item.path}>
                        <NavLink
                          to={item.path}
                          onClick={() => { if (window.innerWidth < 1024) onClose(); }}
                          className={({ isActive }) =>
                            cn(
                              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                              isActive
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'text-ink-300 hover:bg-sidebar-hover hover:text-white',
                            )
                          }
                        >
                          <Icon name={item.icon} />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </nav>
      </aside>
    </>
  );
}