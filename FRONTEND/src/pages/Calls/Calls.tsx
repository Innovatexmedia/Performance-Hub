import { useEffect, useMemo, useState } from 'react';
import { Plus, Sparkles, Phone, FileText, Copy, ChevronLeft, ChevronRight, RefreshCw, Pencil } from 'lucide-react';
import {
  PageHeader, Card, Button, Badge, StatusBadge, Modal, Field, Select, Input,
  Textarea, Avatar, EmptyState,
} from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { formatDate } from '@/utils/formatters';
import { toast } from '@/store/toastStore';
import { useCalls } from '@/hooks/useCalls';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { usePermissions } from '@/hooks/usePermissions';
import { leadsApi } from '@/lib/leadsApi';
import { ApiError } from '@/lib/apiClient';
import { CALL_OUTCOME_VALUES } from '@/types/call';
import type { Call, CallOutcome, CallUpdateInput } from '@/types/call';
import type { LeadListItem } from '@/types/lead';

export function Calls() {
  const permissions = usePermissions();
  const { nameById } = useTeamMembers();
  const [page, setPage] = useState(1);
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');

  const query = useMemo(() => ({
    outcome: outcomeFilter === 'all' ? undefined : (outcomeFilter as CallOutcome),
    page,
    limit: 20,
  }), [outcomeFilter, page]);

  const { calls, pagination, kpis, loading, error, refetch, createCall, updateCall, regenerateAiSummary } = useCalls(query);

  useEffect(() => setPage(1), [outcomeFilter]);

  const [showLog, setShowLog] = useState(false);
  const [detail, setDetail] = useState<Call | null>(null);
  const [editing, setEditing] = useState<Call | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const handleRegenerate = async () => {
    if (!detail) return;
    setRegenerating(true);
    try {
      const updated = await regenerateAiSummary(detail._id);
      setDetail(updated);
      toast.success('AI summary regenerated');
    } catch (err) {
      toast.error('Could not regenerate summary', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Call Intelligence"
        description="Log calls, generate AI summaries, extract objections & draft follow-ups."
        breadcrumb={['Revenue', 'Call Intelligence']}
        actions={
          <>
            <Select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} className="w-auto">
              <option value="all">All outcomes</option>
              {CALL_OUTCOME_VALUES.map((o) => <option key={o}>{o}</option>)}
            </Select>
            {permissions.calls.canCreate && (
              <Button onClick={() => setShowLog(true)}><Plus size={16} /> Log Call</Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total calls" value={kpis?.total ?? '—'} icon={<Phone size={18} />} accent="#6366f1" />
        <KpiCard label="Proposals requested" value={kpis?.proposalsRequested ?? '—'} icon={<FileText size={18} />} accent="#f59e0b" />
        <KpiCard label="Closed won" value={kpis?.closedWon ?? '—'} icon={<Phone size={18} />} accent="#10b981" />
        <KpiCard label="Avg call score" value={kpis?.avgCallScore ?? '—'} icon={<Sparkles size={18} />} accent="#8b5cf6" />
      </div>

      {error ? (
        <EmptyState title="Couldn't load calls" description={error} />
      ) : loading && calls.length === 0 ? (
        <p className="p-8 text-center text-sm text-ink-400">Loading calls…</p>
      ) : calls.length === 0 ? (
        <EmptyState title="No calls logged" />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {calls.map((c) => (
              <Card key={c._id} className="cursor-pointer p-4 transition hover:shadow-soft">
                <div onClick={() => setDetail(c)}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.lead_id?.name ?? '?'} size={36} color="#06b6d4" />
                      <div>
                        <p className="font-semibold text-ink-900">{c.lead_id?.name ?? 'Unknown lead'}</p>
                        <p className="text-xs text-ink-500">{formatDate(c.call_date)} · {c.duration_minutes}min · {nameById(c.assigned_user_id)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={c.outcome} />
                      <Badge tone="violet">Score {c.score}/10</Badge>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-ink-600">{c.summary || 'No summary available.'}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.objections.slice(0, 3).map((o, i) => <Badge key={i} tone="amber">{o}</Badge>)}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-ink-100 bg-white px-4 py-3">
              <p className="text-xs text-ink-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} total</p>
              <div className="flex gap-1.5">
                <Button variant="secondary" disabled={!pagination.hasPrev} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /> Prev</Button>
                <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={15} /></Button>
              </div>
            </div>
          )}
        </>
      )}

      {showLog && (
        <LogCallModal
          onClose={() => setShowLog(false)}
          onCreated={(call) => { refetch(); setShowLog(false); setDetail(call); }}
          createCall={createCall}
        />
      )}

      {editing && (
        <EditCallModal
          call={editing}
          onClose={() => setEditing(null)}
          onSaved={(call) => { refetch(); setEditing(null); setDetail(call); }}
          updateCall={updateCall}
        />
      )}

      {detail && (
        <Modal open onClose={() => setDetail(null)} title="Call Detail" size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Outcome" value={detail.outcome} />
              <MiniStat label="Score" value={`${detail.score}/10`} />
              <MiniStat label="Duration" value={`${detail.duration_minutes}min`} />
            </div>

            <div className="flex items-center justify-between">
              <p className="label">AI Summary</p>
              <div className="flex items-center gap-3">
                {permissions.calls.canUpdate && (
                  <button
                    onClick={() => setEditing(detail)}
                    className="flex items-center gap-1 text-xs font-medium text-ink-600 hover:text-ink-800"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                )}
                {permissions.calls.canRegenerateAiSummary && (
                  <button
                    onClick={() => void handleRegenerate()}
                    disabled={regenerating}
                    className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} /> {regenerating ? 'Regenerating…' : 'Regenerate'}
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm text-ink-700">{detail.summary || 'No summary generated yet.'}</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="label">Objections</p>
                {detail.objections.length > 0 ? (
                  detail.objections.map((o, i) => <Badge key={i} tone="amber" className="mb-1 mr-1">{o}</Badge>)
                ) : <p className="text-xs text-ink-400">None extracted.</p>}
              </div>
              <div>
                <p className="label">Next steps</p>
                {detail.next_steps.length > 0 ? (
                  <ul className="text-sm text-ink-700">{detail.next_steps.map((o, i) => <li key={i}>• {o}</li>)}</ul>
                ) : <p className="text-xs text-ink-400">None generated.</p>}
              </div>
            </div>

            {detail.follow_up_draft && (
              <div>
                <p className="label">Follow-up draft</p>
                <p className="rounded-lg bg-ink-50 p-2.5 text-sm text-ink-700">{detail.follow_up_draft}</p>
              </div>
            )}

            <div>
              <p className="label">Transcript</p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-line rounded-lg bg-ink-50 p-3 text-sm text-ink-600">
                {detail.transcript || 'No transcript recorded.'}
              </p>
            </div>

            {detail.proposal_outline && (
              <Button
                variant="secondary"
                onClick={() => { navigator.clipboard?.writeText(detail.proposal_outline); toast.success('Proposal outline copied'); }}
              >
                <Copy size={14} /> Copy proposal outline
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-100 p-3 text-center">
      <p className="text-[11px] text-ink-400">{label}</p>
      <p className="text-sm font-semibold text-ink-900">{value}</p>
    </div>
  );
}

/**
 * EditCallModal -- real PATCH /api/calls/:id (call.controller.js's
 * updateCall / call.validator.js's validateUpdateCall). This existed
 * fully on the backend for manual corrections after logging a call, but
 * had no UI entry point at all -- this wires it up. Deliberately keeps
 * to the exact fields the validator accepts (outcome, call_date,
 * duration_minutes, transcript, summary, score) rather than exposing
 * the AI-generated arrays (objections/next_steps/follow_up_draft),
 * which aren't part of the update contract and are better corrected via
 * Regenerate against an edited transcript instead.
 */
function EditCallModal({ call, onClose, onSaved, updateCall }: {
  call: Call;
  onClose: () => void;
  onSaved: (call: Call) => void;
  updateCall: ReturnType<typeof useCalls>['updateCall'];
}) {
  const [outcome, setOutcome] = useState<CallOutcome>(call.outcome);
  const [callDate, setCallDate] = useState(call.call_date);
  const [durationMinutes, setDurationMinutes] = useState(call.duration_minutes);
  const [transcript, setTranscript] = useState(call.transcript);
  const [summary, setSummary] = useState(call.summary);
  const [score, setScore] = useState(call.score);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const patch: CallUpdateInput = {
        outcome, call_date: callDate, duration_minutes: durationMinutes, transcript, summary, score,
      };
      const updated = await updateCall(call._id, patch);
      toast.success('Call updated');
      onSaved(updated);
    } catch (err) {
      toast.error('Could not update call', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Call"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Outcome">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              {CALL_OUTCOME_VALUES.map((o) => <option key={o}>{o}</option>)}
            </Select>
          </Field>
          <Field label="Call date"><Input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} /></Field>
          <Field label="Duration (min)"><Input type="number" min={0} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} /></Field>
        </div>
        <Field label="Score (0-10)">
          <Input type="number" min={0} max={10} value={score} onChange={(e) => setScore(Number(e.target.value))} />
        </Field>
        <Field label="Summary">
          <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field label="Transcript">
          <Textarea rows={6} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
        </Field>
        <p className="text-xs text-ink-400">To regenerate objections, next steps, and the follow-up draft from an edited transcript, save here first, then use Regenerate in the call detail view.</p>
      </div>
    </Modal>
  );
}

/**
 * LogCallModal -- unlike the old mock version, there is NO client-side
 * "preview AI summary" step. The backend generates the full AI result
 * (summary/objections/next_steps/follow_up_draft/proposal_outline/score)
 * SYNCHRONOUSLY inside POST /api/calls -- it comes back already attached
 * to the created call. Saving IS the "generate" action; the result is
 * revealed by opening the Call Detail view immediately after.
 */
function LogCallModal({ onClose, onCreated, createCall }: {
  onClose: () => void;
  onCreated: (call: Call) => void;
  createCall: ReturnType<typeof useCalls>['createCall'];
}) {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [leadId, setLeadId] = useState('');
  const [outcome, setOutcome] = useState<CallOutcome>('Interested');
  const [callDate, setCallDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [transcript, setTranscript] = useState('');
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
      const call = await createCall({
        lead_id: leadId,
        outcome,
        call_date: callDate,
        duration_minutes: durationMinutes,
        transcript,
      });
      toast.success('Call logged', 'AI summary generated');
      onCreated(call);
    } catch (err) {
      toast.error('Could not log call', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Log Call & Generate AI Summary"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !leadId}>{saving ? 'Saving & generating…' : 'Save call'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lead">
            <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Outcome">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              {CALL_OUTCOME_VALUES.map((o) => <option key={o}>{o}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Call date"><Input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} /></Field>
          <Field label="Duration (min)"><Input type="number" min={0} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} /></Field>
        </div>
        <Field label="Transcript">
          <Textarea rows={6} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Paste or type the call transcript…" />
        </Field>
        <p className="flex items-center gap-1.5 text-xs text-ink-400">
          <Sparkles size={13} /> AI summary, objections, next steps and score are generated automatically when you save.
        </p>
      </div>
    </Modal>
  );
}
