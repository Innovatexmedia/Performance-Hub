import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { atLeast } from '@/lib/permissions';
import type { AuthRole } from '@/types/auth';

/**
 * RequireRole -- generalizes the inline role-check pattern already used
 * for the /super-admin route in App.tsx (`user?.role === 'super_admin'
 * ? <SuperAdmin /> : <Navigate to="/dashboard" />`), so future role-gated
 * routes don't repeat that inline ternary. Same real behavior, reusable.
 *
 * This is frontend UX only -- redirects an unauthorized role away from a
 * page cleanly instead of showing a broken/empty page. It does NOT
 * replace backend enforcement, which stays the real security boundary
 * (every route this wraps is also independently protected by its own
 * real requireRole()/authorize() middleware on the backend).
 */
export function RequireRole({ minRole, exact, children }: { minRole?: AuthRole; exact?: AuthRole; children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role);

  const allowed = exact ? role === exact : atLeast(role, minRole as AuthRole);

  if (!allowed) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
