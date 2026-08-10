import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowRight, ArrowLeft, MailCheck } from 'lucide-react';
import { authApi } from '@/lib/authApi';
import { Button, Input, Field } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';

/**
 * ForgotPassword -- calls the real POST /auth/forgot-password. Always
 * shows the same "check your email" success state regardless of whether
 * the email is actually registered -- this matches standard security
 * practice (never reveal whether an email exists in the system via this
 * form) and is exactly what a real /forgot-password endpoint should do.
 */
export function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      toast.error('Could not send reset link', message);
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

        {sent ? (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><MailCheck size={22} /></span>
            <h2 className="mt-4 text-2xl font-bold text-ink-900">Check your email</h2>
            <p className="mt-1 text-sm text-ink-500">If an account exists for <span className="font-medium text-ink-700">{email}</span>, we've sent a link to reset your password. It expires in 15 minutes.</p>
            <Button variant="secondary" className="mt-6 w-full" onClick={() => navigate('/login')}>
              <ArrowLeft size={16} /> Back to sign in
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-ink-900">Reset your password</h2>
            <p className="mt-1 text-sm text-ink-500">Enter your email and we'll send you a link to reset it.</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" />
              </Field>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'} <ArrowRight size={16} />
              </Button>
            </form>

            <button type="button" onClick={() => navigate('/login')} className="mt-6 flex w-full items-center justify-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-700">
              <ArrowLeft size={14} /> Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
