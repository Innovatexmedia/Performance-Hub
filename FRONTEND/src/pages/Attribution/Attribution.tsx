import { Network, Download, GitBranch } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Table, Th, Td, Tr, Badge, StatusBadge, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { BarChartCard, DonutChartCard } from '@/components/charts';
import { exportToCSV } from '@/utils/csvExport';
import { formatCurrency, formatDateTime, formatCompact, formatCurrencyCompact } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useAttribution } from '@/hooks/useAttribution';
import { attributionApi } from '@/lib/attributionApi';
import { ApiError } from '@/lib/apiClient';

export function Attribution() {
  const { dashboard, loading, error } = useAttribution();

  const exportCsv = async () => {
    try {
      const rows = await attributionApi.exportData();
      exportToCSV('attribution', rows as unknown as Record<string, unknown>[]);
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Attribution & Tracking"
        description="Source-to-revenue attribution across every lifecycle event."
        breadcrumb={['Growth', 'Attribution']}
        actions={<Button variant="secondary" onClick={() => void exportCsv()}><Download size={16} /> Export CSV</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Tracking events" value={dashboard?.kpis.totalEvents ?? '—'} icon={<Network size={18} />} accent="#6366f1" />
        <KpiCard label="Attributed revenue" value={dashboard ? formatCurrencyCompact(dashboard.kpis.attributedRevenue) : '—'} icon={<GitBranch size={18} />} accent="#10b981" />
        <KpiCard label="Sources" value={dashboard?.kpis.uniqueSources ?? '—'} icon={<Network size={18} />} accent="#8b5cf6" />
        <KpiCard label="Top source" value={dashboard?.kpis.topSource ?? '—'} icon={<Network size={18} />} accent="#f59e0b" />
      </div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}
      {loading && !dashboard && <p className="p-8 text-center text-sm text-ink-400">Loading attribution data…</p>}

      {dashboard && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <DonutChartCard
              title="Leads by Source"
              subtitle="First-touch attribution"
              data={dashboard.leadsBySource.map((r) => ({ name: r.source, value: r.count }))}
            />
            <BarChartCard
              title="Revenue by Source"
              subtitle="Closed-won attribution"
              color="#10b981"
              data={dashboard.revenueBySource.map((r) => ({ name: r.source, value: r.revenue }))}
            />
            <DonutChartCard
              title="Bookings by Source"
              data={dashboard.bookingsBySource.map((r) => ({ name: r.source, value: r.count }))}
            />
          </div>

          <div className="mt-4">
            <BarChartCard
              title="Tracking Events by Type"
              subtitle="Full-funnel lifecycle events"
              color="#8b5cf6"
              data={dashboard.eventsByType.map((r) => ({ name: r.event_type, value: r.count }))}
            />
          </div>

          <Card className="mt-4">
            <CardHeader title="Source-to-Revenue Breakdown" subtitle="Conversion across the funnel by source" />
            {dashboard.sourceToRevenue.length === 0 ? (
              <EmptyState title="No attribution data yet" />
            ) : (
              <Table>
                <thead>
                  <tr><Th>Source</Th><Th>Leads</Th><Th>Qualified</Th><Th>Booked</Th><Th>Calls</Th><Th>Lead→Booking</Th><Th>Revenue</Th></tr>
                </thead>
                <tbody>
                  {dashboard.sourceToRevenue.map((r) => (
                    <Tr key={r.source}>
                      <Td><Badge tone="blue">{r.source}</Badge></Td>
                      <Td>{r.leads}</Td>
                      <Td>{r.qualified}</Td>
                      <Td>{r.booked}</Td>
                      <Td>{r.calls}</Td>
                      <Td>{r.booking_conversion}%</Td>
                      <Td className="font-semibold text-emerald-700">{formatCurrency(r.revenue)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Ad Spend"
              subtitle={dashboard.adSpend.connected ? `Real, synced campaign data — last synced ${dashboard.adSpend.lastSyncedAt ? formatDateTime(dashboard.adSpend.lastSyncedAt) : 'never'}` : undefined}
            />
            {!dashboard.adSpend.connected ? (
              <EmptyState
                title="No ad platform connected"
                description="Connect your real Google Ads or Meta Ads account from the Integrations page to see real spend, clicks, and ROAS here."
                action={<a href="/integrations"><Button variant="secondary">Go to Integrations</Button></a>}
              />
            ) : dashboard.adSpend.campaigns.length === 0 ? (
              <EmptyState title="No campaign data synced yet" description="Click Sync on the Google Ads Campaigns or Meta Ads Campaigns card in Integrations." />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
                  <div className="rounded-lg border border-ink-100 p-3"><p className="text-xs text-ink-400">Total spend</p><p className="text-lg font-bold text-ink-900">{formatCurrency(dashboard.adSpend.totalSpend)}</p></div>
                  <div className="rounded-lg border border-ink-100 p-3"><p className="text-xs text-ink-400">Conversions</p><p className="text-lg font-bold text-ink-900">{dashboard.adSpend.totalConversions}</p></div>
                  <div className="rounded-lg border border-ink-100 p-3"><p className="text-xs text-ink-400">Campaigns</p><p className="text-lg font-bold text-ink-900">{dashboard.adSpend.campaigns.length}</p></div>
                </div>
                <Table>
                  <thead>
                    <tr><Th>Platform</Th><Th>Campaign</Th><Th>Status</Th><Th>Spend</Th><Th>Clicks</Th><Th>Impressions</Th><Th>Conversions</Th><Th>Matched Revenue</Th><Th>ROAS</Th></tr>
                  </thead>
                  <tbody>
                    {dashboard.adSpend.campaigns.map((c) => (
                      <Tr key={c.campaignId}>
                        {/* channelType is the real distinguisher between the two ad platforms here -- Google's are real values like SEARCH/DISPLAY/VIDEO, Meta's is the fixed 'META' value set at sync time (see metaAdsCampaignMetric.model.js) */}
                        <Td><Badge tone={c.channelType === 'META' ? 'blue' : 'gray'}>{c.channelType === 'META' ? 'Meta' : 'Google'}</Badge></Td>
                        <Td className="font-medium">{c.campaignName}</Td>
                        <Td><Badge tone={c.status === 'ENABLED' ? 'green' : 'gray'}>{c.status ?? '—'}</Badge></Td>
                        <Td>{formatCurrency(c.spend)}</Td>
                        <Td>{c.clicks}</Td>
                        <Td>{formatCompact(c.impressions)}</Td>
                        <Td>{c.conversions}</Td>
                        <Td>{c.matchedRevenue !== null ? formatCurrency(c.matchedRevenue) : <span className="text-ink-400">Unmatched</span>}</Td>
                        <Td className={c.roas !== null && c.roas >= 1 ? 'font-semibold text-emerald-700' : ''}>{c.roas !== null ? `${c.roas}x` : '—'}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader title="Recent Tracking Events" subtitle="Native vs provider attribution" />
            {dashboard.recentEvents.length === 0 ? (
              <EmptyState title="No events recorded yet" />
            ) : (
              <Table>
                <thead>
                  <tr><Th>Event</Th><Th>Lead</Th><Th>Source</Th><Th>Campaign</Th><Th>Provider</Th><Th>Time</Th></tr>
                </thead>
                <tbody>
                  {dashboard.recentEvents.map((e) => (
                    <Tr key={e._id}>
                      <Td><StatusBadge status={e.event_type} /></Td>
                      <Td>{e.lead_id?.name ?? '—'}</Td>
                      <Td>{e.source ?? 'Direct'}</Td>
                      <Td>{e.campaign || '—'}</Td>
                      <Td className="text-xs">{e.provider_name || '—'}</Td>
                      <Td className="text-ink-500">{formatDateTime(e.created_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}