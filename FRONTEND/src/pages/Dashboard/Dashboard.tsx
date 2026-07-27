import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, Flame, CalendarCheck, DollarSign, TrendingUp, Percent, Timer,
  CheckSquare, MessageCircle, MailWarning, AlertTriangle, Sparkles, ArrowRight,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useDashboard } from '@/hooks/useDashboard';
import { KpiCard } from '@/components/ui/KpiCard';
import { Card, CardHeader, Badge, PageHeader, Button } from '@/components/ui';
import { BarChartCard, LineChartCard, DonutChartCard, FunnelChartCard } from '@/components/charts';
import { formatCurrency, formatCompact, timeAgo } from '@/utils/formatters';

/**
 * Dashboard -- confirmed spec-aligned (MASTER_SPEC B2, FRONTEND_SPEC §3):
 * 12 KPI cards, AI briefing, 7 charts, 3 bottom sections, all real,
 * computed server-side across 8 real MongoDB models. Design/layout/JSX
 * structure below is UNCHANGED from the original -- only the data source
 * (mock computeDashboard() -> real GET /dashboard) and each value/delta/
 * data prop were swapped for real values, per explicit instruction not to
 * touch the design.
 *
 * Every chart component expects the same {name, value, color?} shape --
 * the mapping below is intentionally explicit and visible here rather
 * than hidden in the hook, so the real->display transformation stays
 * auditable.
 *
 * Known backend inconsistency (not fixed, out of scope): the
 * leakageAlerts KPI card and the Leakage Alerts section below compute
 * "booked but not paid" using two different Deal stages internally, so
 * their numbers can occasionally disagree by a small amount -- flagged,
 * not silently reconciled.
 */
