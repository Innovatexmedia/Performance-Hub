import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap, ArrowRight, MessageCircle, Sparkles, TrendingUp, ShieldCheck,
  CheckCircle2, Repeat, GitBranch, BarChart3, Check, Menu, X,
  LayoutDashboard, KanbanSquare, Inbox, PlayCircle,
} from 'lucide-react';

/**
 * Reveal -- scroll-triggered entrance animation. Plain IntersectionObserver,
 * no new dependency (no framer-motion/gsap in this project) -- fades +
 * slides a section up the first time it enters the viewport, then
 * disconnects (a marketing page's entrance animation should happen once,
 * not re-trigger every time someone scrolls back past a section).
 */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

const NAV_LINKS = [
  { id: 'features', label: 'Features' },
  { id: 'plans', label: 'Plans' },
  { id: 'demo', label: 'Demo' },
];

const DEMO_TABS = [
  {
    id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard,
    render: () => (
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
        {[
          { label: 'Total leads', value: '104', tone: 'text-ink-900' },
          { label: 'Hot leads', value: '25', tone: 'text-rose-600' },
          { label: 'Pipeline value', value: '₹5.1L', tone: 'text-ink-900' },
          { label: 'WA conversations', value: '4', tone: 'text-emerald-600' },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-ink-100 bg-white p-3.5">
            <p className="text-[11px] text-ink-400">{k.label}</p>
            <p className={`mt-1 text-xl font-bold ${k.tone}`}>{k.value}</p>
          </div>
        ))}
        <div className="col-span-2 rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 p-4 text-white sm:col-span-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Weekly AI briefing</p>
          <p className="mt-1 text-sm text-white/90">25 hot leads have a 3x higher close rate — prioritize those first.</p>
        </div>
      </div>
    ),
  },
  {
    id: 'pipeline', label: 'Pipeline', icon: KanbanSquare,
    render: () => (
      <div className="flex gap-3 overflow-x-auto p-5">
        {[
          { stage: 'New Lead', count: 12, color: 'bg-ink-400' },
          { stage: 'Qualified', count: 6, color: 'bg-blue-500' },
          { stage: 'Booked Call', count: 3, color: 'bg-violet-500' },
          { stage: 'Won', count: 2, color: 'bg-emerald-500' },
        ].map((s) => (
          <div key={s.stage} className="w-36 shrink-0 rounded-xl border border-ink-100 bg-white p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${s.color}`} />
              <p className="text-xs font-semibold text-ink-700">{s.stage}</p>
            </div>
            <p className="text-[11px] text-ink-400">{s.count} deals</p>
            <div className="mt-2 h-14 rounded-lg bg-ink-50" />
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'whatsapp', label: 'WhatsApp Panel', icon: Inbox,
    render: () => (
      <div className="flex h-56 gap-3 p-5">
        <div className="w-1/3 space-y-1.5 overflow-hidden rounded-xl border border-ink-100 bg-white p-2">
          {['Ram Kshatriya', 'Priya Sharma', 'Kiran Bodh'].map((n, i) => (
            <div key={n} className={`rounded-lg p-2 ${i === 0 ? 'bg-brand-50' : ''}`}>
              <p className="text-xs font-medium text-ink-800">{n}</p>
              <p className="truncate text-[10px] text-ink-400">Yes! Can we do a call tomorrow?</p>
            </div>
          ))}
        </div>
        <div className="flex-1 space-y-2 rounded-xl border border-ink-100 bg-[#e5ddd5] p-3">
          <div className="ml-auto w-2/3 rounded-lg rounded-tr-sm bg-[#dcf8c6] px-2.5 py-1.5 text-[11px] text-ink-800 shadow-sm">
            Saw you checked our pricing — want a quick walkthrough?
          </div>
          <div className="w-2/3 rounded-lg rounded-tl-sm bg-white px-2.5 py-1.5 text-[11px] text-ink-800 shadow-sm">
            Yes! Can we do a call tomorrow?
          </div>
          <div className="mx-auto w-fit rounded-full bg-white/70 px-2.5 py-1 text-[9px] font-medium text-ink-500">
            ⚡ Auto-qualified · Score 8/10
          </div>
        </div>
      </div>
    ),
  },
];

/**
 * Public marketing landing page. Grounded in the product's own real
 * identity (same brand gradient, tagline, and feature language as
 * Login.tsx's brand panel) rather than a generic SaaS template --
 * the hero's centerpiece is a WhatsApp conversation mockup, since
 * native WhatsApp handling is this product's single most
 * characteristic, differentiating capability, not an abstract
 * illustration or stock photo.
 *
 * Plans section mirrors the ACTUAL two plan tracks enforced in the app
 * (see components/layout/nav.ts's WHATSAPP_ONLY_MODULES and
 * ModuleGate.tsx) -- not marketing copy invented independently of what
 * the product really gates.
 */
export function Landing() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [demoTab, setDemoTab] = useState(DEMO_TABS[0].id);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMobileNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const activeDemo = DEMO_TABS.find((t) => t.id === demoTab) ?? DEMO_TABS[0];

  return (
    <div className="min-h-screen bg-white text-ink-900">
      {/* ---- Nav ---- */}
      <nav className={`sticky top-0 z-40 border-b transition-all ${scrolled ? 'border-ink-100 bg-white/80 backdrop-blur-md' : 'border-transparent bg-white'}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-sm">
              <Zap size={18} fill="white" />
            </div>
            <div className="leading-tight">
              <p className="font-bold text-ink-900">InnovateX</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">Revenue OS</p>
            </div>
          </div>

          <div className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map((link) => (
              <button key={link.id} onClick={() => scrollTo(link.id)} className="text-sm font-medium text-ink-600 transition hover:text-ink-900">
                {link.label}
              </button>
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
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

          <button className="p-1 text-ink-700 md:hidden" onClick={() => setMobileNavOpen((v) => !v)} aria-label="Toggle menu">
            {mobileNavOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {mobileNavOpen && (
          <div className="animate-slide-up space-y-1 border-t border-ink-100 bg-white px-6 py-4 md:hidden">
            {NAV_LINKS.map((link) => (
              <button key={link.id} onClick={() => scrollTo(link.id)} className="block w-full py-2 text-left text-sm font-medium text-ink-700">
                {link.label}
              </button>
            ))}
            <div className="mt-2 flex gap-2 pt-2">
              <button onClick={() => navigate('/login')} className="flex-1 rounded-lg border border-ink-200 py-2 text-sm font-semibold text-ink-700">Sign in</button>
              <button onClick={() => navigate('/register')} className="flex-1 rounded-lg bg-ink-900 py-2 text-sm font-semibold text-white">Get started</button>
            </div>
          </div>
        )}
      </nav>

      {/* ---- Hero ---- */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 animate-pulse rounded-full bg-brand-500/10 blur-3xl" style={{ animationDuration: '6s' }} />
        <div className="pointer-events-none absolute -left-32 top-40 h-96 w-96 animate-pulse rounded-full bg-violet-500/10 blur-3xl" style={{ animationDuration: '8s' }} />

        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-16">
          <div className="animate-slide-up">
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
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-brand-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:scale-[1.03] hover:opacity-90"
              >
                Start free <ArrowRight size={16} />
              </button>
              <button
                onClick={() => scrollTo('demo')}
                className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-5 py-3 text-sm font-semibold text-ink-700 transition hover:bg-ink-50"
              >
                <PlayCircle size={16} /> See it in action
              </button>
            </div>
            <p className="mt-4 text-xs text-ink-400">No credit card required · Set up your WhatsApp workspace in minutes</p>
          </div>

          {/* WhatsApp conversation mockup -- the product's real, tangible
              differentiator, not a stock illustration. */}
          <div className="relative mx-auto w-full max-w-sm animate-slide-up" style={{ animationDelay: '120ms' }}>
            <div className="rounded-[2rem] border-8 border-ink-900 bg-ink-900 shadow-2xl transition-transform duration-500 hover:-translate-y-1">
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
                  <div className="mx-auto w-fit animate-pulse rounded-full bg-white/70 px-3 py-1 text-[10px] font-medium text-ink-500">
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
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <Reveal>
          <h2 className="text-center text-2xl font-bold text-ink-900 sm:text-3xl">
            Not a CRM with a WhatsApp button bolted on.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-ink-500">
            Every module is built around the conversation, not around a form.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: MessageCircle, color: 'from-emerald-500 to-teal-500', title: 'Native WhatsApp workspace', text: 'Real Meta Cloud API integration, templates, campaigns and broadcasts — plus 8 alternate provider connectors.' },
            { icon: ShieldCheck, color: 'from-blue-500 to-cyan-500', title: 'Consent, handled properly', text: 'Automatic opt-out detection on every inbound STOP, enforced before every single outbound send — no exceptions.' },
            { icon: Sparkles, color: 'from-violet-500 to-fuchsia-500', title: 'AI qualification', text: 'Every lead scored and routed automatically, with call intelligence that never lets a hot lead go cold.' },
            { icon: Repeat, color: 'from-amber-500 to-orange-500', title: 'Automation that actually runs', text: 'Trigger real actions — tags, assignments, nurture sequences, follow-ups — off real events, not a rules list that just sits there.' },
            { icon: GitBranch, color: 'from-pink-500 to-rose-500', title: 'Source-to-revenue attribution', text: 'Trace every closed deal back to the ad, campaign or channel that actually brought it in.' },
            { icon: BarChart3, color: 'from-indigo-500 to-blue-500', title: 'One real pipeline', text: 'Deals, bookings, payments and WhatsApp conversations in one place — not four disconnected tools.' },
          ].map((f, i) => (
            <Reveal key={f.title} delay={i * 80}>
              <div className="h-full rounded-2xl border border-ink-100 p-6 transition hover:-translate-y-1 hover:border-ink-200 hover:shadow-soft">
                <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${f.color} text-white`}>
                  <f.icon size={18} />
                </div>
                <h3 className="font-semibold text-ink-900">{f.title}</h3>
                <p className="mt-1.5 text-sm text-ink-500">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- Plans -- mirrors the real two plan tracks the app enforces ---- */}
      <section id="plans" className="border-y border-ink-100 bg-ink-50/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className="text-center text-2xl font-bold text-ink-900 sm:text-3xl">Two ways to start</h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-ink-500">
              Start with just WhatsApp, or bring your whole revenue funnel in from day one. Switch anytime.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Reveal delay={80}>
              <div className="flex h-full flex-col rounded-2xl border border-ink-200 bg-white p-8">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
                  <MessageCircle size={18} />
                </div>
                <h3 className="text-lg font-bold text-ink-900">WhatsApp Panel</h3>
                <p className="mt-1 text-sm text-ink-500">Just the conversation layer — leads, messaging, and a simple pipeline.</p>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {['WhatsApp inbox & templates', 'Lead capture & management', 'Basic pipeline (Kanban)', 'Campaigns & broadcasts', 'Consent & opt-out handling'].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-ink-700">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate('/register')}
                  className="mt-8 rounded-lg border border-ink-200 py-2.5 text-sm font-semibold text-ink-700 transition hover:bg-ink-50"
                >
                  Start with WhatsApp Panel
                </button>
              </div>
            </Reveal>

            <Reveal delay={160}>
              <div className="relative flex h-full flex-col rounded-2xl border-2 border-brand-500 bg-white p-8 shadow-soft">
                <span className="absolute -top-3 right-8 rounded-full bg-gradient-to-br from-brand-600 to-violet-600 px-3 py-1 text-[11px] font-semibold text-white">
                  Complete revenue OS
                </span>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 text-white">
                  <Sparkles size={18} />
                </div>
                <h3 className="text-lg font-bold text-ink-900">Full Access</h3>
                <p className="mt-1 text-sm text-ink-500">Everything in WhatsApp Panel, plus the full revenue engine.</p>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {['Everything in WhatsApp Panel', 'AI lead qualification & call intelligence', 'Nurture sequences & automation rules', 'Bookings, calendar & payments', 'Source-to-revenue attribution & reports'].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-ink-700">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-brand-600" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => navigate('/register')}
                  className="mt-8 rounded-lg bg-gradient-to-br from-brand-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:opacity-90"
                >
                  Start with Full Access
                </button>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---- Demo -- interactive tabbed product preview ---- */}
      <section id="demo" className="mx-auto max-w-5xl px-6 py-20">
        <Reveal>
          <h2 className="text-center text-2xl font-bold text-ink-900 sm:text-3xl">See it in action</h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-ink-500">
            A real look at the workspace — no forms to fill out first.
          </p>
        </Reveal>

        <Reveal delay={100}>
          <div className="mt-10 overflow-hidden rounded-2xl border border-ink-200 shadow-soft">
            <div className="flex items-center gap-1 border-b border-ink-100 bg-ink-50 p-2">
              {DEMO_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setDemoTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                    demoTab === tab.id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  <tab.icon size={15} /> {tab.label}
                </button>
              ))}
            </div>
            <div key={activeDemo.id} className="animate-fade-in bg-ink-50/40">
              {activeDemo.render()}
            </div>
          </div>
        </Reveal>

        <Reveal delay={180}>
          <div className="mt-8 text-center">
            <button
              onClick={() => navigate('/register')}
              className="inline-flex items-center gap-2 rounded-lg bg-ink-900 px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.03] hover:bg-ink-800"
            >
              Try it yourself, free <ArrowRight size={16} />
            </button>
          </div>
        </Reveal>
      </section>

      {/* ---- Simple, honest checklist section instead of fake logos/stats ---- */}
      <section className="border-y border-ink-100 bg-ink-50/50">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <Reveal>
            <h2 className="text-center text-2xl font-bold text-ink-900">Built for how your team actually sells</h2>
          </Reveal>
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
            ].map((item, i) => (
              <Reveal key={item} delay={i * 50}>
                <div className="flex items-start gap-2.5 text-sm text-ink-700">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                  {item}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Final CTA ---- */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <Reveal>
          <h2 className="text-3xl font-bold text-ink-900">Stop juggling WhatsApp Business and your CRM.</h2>
          <p className="mx-auto mt-3 max-w-md text-ink-500">Bring your whole revenue funnel into one workspace, built around the conversation.</p>
          <button
            onClick={() => navigate('/register')}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-brand-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 transition hover:scale-[1.03] hover:opacity-90"
          >
            Create your workspace <ArrowRight size={16} />
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-400">
            <Check size={12} /> Free to start · <Check size={12} /> No card needed
          </p>
        </Reveal>
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