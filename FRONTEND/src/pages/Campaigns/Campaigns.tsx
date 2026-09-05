import { useState } from 'react';
import { Plus, Megaphone, Copy, Link2, Download } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Badge, StatusBadge, Table, Th, Td, Tr, Modal, Field, Input, Select, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { BarChartCard } from '@/components/charts';
import { formatCurrency, formatCurrencyCompact } from '@/utils/formatters';
import { exportToCSV } from '@/utils/csvExport';
import { toast } from '@/store/toastStore';
import { useCampaigns } from '@/hooks/useCampaigns';
import { usePermissions } from '@/hooks/usePermissions';
import { campaignsApi } from '@/lib/campaignsApi';
import { ApiError } from '@/lib/apiClient';
import { CAMPAIGN_SOURCE_VALUES, CAMPAIGN_TYPE_VALUES, CAMPAIGN_MEDIUM_VALUES } from '@/types/campaign';
import type { CampaignSource, CampaignType, CampaignMedium } from '@/types/campaign';

/**
 * SCOPE NOTE: this page is deliberately create + read only, matching
 * MASTER_SPEC.md B11 / DEVELOPER_HANDOFF.md's action table exactly --
 * exactly one write action is named for this module: createMarketingCampaign.
 * No edit, delete, or regenerate-link UI exists here on purpose; the
 * backend routes for those were removed to match.
 */
export function Campaigns() {
  const permissions = usePermissions();
  const { campaigns, kpis, chartData, loading, error, refetch, createCampaign } = useCampaigns({ limit: 100 });

  const [show, setShow] = useState(false);

  const exportCsv = async () => {
    try {
      const rows = await campaignsApi.exportData();
      exportToCSV('campaigns', rows);
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const copyLink = (link: string | null) => {
    if (!link) return toast.error('No tracking link yet');
    navigator.clipboard?.writeText(link);
    toast.success('Tracking link copied', 'UTM-tagged capture URL ready to share');
  };

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Manage marketing campaigns, generate UTM tracking links & measure ROI."
        breadcrumb={['Growth', 'Campaigns']}
        actions={
          <>
            <Button variant="secondary" onClick={() => void exportCsv()}><Download size={16} /> Export</Button>
            {permissions.campaigns.canCreate && (
              <Button onClick={() => setShow(true)}><Plus size={16} /> New Campaign</Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Campaigns" value={kpis?.totalCampaigns ?? '—'} icon={<Megaphone size={18} />} accent="#6366f1" />
        <KpiCard label="Total spend" value={kpis ? formatCurrencyCompact(kpis.totalSpend) : '—'} icon={<Megaphone size={18} />} accent="#f59e0b" />
        <KpiCard label="Total revenue" value={kpis ? formatCurrencyCompact(kpis.totalRevenue) : '—'} icon={<Megaphone size={18} />} accent="#10b981" />
        <KpiCard label="Blended ROAS" value={kpis ? `${kpis.blendedRoas}x` : '—'} icon={<Megaphone size={18} />} accent="#8b5cf6" />
      </div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}

      <div className="mb-4">
        <BarChartCard
          title="Revenue by Campaign"
          color="#10b981"
          data={chartData.map((c) => ({ name: c.campaign_name.slice(0, 12), value: c.revenue }))}
        />
      </div>

      <Card>
        <CardHeader title="All Campaigns" subtitle="Click the link icon to copy a UTM tracking URL" />
        {loading && campaigns.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-400">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet" description="Create your first marketing campaign to generate a trackable UTM link." />
        ) : (
          <Table>
            <thead>
              <tr><Th>Campaign</Th><Th>Source</Th><Th>Type</Th><Th>Status</Th><Th>Budget</Th><Th>Leads</Th><Th>Bookings</Th><Th>Revenue</Th><Th>Link</Th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <Tr key={c._id}>
                  <Td className="font-medium">{c.campaign_name}</Td>
                  <Td><Badge tone="blue">{c.source}</Badge></Td>
                  <Td>{c.campaign_type}</Td>
                  <Td><StatusBadge status={c.status} /></Td>
                  <Td>{formatCurrency(c.budget)}</Td>
                  <Td>{c.leads_generated}</Td>
                  <Td>{c.bookings}</Td>
                  <Td className="font-semibold text-emerald-700">{formatCurrency(c.revenue)}</Td>
                  <Td>
                    <button onClick={() => copyLink(c.utm_tracking_link)} className="rounded p-1.5 text-ink-400 hover:bg-brand-50 hover:text-brand-600" title="Copy tracking link">
                      <Link2 size={15} />
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {show && (
        <NewCampaignModal
          onClose={() => setShow(false)}
          onCreated={() => { refetch(); setShow(false); }}
          createCampaign={createCampaign}
        />
      )}
    </div>
  );
}

function NewCampaignModal({ onClose, onCreated, createCampaign }: {
  onClose: () => void;
  onCreated: () => void;
  createCampaign: ReturnType<typeof useCampaigns>['createCampaign'];
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<CampaignSource>('Meta Ads');
  const [campaignType, setCampaignType] = useState<CampaignType>('Paid Ads');
  const [medium, setMedium] = useState<CampaignMedium>('paid');
  const [budget, setBudget] = useState(5000);
  const [saving, setSaving] = useState(false);

  const normalizedName = name.trim().replace(/\s+/g, '_').toLowerCase();

  const submit = async () => {
    if (!normalizedName) return toast.error('Campaign name required');
    setSaving(true);
    try {
      const campaign = await createCampaign({
        campaign_name: normalizedName,
        source,
        campaign_type: campaignType,
        medium,
        budget: Number(budget),
      });
      toast.success('Campaign created', campaign.campaign_name);
      onCreated();
    } catch (err) {
      toast.error('Could not create campaign', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New Campaign"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Creating…' : 'Create campaign'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Campaign name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. summer_webinar" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <Select value={source} onChange={(e) => setSource(e.target.value as CampaignSource)}>
              {CAMPAIGN_SOURCE_VALUES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={campaignType} onChange={(e) => setCampaignType(e.target.value as CampaignType)}>
              {CAMPAIGN_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Medium">
            <Select value={medium} onChange={(e) => setMedium(e.target.value as CampaignMedium)}>
              {CAMPAIGN_MEDIUM_VALUES.map((m) => <option key={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Budget (USD)"><Input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></Field>
        </div>
        {normalizedName && (
          <div className="rounded-lg bg-ink-50 p-3">
            <p className="label flex items-center gap-1"><Copy size={12} /> Campaign will be created as</p>
            <p className="break-all font-mono text-xs text-brand-600">{normalizedName}</p>
            <p className="mt-1 text-[11px] text-ink-400">The UTM tracking link is generated once by the server, at creation.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}