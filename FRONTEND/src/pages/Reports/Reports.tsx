import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Tabs, Table, Th, Td, Tr, Badge, Select, StatusBadge, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { BarChartCard, DonutChartCard, LineChartCard } from '@/components/charts';
import { exportToCSV } from '@/utils/csvExport';
import { formatCurrency, formatCurrencyCompact } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useReport } from '@/hooks/useReport';
import { reportsApi } from '@/lib/reportsApi';
import { ApiError } from '@/lib/apiClient';
import { REPORT_TABS } from '@/types/report';
import type {
  ReportTab, ReportFilter, LeadReport, PipelineReport, AttributionReport, WhatsAppReport,
  CampaignReport, RevenueReport, SalesActivityReport, NurtureReport, AiQualificationReport,
} from '@/types/report';

const SOURCES = ['Meta Ads', 'Google Ads', 'LinkedIn', 'Webinar', 'Referral', 'Organic', 'Cold Outreach', 'YouTube', 'Direct'];

export function Reports() {
  const [tab, setTab] = useState<ReportTab>('lead');
  const [rangeDays, setRangeDays] = useState('30');
  const [source, setSource] = useState('all');

  const filter: ReportFilter = useMemo(() => {
    const days = Number(rangeDays);
    const dateTo = new Date();
    const dateFrom = new Date(Date.now() - days * 86400000);
    return {
      date_from: dateFrom.toISOString().slice(0, 10),
      date_to: dateTo.toISOString().slice(0, 10),
      source: source === 'all' ? undefined : source,
    };
  }, [rangeDays, source]);

  const { data, loading, error } = useReport<unknown>(tab, filter);

  const exportCsv = async () => {
    try {
      const rows = await reportsApi.exportData(tab, filter);
      exportToCSV(`${tab}_report`, rows);
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Operator-grade reporting across every revenue surface."
        breadcrumb={['Growth', 'Reports']}
        actions={
          <>
            <Select value={rangeDays} onChange={(e) => setRangeDays(e.target.value)} className="w-auto">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
            <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
              <option value="all">All sources</option>
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </>
        }
      />

      <div className="mb-4"><Tabs tabs={REPORT_TABS.map((t) => ({ id: t.id, label: t.label }))} active={tab} onChange={(id) => setTab(id as ReportTab)} /></div>

      <div className="mb-3 flex justify-end">
        <Button variant="secondary" onClick={() => void exportCsv()}><Download size={16} /> Export CSV</Button>
      </div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}
      {loading && <p className="p-8 text-center text-sm text-ink-400">Loading {tab} report…</p>}

      {!loading && !error && data !== null && (
        <>
          {tab === 'lead' && <LeadReportView data={data as LeadReport} />}
          {tab === 'pipeline' && <PipelineReportView data={data as PipelineReport} />}
          {tab === 'attribution' && <AttributionReportView data={data as AttributionReport} />}
          {tab === 'whatsapp' && <WhatsAppReportView data={data as WhatsAppReport} />}
          {tab === 'campaign' && <CampaignReportView data={data as CampaignReport} />}
          {tab === 'revenue' && <RevenueReportView data={data as RevenueReport} />}
          {tab === 'sales-activity' && <SalesActivityReportView data={data as SalesActivityReport} />}
          {tab === 'nurture' && <NurtureReportView data={data as NurtureReport} />}
          {tab === 'ai-qualification' && <AiQualificationReportView data={data as AiQualificationReport} />}
        </>
      )}
    </div>
  );
}

