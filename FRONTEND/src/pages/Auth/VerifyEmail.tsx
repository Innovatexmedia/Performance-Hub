import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Zap, CheckCircle2, ShieldAlert, ArrowRight } from 'lucide-react';
import { authApi } from '@/lib/authApi';
import { Button, Field, Input } from '@/components/ui';
import { ApiError, apiErrorMessage } from '@/lib/apiClient';

/**
 * VerifyEmail -- calls the real POST /auth/verify-email automatically on
 * load. Reads the token from the URL query string, matching the exact
 * link format email.service.js's sendEmailVerification() constructs:
 * `${CLIENT_URL}/verify-email?token=${token}` (24-hour real expiry).
 *
 * Also offers the real OTP alternative (POST /auth/verify-email/otp) --
 * the same email now also carries a 6-digit code, for anyone who'd
 * rather type a code than click a link. Own status/attempt state, since
 * it's a genuinely separate real backend call with its own real failure
 * modes (wrong code, expired code, too many attempts).
 *
 * Non-blocking: login doesn't actually require a verified email today
 * (see auth.service.js's login()), so this page exists to complete the
 * flow properly, not to unlock access that was otherwise withheld.
 */
export function VerifyEmail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'otp'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  const [otpEmail, setOtpEmail] = useState(searchParams.get('email') || '');
  const [otp, setOtp] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState('');

  useEffect(() => {
    if (!token) {
      // No link token in the URL -- this is the real "type your code"
      // entry point, not necessarily an error.
      setStatus('otp');
      return;
    }
    authApi.verifyEmail(token)
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMessage(err instanceof ApiError ? err.message : 'This link may have expired. Verification links are valid for 24 hours.');
      });
  }, [token]);

  const handleOtpSubmit = async () => {
    if (!otpEmail.trim() || !otp.trim()) return;
    setOtpSubmitting(true);
    setOtpError('');
    try {
      await authApi.verifyEmailOtp(otpEmail.trim(), otp.trim());
      setStatus('success');
    } catch (err) {
      setOtpError(apiErrorMessage(err, 'Incorrect or expired code. Please try again.'));
    } finally {
      setOtpSubmitting(false);
    }
  };

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

        {status === 'otp' && (
          <>
            <h2 className="text-2xl font-bold text-ink-900">Enter your code</h2>
            <p className="mt-1 text-sm text-ink-500">We emailed you a 6-digit verification code.</p>
            <div className="mt-6 space-y-4 text-left">
              <Field label="Email"><Input value={otpEmail} onChange={(e) => setOtpEmail(e.target.value)} placeholder="you@company.com" /></Field>
              <Field label="Verification code">
                <Input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                />
              </Field>
              {otpError && <p className="text-xs text-red-600">{otpError}</p>}
            </div>
            <Button className="mt-6 w-full" disabled={otpSubmitting || otp.length !== 6 || !otpEmail.trim()} onClick={() => void handleOtpSubmit()}>
              {otpSubmitting ? 'Verifying…' : 'Verify email'}
            </Button>
          </>
        )}

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
            <Button variant="secondary" className="mt-3 w-full" onClick={() => { setStatus('otp'); setErrorMessage(''); }}>
              Enter code instead
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate('/dashboard')}>
              Go to dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
