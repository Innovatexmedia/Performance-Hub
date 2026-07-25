import { useState } from 'react';
import { Plus, Zap, Play, Activity } from 'lucide-react';
import { PageHeader, Card, Button, Badge, Toggle, Modal, Field, Input, Select, EmptyState } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { timeAgo } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useAutomations } from '@/hooks/useAutomations';
import { usePermissions } from '@/hooks/usePermissions';
import { ApiError } from '@/lib/apiClient';
import { TRIGGER_TYPE_VALUES, ACTION_TYPE_VALUES, ACTION_TYPE_LABELS, CONDITION_OPERATOR_VALUES } from '@/types/automation';
import type { Automation, TriggerType, ActionType, ConditionOperator } from '@/types/automation';

/**
 * Automations -- real data. Confirmed spec-aligned against 3 independent
 * spec documents (DEVELOPER_HANDOFF's action table, MASTER_SPEC B14,
 * FRONTEND_SPEC section 15, the last cited directly in the backend's own
 * constants file). Trimmed the backend's extra update/delete endpoints to
 * match -- same fix already applied to Campaigns. Only 3 write actions
 * exist here: create, toggle, simulate.
 */
export function Automations() {
  const permissions = usePermissions();
  const { automations, kpis, loading, error, createAutomation, toggleAutomation, simulateAutomation } = useAutomations({ limit: 100 });

  const [show, setShow] = useState(false);
  const [detail, setDetail] = useState<Automation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleToggle = async (a: Automation) => {
    setBusyId(a.id);
    try {
      await toggleAutomation(a.id);
      toast.success(a.status === 'active' ? 'Automation paused' : 'Automation activated');
    } catch (err) {
      toast.error('Could not toggle automation', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSimulate = async (a: Automation) => {
    setBusyId(a.id);
    try {
      const result = await simulateAutomation(a.id);
      if (result.conditionPassed) {
        toast.success(result.result.success ? 'Simulation ran successfully' : 'Simulation ran, action failed', result.result.message);
      } else {
        toast.error('Condition not met', 'Action was skipped in this simulation');
      }
    } catch (err) {
      toast.error('Could not simulate run', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Automations"
        description="Rule-based workflows: when a trigger fires, run an action automatically."
        breadcrumb={['Growth', 'Automations']}
        actions={permissions.automations.canCreate ? <Button onClick={() => setShow(true)}><Plus size={16} /> New Automation</Button> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Automations" value={kpis?.total ?? '—'} icon={<Zap size={18} />} accent="#6366f1" />
        <KpiCard label="Active" value={kpis?.active ?? '—'} icon={<Play size={18} />} accent="#10b981" />
        <KpiCard label="Total runs" value={kpis?.totalRuns ?? '—'} icon={<Activity size={18} />} accent="#8b5cf6" />
        <KpiCard label="Inactive" value={kpis?.inactive ?? '—'} icon={<Zap size={18} />} accent="#f59e0b" />
      </div>

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}

      <div className="grid gap-3 lg:grid-cols-2">
        {loading && automations.length === 0 && <p className="p-8 text-center text-sm text-ink-400">Loading automations…</p>}
        {automations.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Zap size={18} /></span>
                <div>
                  <p className="font-semibold text-ink-900">{a.name}</p>
                  <p className="text-xs text-ink-500">Last run {a.last_run ? timeAgo(a.last_run) : 'never'} · {a.run_count} runs</p>
                </div>
              </div>
              <Toggle checked={a.status === 'active'} onChange={() => { if (permissions.automations.canToggle && busyId !== a.id) void handleToggle(a); }} />
            </div>
            <div className="mt-3 space-y-1.5 rounded-lg bg-ink-50 p-3 text-sm">
              <p><span className="font-semibold text-ink-500">WHEN</span> {a.trigger.type}</p>
              <p><span className="font-semibold text-ink-500">IF</span> {a.condition?.field ? `${a.condition.field} ${a.condition.operator} ${a.condition.value}` : 'always'}</p>
              <p><span className="font-semibold text-ink-500">THEN</span> {ACTION_TYPE_LABELS[a.action.type]}</p>
            </div>
            <div className="mt-3 flex gap-2">
              {permissions.automations.canSimulate && (
                <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busyId === a.id} onClick={() => void handleSimulate(a)}>
                  <Play size={13} /> {busyId === a.id ? 'Simulating…' : 'Simulate run'}
                </Button>
              )}
              <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setDetail(a)}>View logs</Button>
            </div>
          </Card>
        ))}
        {!loading && automations.length === 0 && <EmptyState title="No automations yet" />}
      </div>

      {show && <NewAutomationModal onClose={() => setShow(false)} createAutomation={createAutomation} />}

      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`Logs — ${detail.name}`}>
          <div className="space-y-2">
            {detail.logs.length === 0 && <p className="text-sm text-ink-400">No runs logged yet.</p>}
            {detail.logs.slice().reverse().map((l, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm">
                <span className="text-ink-700">{l.result}</span>
                <div className="flex items-center gap-1.5">
                  <Badge tone={l.success ? 'green' : 'red'}>{l.success ? 'Success' : 'Failed'}</Badge>
                  <Badge tone="gray">{timeAgo(l.at)}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewAutomationModal({ onClose, createAutomation }: {
  onClose: () => void;
  createAutomation: ReturnType<typeof useAutomations>['createAutomation'];
}) {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>(TRIGGER_TYPE_VALUES[0]);
  const [actionType, setActionType] = useState<ActionType>(ACTION_TYPE_VALUES[0]);
  const [conditionField, setConditionField] = useState('');
  const [conditionOperator, setConditionOperator] = useState<ConditionOperator | ''>('');
  const [conditionValue, setConditionValue] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error('Name required');
    setSaving(true);
    try {
      await createAutomation({
        name,
        trigger: { type: triggerType },
        action: { type: actionType },
        condition: conditionField && conditionOperator ? { field: conditionField, operator: conditionOperator, value: conditionValue } : undefined,
      });
      toast.success('Automation created');
      onClose();
    } catch (err) {
      toast.error('Could not create automation', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title="New Automation"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button></>}
    >
      <div className="space-y-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auto-assign hot leads" /></Field>
        <Field label="Trigger (WHEN)">
          <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>
            {TRIGGER_TYPE_VALUES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Condition field (optional)"><Input value={conditionField} onChange={(e) => setConditionField(e.target.value)} placeholder="e.g. lead.qualification_score" /></Field>
          <Field label="Operator">
            <Select value={conditionOperator} onChange={(e) => setConditionOperator(e.target.value as ConditionOperator)}>
              <option value="">—</option>
              {CONDITION_OPERATOR_VALUES.map((o) => <option key={o}>{o}</option>)}
            </Select>
          </Field>
          <Field label="Value"><Input value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} placeholder="e.g. 7" /></Field>
        </div>
        <Field label="Action (THEN)">
          <Select value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)}>
            {ACTION_TYPE_VALUES.map((a) => <option key={a} value={a}>{ACTION_TYPE_LABELS[a]}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
