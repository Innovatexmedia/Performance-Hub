import { useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/components/ui';

export function AppLayout() {
  // Starts open on desktop-width viewports (matches today's look exactly),
  // closed on mobile (matches today's mobile behavior exactly) -- a static
  // default can't satisfy both, so this checks the real viewport once at
  // mount. Tailwind's `lg` breakpoint is 1024px, matched here directly.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  // 'idle'/'loading' = initialize() (see App.tsx) is still trying a silent
  // refresh via the httpOnly cookie -- wait rather than bounce to /login,
  // otherwise every full-page reload would flash the login screen even for
  // an already-signed-in user.
  if (status === 'idle' || status === 'loading') return null;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;

  // super_admin has no tenant context (confirmed: resolveTenant sets
  // req.tenant = null for this role on the backend) -- every tenant
  // module would silently render as permanently empty rather than
  // erroring, which is worse than a clear redirect. Hiding the sidebar
  // link (see nav.ts) stops normal navigation; this stops direct URL
  // access to the same broken destination. /super-admin and /profile are
  // the two real exceptions -- see comment above this block.
  if (user?.role === 'super_admin' && location.pathname !== '/super-admin' && location.pathname !== '/profile') {
    return <Navigate to="/super-admin" replace />;
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={cn('transition-[padding] duration-200', sidebarOpen && 'lg:pl-64')}>
        <Topbar onMenu={() => setSidebarOpen((v) => !v)} />
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}