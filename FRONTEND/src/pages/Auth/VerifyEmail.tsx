import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Zap, CheckCircle2, ShieldAlert, ArrowRight } from 'lucide-react';
import { authApi } from '@/lib/authApi';
import { Button } from '@/components/ui';
import { ApiError } from '@/lib/apiClient';

/**
 * VerifyEmail -- calls the real POST /auth/verify-email automatically on
 * load. Reads the token from the URL query string, matching the exact
 * link format email.service.js's sendEmailVerification() constructs:
 * `${CLIENT_URL}/verify-email?token=${token}` (24-hour real expiry).
 *
 * Non-blocking: login doesn't actually require a verified email today
 * (see auth.service.js's login()), so this page exists to complete the
 * flow properly, not to unlock access that was otherwise withheld.
 */
export function VerifyEmail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('This link is missing its verification token.');
      return;
    }
    authApi.verifyEmail(token)
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMessage(err instanceof ApiError ? err.message : 'This link may have expired. Verification links are valid for 24 hours.');
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
            <Zap size={18} fill="white" />
          </div>
          <p className="font-bold text-ink-900">InnovateX Revenue OS</p>
        </div>

        {status === 'verifying' && <p className="text-sm text-ink-500">Verifying your email…</p>}

        {status === 'success' && (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle2 size={22} /></span>
            <h2 className="mt-4 text-2xl font-bold text-ink-900">Email verified</h2>
            <p className="mt-1 text-sm text-ink-500">Your email is confirmed. You're all set.</p>
            <Button className="mt-6 w-full" onClick={() => navigate('/dashboard')}>
              Go to dashboard <ArrowRight size={16} />
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600"><ShieldAlert size={22} /></span>
            <h2 className="mt-4 text-2xl font-bold text-ink-900">Could not verify email</h2>
            <p className="mt-1 text-sm text-ink-500">{errorMessage}</p>
            <Button variant="secondary" className="mt-6 w-full" onClick={() => navigate('/dashboard')}>
              Go to dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
