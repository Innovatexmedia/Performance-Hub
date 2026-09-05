import { useEffect, useState } from 'react';
import { Plus, CreditCard, CheckCircle2, Copy, Download } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, StatusBadge, Table, Th, Td, Tr, Modal, Field, Input, Select, Avatar, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { DonutChartCard } from '@/components/charts';
import { formatCurrency, formatCurrencyCompact, formatDate } from '@/utils/formatters';
import { exportToCSV } from '@/utils/csvExport';
import { toast } from '@/store/toastStore';
import { usePayments } from '@/hooks/usePayments';
import { usePermissions } from '@/hooks/usePermissions';
import { paymentsApi } from '@/lib/paymentsApi';
import { leadsApi } from '@/lib/leadsApi';
import { ApiError } from '@/lib/apiClient';
import { PAYMENT_METHOD_VALUES } from '@/types/payment';
import type { PaymentMethod } from '@/types/payment';
import type { LeadListItem } from '@/types/lead';

export function Payments() {
  const permissions = usePermissions();
  const { payments, kpis, statusBreakdown, loading, error, refetch, createPayment, markPaid, refund } = usePayments({ limit: 100 });

  const [show, setShow] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const exportCsv = async () => {
    try {
      const rows = await paymentsApi.exportData();
      exportToCSV('payments', rows);
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const copyLink = (link: string | null) => {
    if (!link) return toast.error('No payment link yet');
    navigator.clipboard?.writeText(link);
    toast.success('Payment link copied');
  };

  const handleMarkPaid = async (id: string) => {
    setBusyId(id);
    try {
      await markPaid(id);
      toast.success('Payment marked as Paid', 'Deal closed Won. Lead status updated to Won.');
    } catch (err) {
      toast.error('Could not mark as paid', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRefund = async (id: string) => {
    setBusyId(id);
    try {
      await refund(id);
      toast.success('Payment refunded');
    } catch (err) {
      toast.error('Could not refund payment', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Track payment links — marking paid auto-closes the deal & updates revenue."
        breadcrumb={['Growth', 'Payments']}
        actions={
          <>
            <Button variant="secondary" onClick={() => void exportCsv()}><Download size={16} /> Export</Button>
            {permissions.payments.canCreate && (
              <Button onClick={() => setShow(true)}><Plus size={16} /> New Payment</Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue collected" value={kpis ? formatCurrencyCompact(kpis.revenueCollected) : '—'} icon={<CheckCircle2 size={18} />} accent="#10b981" />
        <KpiCard label="Outstanding" value={kpis ? formatCurrencyCompact(kpis.outstanding) : '—'} icon={<CreditCard size={18} />} accent="#f59e0b" />
        <KpiCard label="Paid" value={kpis?.paidCount ?? '—'} icon={<CheckCircle2 size={18} />} accent="#10b981" />
        <KpiCard label="Pending" value={kpis?.pendingCount ?? '—'} icon={<CreditCard size={18} />} accent="#ef4444" />
      </div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}

      <div className="grid gap-4 lg:grid-cols-3">
        <DonutChartCard
          title="Payments by Status"
          data={statusBreakdown.map((s) => ({ name: s.status, value: s.count }))}
        />
        <Card className="lg:col-span-2">
          <CardHeader title="All Payments" />
          {loading && payments.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-400">Loading payments…</p>
          ) : payments.length === 0 ? (
            <EmptyState title="No payments yet" description="Create a payment link to get started." />
          ) : (
            <Table>
              <thead>
                <tr><Th>Lead</Th><Th>Amount</Th><Th>Method</Th><Th>Status</Th><Th>Date</Th><Th>Actions</Th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <Tr key={p._id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Avatar name={p.lead_id?.name ?? '?'} size={28} color="#10b981" />
                        <span className="font-medium">{p.lead_id?.name ?? 'Unknown lead'}</span>
                      </div>
                    </Td>
                    <Td className="font-semibold">{formatCurrency(p.amount, p.currency)}</Td>
                    <Td>{p.payment_method}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                    <Td className="text-ink-500">{p.payment_date ? formatDate(p.payment_date) : '—'}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => copyLink(p.payment_link)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100" title="Copy link">
                          <Copy size={14} />
                        </button>
                        {permissions.payments.canMarkPaid && p.status !== 'Paid' && p.status !== 'Refunded' && (
                          <Button className="px-2.5 py-1 text-xs" disabled={busyId === p._id} onClick={() => void handleMarkPaid(p._id)}>
                            {busyId === p._id ? 'Marking…' : 'Mark paid'}
                          </Button>
                        )}
                        {permissions.payments.canRefund && p.status === 'Paid' && (
                          <Button variant="ghost" className="px-2.5 py-1 text-xs" disabled={busyId === p._id} onClick={() => void handleRefund(p._id)}>
                            {busyId === p._id ? 'Refunding…' : 'Refund'}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {show && (
        <NewPaymentModal
          onClose={() => setShow(false)}
          onCreated={() => { refetch(); setShow(false); }}
          createPayment={createPayment}
        />
      )}
    </div>
  );
}

function NewPaymentModal({ onClose, onCreated, createPayment }: {
  onClose: () => void;
  onCreated: () => void;
  createPayment: ReturnType<typeof usePayments>['createPayment'];
}) {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [leadId, setLeadId] = useState('');
  const [amount, setAmount] = useState(5000);
  const [method, setMethod] = useState<PaymentMethod>('Card');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    leadsApi.list({ limit: 100 }).then((r) => {
      if (cancelled) return;
      setLeads(r.data);
      if (r.data[0]) setLeadId(r.data[0].id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    if (!leadId) return toast.error('Select a lead');
    setSaving(true);
    try {
      await createPayment({ lead_id: leadId, amount: Number(amount), payment_method: method });
      toast.success('Payment link created');
      onCreated();
    } catch (err) {
      toast.error('Could not create payment', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New Payment Link"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !leadId}>{saving ? 'Creating…' : 'Create payment'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Lead">
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.company}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (USD)"><Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHOD_VALUES.map((m) => <option key={m}>{m}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}