import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Zap, ArrowRight, ShieldAlert, Building2 } from 'lucide-react';
import { authApi } from '@/lib/authApi';
import { useAuthStore } from '@/store/authStore';
import { Button, Input, Field, Badge } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { ROLE_LABELS } from '@/types/auth';
import type { AuthRole } from '@/types/auth';

/**
 * AcceptInvitation -- real invitation acceptance. Token comes from the
 * URL path (not a query string, matching the real route shape:
 * /auth/invitations/:token/accept). Two real backend calls:
 *   1. GET  /auth/invitations/:token          -- preview (who invited you, to what workspace/role)
 *   2. POST /auth/invitations/:token/accept   -- sets password, activates the account, logs in
 * On success, real tokens are returned exactly like login/register --
 * this page logs the person straight into the dashboard, no separate
 * sign-in step.
 */
export function AcceptInvitation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const setSession = useAuthStore((s) => s.setSessionFromTokens);

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ email: string; role: AuthRole; tenantName: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreviewError('This invitation link is missing its token.');
      setLoading(false);
      return;
    }
    authApi.getInvitationPreview(token)
      .then((data) => setPreview(data as { email: string; role: AuthRole; tenantName: string }))
      .catch((err: unknown) => setPreviewError(err instanceof ApiError ? err.message : 'This invitation link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password !== confirmPassword) return toast.error('Passwords don\u2019t match');
    setSubmitting(true);
    try {
      const result = await authApi.acceptInvitation(token, password);
      setSession(result.user, result.accessToken);
      toast.success(`Welcome to ${preview?.tenantName}!`);
      navigate('/dashboard');
    } catch (err) {
      toast.error('Could not accept invitation', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
            <Zap size={18} fill="white" />
          </div>
          <p className="font-bold text-ink-900">InnovateX Revenue OS</p>
        </div>

        {loading && <p className="text-sm text-ink-500">Checking your invitation…</p>}

        {!loading && previewError && (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600"><ShieldAlert size={22} /></span>
            <h2 className="mt-4 text-2xl font-bold text-ink-900">Invitation not valid</h2>
            <p className="mt-1 text-sm text-ink-500">{previewError}</p>
            <Button variant="secondary" className="mt-6 w-full" onClick={() => navigate('/login')}>Back to sign in</Button>
          </>
        )}

        {!loading && preview && (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Building2 size={22} /></span>
            <h2 className="mt-4 text-2xl font-bold text-ink-900">Join {preview.tenantName}</h2>
            <p className="mt-1 text-sm text-ink-500">
              You've been invited as <Badge tone="violet">{ROLE_LABELS[preview.role]}</Badge>
            </p>
            <p className="mt-3 text-xs text-ink-400">{preview.email}</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label="Set your password" hint="At least 8 characters, with an uppercase letter, lowercase letter, and a number.">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="new-password" />
              </Field>
              <Field label="Confirm password">
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required autoComplete="new-password" />
              </Field>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Joining…' : 'Accept & join'} <ArrowRight size={16} />
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