function LeadReportView({ data }: { data: LeadReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total leads" value={data.kpis.totalLeads} icon={<span />} accent="#6366f1" />
        <KpiCard label="Hot" value={data.kpis.hotLeads} icon={<span />} accent="#ef4444" />
        <KpiCard label="Qualified" value={data.kpis.qualifiedLeads} icon={<span />} accent="#3b82f6" />
        <KpiCard label="Won" value={data.kpis.wonLeads} icon={<span />} accent="#10b981" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BarChartCard title="Leads by Status" data={data.charts.byStatus.map((s) => ({ name: s.status, value: s.count }))} />
        <DonutChartCard title="Leads by Temperature" data={data.charts.byTemperature.map((t) => ({ name: t.temperature, value: t.count }))} />
      </div>
      <Card>
        <CardHeader title="Lead Detail" />
        {data.table.rows.length === 0 ? <EmptyState title="No leads in this range" /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Status</Th><Th>Temp</Th><Th>Score</Th><Th>Source</Th></tr></thead>
            <tbody>
              {data.table.rows.map((l, i) => (
                <Tr key={i}>
                  <Td className="font-medium">{l.name}</Td>
                  <Td><StatusBadge status={l.status} /></Td>
                  <Td>{l.lead_temperature}</Td>
                  <Td>{l.qualification_score}</Td>
                  <Td>{l.source}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function PipelineReportView({ data }: { data: PipelineReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Open pipeline" value={formatCurrencyCompact(data.kpis.pipelineValue)} icon={<span />} accent="#6366f1" />
        <KpiCard label="Deals" value={data.kpis.totalDeals} icon={<span />} accent="#8b5cf6" />
        <KpiCard label="Won" value={data.kpis.wonDeals} icon={<span />} accent="#10b981" />
        <KpiCard label="Lost" value={data.kpis.lostDeals} icon={<span />} accent="#ef4444" />
      </div>
      <BarChartCard title="Pipeline by Stage" data={data.charts.byStage.map((s) => ({ name: s.stage, value: s.count }))} />
    </div>
  );
}

function AttributionReportView({ data }: { data: AttributionReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <DonutChartCard title="Leads by Source" data={data.leadsBySource.map((s) => ({ name: s.source, value: s.count }))} />
        <BarChartCard title="Revenue by Source" color="#10b981" data={data.revenueBySource.map((s) => ({ name: s.source, value: s.revenue }))} />
      </div>
      <Card>
        <CardHeader title="First vs Last Touch" subtitle="Source-to-revenue breakdown" />
        <Table>
          <thead><tr><Th>Source</Th><Th>Leads</Th><Th>Revenue</Th></tr></thead>
          <tbody>
            {data.sourceToRevenue.map((s) => (
              <Tr key={s.source}><Td>{s.source}</Td><Td>{s.leads}</Td><Td>{formatCurrency(s.revenue)}</Td></Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function WhatsAppReportView({ data }: { data: WhatsAppReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Conversations" value={data.kpis.totalConversations} icon={<span />} accent="#22c55e" />
        <KpiCard label="Messages" value={data.kpis.totalMessages} icon={<span />} accent="#6366f1" />
        <KpiCard label="Campaigns" value={data.kpis.campaigns} icon={<span />} accent="#8b5cf6" />
        <KpiCard label="WA Revenue" value={formatCurrencyCompact(data.kpis.revenue)} icon={<span />} accent="#10b981" />
      </div>
    </div>
  );
}

function CampaignReportView({ data }: { data: CampaignReport }) {
  return (
    <div className="space-y-4">
      <BarChartCard title="Revenue by Campaign" color="#10b981" data={data.table.rows.map((c) => ({ name: c.campaignName.slice(0, 12), value: c.revenue }))} />
      <Card>
        <CardHeader title="Campaign Performance" />
        <Table>
          <thead><tr><Th>Campaign</Th><Th>Spend</Th><Th>Leads</Th><Th>Bookings</Th><Th>Revenue</Th><Th>ROAS</Th></tr></thead>
          <tbody>
            {data.table.rows.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">{c.campaignName}</Td>
                <Td>{formatCurrency(c.spend)}</Td>
                <Td>{c.leadsGenerated}</Td>
                <Td>{c.bookings}</Td>
                <Td>{formatCurrency(c.revenue)}</Td>
                <Td><Badge tone="green">{c.roas}x</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function RevenueReportView({ data }: { data: RevenueReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue" value={formatCurrencyCompact(data.kpis.totalRevenue)} icon={<span />} accent="#10b981" />
        <KpiCard label="Avg deal" value={formatCurrencyCompact(data.kpis.avgPaymentSize)} icon={<span />} accent="#6366f1" />
        <KpiCard label="Outstanding" value={formatCurrencyCompact(data.kpis.pendingAmount)} icon={<span />} accent="#f59e0b" />
        <KpiCard label="Refunded" value={data.kpis.refundedCount} icon={<span />} accent="#ef4444" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineChartCard title="Revenue trend" data={data.charts.trend.map((t) => ({ name: t.date, value: t.amount }))} color="#10b981" area />
        <DonutChartCard title="Revenue by Method" data={data.charts.byMethod.map((m) => ({ name: m.method, value: m.amount }))} />
      </div>
    </div>
  );
}

function SalesActivityReportView({ data }: { data: SalesActivityReport }) {
  return (
    <div className="space-y-4">
      <BarChartCard title="Leads Assigned by Owner" color="#6366f1" data={data.table.rows.map((r) => ({ name: r.agentName.split(' ')[0], value: r.leadsAssigned }))} />
      <Card>
        <CardHeader title="Sales Activity by Rep" />
        {data.table.rows.length === 0 ? <EmptyState title="No agent activity in this range" /> : (
          <Table>
            <thead><tr><Th>Rep</Th><Th>Leads</Th><Th>Deals Won</Th><Th>Calls</Th><Th>Bookings</Th></tr></thead>
            <tbody>
              {data.table.rows.map((r) => (
                <Tr key={r.agentId}>
                  <Td className="font-medium">{r.agentName}</Td>
                  <Td>{r.leadsAssigned}</Td>
                  <Td>{r.dealsWon}</Td>
                  <Td>{r.calls}</Td>
                  <Td>{r.bookings}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function NurtureReportView({ data }: { data: NurtureReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active flows" value={data.kpis.activeFlows} icon={<span />} accent="#14b8a6" />
        <KpiCard label="Completed" value={data.kpis.completedFlows} icon={<span />} accent="#10b981" />
        <KpiCard label="Enrolled" value={data.kpis.contactsEnrolled} icon={<span />} accent="#6366f1" />
        <KpiCard label="Messages sent" value={data.kpis.messagesSent} icon={<span />} accent="#8b5cf6" />
      </div>
      <BarChartCard title="Enrollment Breakdown" color="#14b8a6" horizontal data={data.charts.enrollmentBreakdown} />
    </div>
  );
}

function AiQualificationReportView({ data }: { data: AiQualificationReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="AI qualifications" value={data.kpis.totalQualifications} icon={<span />} accent="#8b5cf6" />
        <KpiCard label="Avg score" value={data.kpis.avgFitScore.toFixed(1)} icon={<span />} accent="#6366f1" />
        <KpiCard label="Hot leads" value={data.kpis.hotLeads} icon={<span />} accent="#ef4444" />
        <KpiCard label="Conversion (hot)" value={`${data.kpis.hotConversionRate.toFixed(0)}%`} icon={<span />} accent="#10b981" />
      </div>
      <DonutChartCard title="Lead Score Distribution" data={data.charts.byTemperature.map((t) => ({ name: t.temperature, value: t.count }))} />
    </div>
  );
}