import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowRight, TrendingUp, MessageCircle, Sparkles, Building2, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { Button, Input, Field } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { ApiError } from '@/lib/apiClient';
import { ROLE_LABELS } from '@/types/auth';

export function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const selectWorkspace = useAuthStore((s) => s.selectWorkspace);
  const pendingWorkspaceSelection = useAuthStore((s) => s.pendingWorkspaceSelection);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login({ email, password });
      // null = multi-workspace case -- pendingWorkspaceSelection is now
      // set, the form below switches to showing the picker instead.
      // Every account that existed before this feature shipped never
      // returns null here (see authStore.ts login()'s comment).
      if (user) {
        toast.success(`Welcome back, ${user.firstName}!`, `Signed in as ${user.email}`);
        navigate(user.role === 'super_admin' ? '/super-admin' : '/dashboard');
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.';
      toast.error('Sign in failed', message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectWorkspace = async (tenantId: string) => {
    setLoading(true);
    try {
      const user = await selectWorkspace(tenantId);
      toast.success(`Welcome back, ${user.firstName}!`);
      navigate(user.role === 'super_admin' ? '/super-admin' : '/dashboard');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not enter that workspace. Please try again.';
      toast.error('Could not switch workspace', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
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
          <h1 className="text-4xl font-bold leading-tight">The source-to-revenue operating system.</h1>
          <p className="mt-4 text-lg text-ink-300">
            Capture, qualify, nurture and close — across WhatsApp, your pipeline and every channel. AI-native, attribution-complete, revenue-focused.
          </p>
          <div className="mt-8 space-y-3">
            {[
              { icon: MessageCircle, text: 'Native WhatsApp panel + 8 provider integrations' },
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

      {/* Right form */}
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

          {pendingWorkspaceSelection ? (
            <>
              <h2 className="text-2xl font-bold text-ink-900">Choose a workspace</h2>
              <p className="mt-1 text-sm text-ink-500">You belong to more than one workspace — pick which one to enter.</p>

              <div className="mt-6 space-y-2">
                {pendingWorkspaceSelection.workspaces.map((w) => (
                  <button
                    key={w.tenantId}
                    disabled={loading}
                    onClick={() => void handleSelectWorkspace(w.tenantId)}
                    className="flex w-full items-center gap-3 rounded-xl border border-ink-200 p-3.5 text-left transition hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-50"
                  >
                    {w.logoUrl ? (
                      <img src={w.logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Building2 size={18} /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink-900">{w.tenantName}</p>
                      <p className="text-xs text-ink-500">{ROLE_LABELS[w.role]}</p>
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-ink-400" />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-ink-900">Sign in</h2>
              <p className="mt-1 text-sm text-ink-500">Welcome back. Enter your credentials to continue.</p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <Field label="Email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" />
                </Field>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-ink-700">Password</label>
                    <button type="button" onClick={() => navigate('/forgot-password')} className="text-xs font-medium text-brand-600 hover:text-brand-700">Forgot password?</button>
                  </div>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" className="mt-1.5" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} />
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-ink-500">
                Don't have a workspace?{' '}
                <button type="button" onClick={() => navigate('/register')} className="font-medium text-brand-600 hover:text-brand-700">Sign up</button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}