import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Zap, ArrowRight, ShieldAlert } from 'lucide-react';
import { authApi } from '@/lib/authApi';
import { Button, Input, Field } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';

/**
 * ResetPassword -- calls the real POST /auth/reset-password. Reads the
 * token from the URL query string, matching exactly the link format
 * email.service.js's sendPasswordReset() constructs:
 * `${CLIENT_URL}/reset-password?token=${token}` (15-minute real expiry).
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) return toast.error('Passwords don\u2019t match');
    if (!token) return toast.error('Missing reset token', 'Use the link from your email, or request a new one.');
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      toast.success('Password reset', 'Sign in with your new password.');
      navigate('/login');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not reset your password. The link may have expired.';
      toast.error('Reset failed', message);
    } finally {
      setLoading(false);
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

        {!token ? (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600"><ShieldAlert size={22} /></span>
            <h2 className="mt-4 text-2xl font-bold text-ink-900">Invalid reset link</h2>
            <p className="mt-1 text-sm text-ink-500">This link is missing its reset token. Request a new one below.</p>
            <Button className="mt-6 w-full" onClick={() => navigate('/forgot-password')}>Request a new link</Button>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-ink-900">Set a new password</h2>
            <p className="mt-1 text-sm text-ink-500">This link expires 15 minutes after it was sent.</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label="New password" hint="At least 8 characters, with an uppercase letter, lowercase letter, and a number.">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="new-password" />
              </Field>
              <Field label="Confirm new password">
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required autoComplete="new-password" />
              </Field>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Resetting…' : 'Reset password'} <ArrowRight size={16} />
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
