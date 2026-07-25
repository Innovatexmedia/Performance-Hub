import { NavLink } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { visibleNav } from './nav';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/components/ui';

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const C = (Icons as unknown as Record<string, React.FC<{ size?: number; className?: string }>>)[name];
  return C ? <C size={size} /> : <Icons.Circle size={size} />;
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const items = visibleNav(user.role);
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
          {groups.map((group) => {
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
          })}
        </nav>

        <div className="mx-3 mb-4 rounded-xl bg-sidebar-accent p-3.5">
          <p className="text-xs font-semibold text-white">Investor Demo</p>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-400">All integrations run in simulation mode. Data is local & resettable.</p>
        </div>
      </aside>
    </>
  );
}