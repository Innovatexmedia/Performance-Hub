import { useNavigate } from 'react-router-dom';
import {
  Zap, ArrowRight, MessageCircle, Sparkles, TrendingUp, ShieldCheck,
  CheckCircle2, Repeat, GitBranch, BarChart3, Check,
} from 'lucide-react';

/**
 * Public marketing landing page. Grounded in the product's own real
 * identity (same brand gradient, tagline, and feature language as
 * Login.tsx's brand panel) rather than a generic SaaS template --
 * the hero's centerpiece is a WhatsApp conversation mockup, since
 * native WhatsApp handling is this product's single most
 * characteristic, differentiating capability, not an abstract
 * illustration or stock photo.
 */
export function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white text-ink-900">
      {/* ---- Nav ---- */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-sm">
            <Zap size={18} fill="white" />
          </div>
          <div className="leading-tight">
            <p className="font-bold text-ink-900">InnovateX</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">Revenue OS</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/login')} className="text-sm font-medium text-ink-600 hover:text-ink-900">
            Sign in
          </button>
          <button
            onClick={() => navigate('/register')}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            Get started
          </button>
        </div>
      </nav>

      {/* ---- Hero ---- */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 top-40 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-16">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-ink-100 bg-ink-50 px-3 py-1 text-xs font-medium text-ink-600">
              <ShieldCheck size={13} className="text-emerald-600" /> Consent-safe by design, not an afterthought
            </div>
            <h1 className="text-4xl font-bold leading-[1.1] text-ink-900 sm:text-5xl">
              Every lead lives on WhatsApp.<br />Your revenue OS finally does too.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-ink-500">
              Capture, qualify, nurture and close — natively on WhatsApp, with a real pipeline, real automation, and attribution that traces every rupee back to its source.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate('/register')}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-brand-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:opacity-90"
              >
                Start free <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate('/login')}
                className="rounded-lg border border-ink-200 px-5 py-3 text-sm font-semibold text-ink-700 transition hover:bg-ink-50"
              >
                Sign in
              </button>
            </div>
            <p className="mt-4 text-xs text-ink-400">No credit card required · Set up your WhatsApp workspace in minutes</p>
          </div>

          {/* WhatsApp conversation mockup -- the product's real, tangible
              differentiator, not a stock illustration. */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="rounded-[2rem] border-8 border-ink-900 bg-ink-900 shadow-2xl">
              <div className="overflow-hidden rounded-[1.4rem] bg-[#e5ddd5]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
                <div className="flex items-center gap-2.5 bg-[#075e54] px-4 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">RK</div>
                  <div className="leading-tight">
                    <p className="text-sm font-semibold text-white">Ram Kshatriya</p>
                    <p className="text-[10px] text-white/70">online</p>
                  </div>
                </div>
                <div className="space-y-2.5 p-4">
                  <div className="ml-auto max-w-[80%] rounded-lg rounded-tr-sm bg-[#dcf8c6] px-3 py-2 text-[13px] text-ink-800 shadow-sm">
                    Hi Ram! Saw you checked out our pricing page — happy to walk you through it 🙂
                    <p className="mt-1 text-right text-[9px] text-ink-400">10:02 ✓✓</p>
                  </div>
                  <div className="max-w-[80%] rounded-lg rounded-tl-sm bg-white px-3 py-2 text-[13px] text-ink-800 shadow-sm">
                    Yes! Can we do a call tomorrow?
                    <p className="mt-1 text-right text-[9px] text-ink-400">10:04</p>
                  </div>
                  <div className="mx-auto w-fit rounded-full bg-white/70 px-3 py-1 text-[10px] font-medium text-ink-500">
                    ⚡ Auto-qualified · Score 8/10 · Booking link sent
                  </div>
                  <div className="ml-auto max-w-[80%] rounded-lg rounded-tr-sm bg-[#dcf8c6] px-3 py-2 text-[13px] text-ink-800 shadow-sm">
                    Booked you in for 4pm tomorrow — see you then!
                    <p className="mt-1 text-right text-[9px] text-ink-400">10:04 ✓✓</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-4 -left-6 flex items-center gap-2 rounded-xl border border-ink-100 bg-white px-3 py-2 shadow-lg">
              <TrendingUp size={16} className="text-emerald-600" />
              <div className="leading-tight">
                <p className="text-xs font-bold text-ink-900">Deal won</p>
                <p className="text-[10px] text-ink-400">Attributed to Meta Ads</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Feature grid -- grounded in real, specific capabilities ---- */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold text-ink-900 sm:text-3xl">
          Not a CRM with a WhatsApp button bolted on.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink-500">
          Every module is built around the conversation, not around a form.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: MessageCircle, color: 'from-emerald-500 to-teal-500', title: 'Native WhatsApp workspace', text: 'Real Meta Cloud API integration, templates, campaigns and broadcasts — plus 8 alternate provider connectors.' },
            { icon: ShieldCheck, color: 'from-blue-500 to-cyan-500', title: 'Consent, handled properly', text: 'Automatic opt-out detection on every inbound STOP, enforced before every single outbound send — no exceptions.' },
            { icon: Sparkles, color: 'from-violet-500 to-fuchsia-500', title: 'AI qualification', text: 'Every lead scored and routed automatically, with call intelligence that never lets a hot lead go cold.' },
            { icon: Repeat, color: 'from-amber-500 to-orange-500', title: 'Automation that actually runs', text: 'Trigger real actions — tags, assignments, nurture sequences, follow-ups — off real events, not a rules list that just sits there.' },
            { icon: GitBranch, color: 'from-pink-500 to-rose-500', title: 'Source-to-revenue attribution', text: 'Trace every closed deal back to the ad, campaign or channel that actually brought it in.' },
            { icon: BarChart3, color: 'from-indigo-500 to-blue-500', title: 'One real pipeline', text: 'Deals, bookings, payments and WhatsApp conversations in one place — not four disconnected tools.' },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-ink-100 p-6 transition hover:border-ink-200 hover:shadow-sm">
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${f.color} text-white`}>
                <f.icon size={18} />
              </div>
              <h3 className="font-semibold text-ink-900">{f.title}</h3>
              <p className="mt-1.5 text-sm text-ink-500">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Simple, honest checklist section instead of fake logos/stats ---- */}
      <section className="border-y border-ink-100 bg-ink-50/50">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="text-center text-2xl font-bold text-ink-900">Built for how your team actually sells</h2>
          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            {[
              'Every opt-out honored automatically, everywhere',
              'One pipeline for WhatsApp, calls and bookings',
              'Campaigns that never message an opted-out contact',
              'Real-time delivery, read and reply tracking',
              'Rules that fire on real events, not just on paper',
              'Attribution down to the exact source and campaign',
              'Templates approved and synced directly with Meta',
              'Built to send at scale, without tripping rate limits',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-sm text-ink-700">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Final CTA ---- */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold text-ink-900">Stop juggling WhatsApp Business and your CRM.</h2>
        <p className="mx-auto mt-3 max-w-md text-ink-500">Bring your whole revenue funnel into one workspace, built around the conversation.</p>
        <button
          onClick={() => navigate('/register')}
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-brand-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:opacity-90"
        >
          Create your workspace <ArrowRight size={16} />
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-400">
          <Check size={12} /> Free to start · <Check size={12} /> No card needed
        </p>
      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t border-ink-100 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-500 text-white">
              <Zap size={12} fill="white" />
            </div>
            InnovateX Revenue OS
          </div>
          <a href="mailto:Innovatexmedia@gmail.com" className="text-xs text-ink-500 hover:text-ink-800 hover:underline">
            Innovatexmedia@gmail.com
          </a>
          <p className="text-xs text-ink-400">© 2026 InnovateX Media. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}