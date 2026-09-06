import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowRight, MessageCircle, Sparkles, TrendingUp } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { Button, Input, Field } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';

/**
 * Register -- new tenant owner self-registration (creates a new workspace).
 * SOURCE: auth.validator.js's validateRegister + auth.service.js's
 * register() -- this endpoint only ever creates a tenant_owner from here;
 * role is never sent as a field on this page at all, since exposing a
 * role picker (including super_admin) on a public signup form would be
 * the same class of real security issue that was just fixed on the
 * backend. Every other role (tenant_admin, sales_user, read_only_user)
 * is added later via the Team page by whoever becomes the owner here.
 */
export function Register() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', workspaceName: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await register({ ...form, role: 'tenant_owner' });
      // null now means the real, normal case for a fresh signup:
      // verification is required before any session exists (see
      // authStore.ts register()'s comment) -- route to /verify-email
      // instead of assuming a session was already established.
      if (user) {
        toast.success(`Welcome, ${user.firstName}!`, 'Your workspace is ready.');
        navigate('/dashboard');
      } else {
        const pending = useAuthStore.getState().pendingEmailVerification;
        toast.success('Account created!', 'Please verify your email to continue.');
        navigate(`/verify-email${pending ? `?email=${encodeURIComponent(pending.email)}` : ''}`);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not create your account. Please try again.';
      toast.error('Sign up failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 shadow-lg">
            <Zap size={20} fill="white" />
          </div>
          <div>
            <p className="text-lg font-bold">InnovateX</p>
            <p className="text-xs font-medium text-brand-300">Revenue OS</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Start your workspace in minutes.</h1>
          <p className="mt-4 text-lg text-ink-300">
            One free workspace, every tool included. Invite your team once you're in.
          </p>
          <div className="mt-8 space-y-3">
            {[
              { icon: MessageCircle, text: 'Native WhatsApp panel + real provider integrations' },
              { icon: Sparkles, text: 'AI qualification, scoring & call intelligence' },
              { icon: TrendingUp, text: 'Source-to-revenue attribution & leakage alerts' },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-ink-200">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <f.icon size={16} />
                </span>
                {f.text}
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-ink-400">© 2026 InnovateX Media.</p>
      </div>

      <div className="flex w-full flex-col items-center justify-center bg-white px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
                <Zap size={18} fill="white" />
              </div>
              <p className="font-bold text-ink-900">InnovateX Revenue OS</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-ink-900">Create your workspace</h2>
          <p className="mt-1 text-sm text-ink-500">You'll be the owner — invite your team once you're in.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required autoComplete="given-name" /></Field>
              <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required autoComplete="family-name" /></Field>
            </div>
            <Field label="Workspace name"><Input value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} placeholder="Acme Inc." required /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" required autoComplete="email" /></Field>
            <Field label="Password" hint="At least 8 characters, with an uppercase letter, lowercase letter, and a number.">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" required autoComplete="new-password" />
            </Field>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creating workspace…' : 'Create workspace'} <ArrowRight size={16} />
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-500">
            Already have a workspace?{' '}
            <button type="button" onClick={() => navigate('/login')} className="font-medium text-brand-600 hover:text-brand-700">Sign in</button>
          </p>
        </div>
      </div>
    </div>
  );
}