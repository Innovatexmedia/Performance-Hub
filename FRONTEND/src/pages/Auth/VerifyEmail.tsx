import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Zap, CheckCircle2, ShieldAlert, ArrowRight } from 'lucide-react';
import { authApi } from '@/lib/authApi';
import { useAuthStore } from '@/store/authStore';
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
 * BLOCKING now: login/register no longer issue a session until this
 * step actually succeeds (see auth.service.js's real isEmailVerified
 * gate) -- this page is the moment a session first gets established for
 * a self-registered account, not just a follow-up confirmation of one
 * that already exists. Both success paths below call
 * setSessionFromTokens() with the real tokens the backend now returns
 * from verify-email/verify-email/otp, then navigate -- there is no
 * pre-existing session to rely on anymore.
 */
export function VerifyEmail() {
  const navigate = useNavigate();
  const setSessionFromTokens = useAuthStore((s) => s.setSessionFromTokens);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'otp'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  const [otpEmail, setOtpEmail] = useState(searchParams.get('email') || '');
  const [otp, setOtp] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  useEffect(() => {
    if (!token) {
      // No link token in the URL -- this is the real "type your code"
      // entry point, not necessarily an error.
      setStatus('otp');
      return;
    }
    authApi.verifyEmail(token)
      .then(({ user, accessToken }) => {
        setSessionFromTokens(user, accessToken);
        setStatus('success');
      })
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMessage(err instanceof ApiError ? err.message : 'This link may have expired. Verification links are valid for 24 hours.');
      });
  }, [token, setSessionFromTokens]);

  const handleOtpSubmit = async () => {
    if (!otpEmail.trim() || !otp.trim()) return;
    setOtpSubmitting(true);
    setOtpError('');
    try {
      const { user, accessToken } = await authApi.verifyEmailOtp(otpEmail.trim(), otp.trim());
      setSessionFromTokens(user, accessToken);
      setStatus('success');
    } catch (err) {
      setOtpError(apiErrorMessage(err, 'Incorrect or expired code. Please try again.'));
    } finally {
      setOtpSubmitting(false);
    }
  };

  /**
   * handleResend -- the real recovery path for the exact gap that made
   * "Could not create your account" show up while the account genuinely
   * existed underneath: if issueVerificationEmail() ever failed
   * server-side during registration (now caught rather than breaking
   * the whole signup -- see auth.service.js's try/catch around it), this
   * is how someone with no session at all yet gets a fresh code, using
   * only the email they registered with. Public/unauthenticated
   * endpoint -- same "never reveal whether the account exists" response
   * either way as password-reset.
   */
  const handleResend = async () => {
    if (!otpEmail.trim()) {
      setOtpError('Enter your email above first, then tap Resend code.');
      return;
    }
    setResending(true);
    setResendMessage('');
    setOtpError('');
    try {
      await authApi.resendVerificationPublic(otpEmail.trim());
      setResendMessage('If that email needs verification, a new code is on its way.');
    } catch {
      // Deliberately still shows the same generic message on a genuine
      // network/server error -- the alternative (a different message
      // for "request failed" vs "here's your code") would itself leak
      // whether the account exists, defeating the whole point of the
      // backend's generic response.
      setResendMessage('If that email needs verification, a new code is on its way.');
    } finally {
      setResending(false);
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
              {resendMessage && <p className="text-xs text-emerald-600">{resendMessage}</p>}
            </div>
            <Button className="mt-6 w-full" disabled={otpSubmitting || otp.length !== 6 || !otpEmail.trim()} onClick={() => void handleOtpSubmit()}>
              {otpSubmitting ? 'Verifying…' : 'Verify email'}
            </Button>
            <button
              type="button"
              className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
              disabled={resending}
              onClick={() => void handleResend()}
            >
              {resending ? 'Sending…' : "Didn't get a code? Resend"}
            </button>
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
            {/* No "Go to dashboard" option here anymore -- verification
                is now required before any session exists at all (see
                this file's header comment), so there's genuinely nowhere
                valid to send them without it; retrying via the code is
                the only real path forward from here. */}
            <Button variant="secondary" className="mt-3 w-full" onClick={() => { setStatus('otp'); setErrorMessage(''); }}>
              Enter code instead
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