export function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data, loading, error } = useDashboard();

  if (loading || !data) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Here's your revenue command center for today." />
        <p className="p-8 text-center text-sm text-ink-400">Loading dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Here's your revenue command center for today." />
        <Card className="p-4 text-sm text-red-600">{error}</Card>
      </div>
    );
  }

  const { kpis, charts, recentActivity, topCampaigns, leakageAlerts, weeklyBriefing } = data;

  // Explicit, auditable mapping from real backend field names to the
  // {name, value} shape every chart component requires.
  const sources = charts.leadsBySource.map((s) => ({ name: s.source, value: s.count }));
  const stages = charts.pipelineByStage.map((s) => ({ name: s.stage, value: s.count }));
  const funnel = charts.conversionFunnel.map((f) => ({ name: f.stage, value: f.count }));
  const revSource = charts.revenueBySource.map((r) => ({ name: r.source, value: r.revenue }));
  const bookings = charts.bookingTrend.map((b) => ({ name: b.date, value: b.count }));
  const convoTrend = charts.waConversationTrend.map((c) => ({ name: c.date, value: c.count }));
  // Real Campaign model has no "replied" field -- leads_generated is the
  // closest real, meaningful per-campaign metric available.
  const campaignPerf = charts.campaignPerformance.map((c) => ({ name: c.campaign_name.slice(0, 14), value: c.leads_generated }));

  const events = recentActivity;
  const briefing = weeklyBriefing.briefing;

  const leakageItems = [
    { label: 'Ghosted leads', count: leakageAlerts.items.find((i) => i.type === 'ghosted')?.count ?? 0, tone: 'red' as const },
    { label: 'Proposals idle 5+ days', count: leakageAlerts.items.find((i) => i.type === 'idle_proposal')?.count ?? 0, tone: 'amber' as const },
    { label: 'Booked but not paid', count: leakageAlerts.items.find((i) => i.type === 'booked_no_pay')?.count ?? 0, tone: 'amber' as const },
  ];

  return (
    <div>
      <PageHeader
        title={`Good ${greeting()}, ${user?.firstName ?? ''} 👋`}
        description="Here's your revenue command center for today."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/reports')}>View reports</Button>
            <Button onClick={() => navigate('/leads')}><Users size={16} /> Manage leads</Button>
          </>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total Leads" value={kpis.totalLeads.value} delta={kpis.totalLeads.change ?? undefined} icon={<Users size={18} />} accent="#6366f1" />
        <KpiCard label="Qualified Leads" value={kpis.qualifiedLeads.value} delta={kpis.qualifiedLeads.change ?? undefined} icon={<UserCheck size={18} />} accent="#3b82f6" />
        <KpiCard label="Hot Leads" value={kpis.hotLeads.value} delta={kpis.hotLeads.change ?? undefined} icon={<Flame size={18} />} accent="#ef4444" />
        <KpiCard label="Booked Calls" value={kpis.bookedCalls.value} delta={kpis.bookedCalls.change ?? undefined} icon={<CalendarCheck size={18} />} accent="#8b5cf6" />
        <KpiCard label="Pipeline Value" value={formatCompact(kpis.pipelineValue.value)} icon={<TrendingUp size={18} />} accent="#06b6d4" />
        <KpiCard label="Revenue Closed" value={formatCurrency(kpis.revenueClosed.value)} delta={kpis.revenueClosed.change ?? undefined} icon={<DollarSign size={18} />} accent="#10b981" />
        <KpiCard label="Conversion Rate" value={`${kpis.conversionRate.value.toFixed(1)}%`} delta={kpis.conversionRate.change ?? undefined} icon={<Percent size={18} />} accent="#f59e0b" />
        <KpiCard label="Avg Response Time" value={`${kpis.avgResponseTime.value}m`} icon={<Timer size={18} />} accent="#14b8a6" />
        <KpiCard label="Follow-up Completion" value={`${kpis.followUpCompletion.value.toFixed(0)}%`} icon={<CheckSquare size={18} />} accent="#8b5cf6" />
        <KpiCard label="WA Conversations" value={kpis.waConversations.value} delta={kpis.waConversations.change ?? undefined} icon={<MessageCircle size={18} />} accent="#22c55e" />
        <KpiCard label="WA Pending Replies" value={kpis.waPendingReplies.value} hint="Awaiting response" icon={<MailWarning size={18} />} accent="#f97316" />
        <KpiCard label="Leakage Alerts" value={kpis.leakageAlerts.value} hint="Revenue at risk" icon={<AlertTriangle size={18} />} accent="#ef4444" />
      </div>

      {/* AI briefing */}
      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-col gap-4 bg-gradient-to-r from-brand-600 to-violet-600 p-5 text-white sm:flex-row sm:items-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Sparkles size={22} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Weekly AI Briefing</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-brand-50">{briefing}</p>
          </div>
        </div>
      </Card>

      {/* Charts row 1 */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <DonutChartCard title="Leads by Source" subtitle="Where your pipeline comes from" data={sources} />
        <BarChartCard title="Pipeline by Stage" subtitle="Active deal distribution" data={stages} />
      </div>

      {/* Charts row 2 */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <FunnelChartCard title="Conversion Funnel" subtitle="Lead → Won" data={funnel} />
        <BarChartCard title="Revenue by Source" subtitle="Closed revenue attribution" data={revSource} color="#10b981" />
        <LineChartCard title="Booking Trend" subtitle="Last 8 days" data={bookings} color="#8b5cf6" area />
      </div>

      {/* Charts row 3 */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <LineChartCard title="WhatsApp Conversations" subtitle="Last 14 days" data={convoTrend} color="#22c55e" area />
        <BarChartCard title="Campaign Performance" subtitle="Leads generated by campaign" data={campaignPerf} color="#6366f1" />
      </div>

      {/* Bottom sections */}
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {/* Recent activity */}
        <Card className="lg:col-span-1">
          <CardHeader title="Recent Activity" subtitle="Live tracking events" />
          <div className="divide-y divide-ink-50">
            {events.map((e) => {
              const lead = typeof e.lead_id === 'object' && e.lead_id ? e.lead_id : null;
              return (
                <div key={e._id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">{e.event_type}</p>
                    <p className="truncate text-xs text-ink-500">{lead?.name ?? 'System'} · {e.source}</p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-400">{timeAgo(e.created_at)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Top campaigns */}
        <Card>
          <CardHeader title="Top Campaigns" subtitle="By closed revenue" action={<Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => navigate('/campaigns')}>View all <ArrowRight size={13} /></Button>} />
          <div className="divide-y divide-ink-50">
            {topCampaigns.map((c) => (
              <div key={c._id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-800">{c.campaign_name}</p>
                  <p className="text-xs text-ink-500">{c.leads_generated} leads · {c.bookings} booked</p>
                </div>
                <Badge tone="green">{formatCompact(c.revenue)}</Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Revenue leakage */}
        <Card>
          <CardHeader title="Revenue Leakage Alerts" subtitle="Money at risk right now" action={<Badge tone="red">{leakageAlerts.total}</Badge>} />
          <div className="space-y-2 p-4">
            {leakageItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle size={16} className={item.tone === 'red' ? 'text-red-500' : 'text-amber-500'} />
                  <span className="text-sm text-ink-700">{item.label}</span>
                </div>
                <Badge tone={item.tone}>{item.count}</Badge>
              </div>
            ))}
            <Button variant="secondary" className="mt-1 w-full" onClick={() => navigate('/nurture')}>
              Launch recovery sequences
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
