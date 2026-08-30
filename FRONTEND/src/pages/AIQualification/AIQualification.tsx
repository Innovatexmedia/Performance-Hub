import { useEffect, useState } from 'react';
import { Sparkles, RotateCcw, Send, Flame, CheckCircle2, PenLine } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Select, Badge, Avatar, Textarea, Input, EmptyState } from '@/components/ui';
import { toast } from '@/store/toastStore';
import { useQualification } from '@/hooks/useQualification';
import { usePermissions } from '@/hooks/usePermissions';
import { leadsApi } from '@/lib/leadsApi';
import { ApiError } from '@/lib/apiClient';
import { ROUTE_LABELS } from '@/types/qualification';
import type { Qualification } from '@/types/qualification';
import type { LeadListItem } from '@/types/lead';

export function AIQualification() {
  const permissions = usePermissions();
  const { questions, questionsLoading, run, apply, override } = useQualification();

  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [leadId, setLeadId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Qualification | null>(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [overrideValue, setOverrideValue] = useState('');
  const [overriding, setOverriding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Prefer a lead still early in the funnel, matching the old prototype's
    // intent -- someone already Won/Lost doesn't need discovery qualification.
    leadsApi.list({ limit: 100 }).then((r) => {
      if (cancelled) return;
      setLeads(r.data);
      const preferred = r.data.find((l) => ['New', 'Contacted'].includes(l.status)) ?? r.data[0];
      if (preferred) setLeadId(preferred.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const lead = leads.find((l) => l.id === leadId);

  const reset = () => { setAnswers({}); setResult(null); setOverrideValue(''); };

  const handleRun = async () => {
    if (!leadId) return toast.error('Select a lead');
    setRunning(true);
    try {
      const qualification = await run({ lead_id: leadId, answers });
      setResult(qualification);
      toast.success('AI qualification completed', qualification.is_ai_live ? 'Live AI' : 'Mock AI engine');
    } catch (err) {
      toast.error('Could not run qualification', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setRunning(false);
    }
  };

  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const { qualification, lead: updatedLead } = await apply(result._id);
      setResult(qualification);
      // Real refresh, not a page reload: the apply endpoint already
      // returns the fresh lead (qualification_score/lead_temperature/status
      // were just updated server-side by applyResult() in
      // qualification.service.js) -- merge those exact fields into the
      // already-loaded leads list so "current score X/10" reflects what's
      // actually in the database immediately, without waiting for the
      // next full page load or a separate refetch. Deterministic
      // lead-scoring and AI-scoring logic are untouched -- this only
      // updates what the UI displays from data the backend already sent.
      setLeads((prev) =>
        prev.map((l) =>
          l.id === updatedLead.id
            ? { ...l, qualification_score: updatedLead.qualification_score, lead_temperature: updatedLead.lead_temperature, status: updatedLead.status }
            : l
        )
      );
      toast.success('Applied to lead', 'Score, temperature and status updated.');
    } catch (err) {
      toast.error('Could not apply result', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setApplying(false);
    }
  };

  const handleOverride = async () => {
    if (!result) return;
    const score = Number(overrideValue);
    if (Number.isNaN(score) || score < 0 || score > 10) return toast.error('Enter a score between 0 and 10');
    setOverriding(true);
    try {
      const updated = await override(result._id, score);
      setResult(updated);
      toast.success('Score overridden', `${score}/10`);
    } catch (err) {
      toast.error('Could not override score', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setOverriding(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="AI Qualification"
        description="Run AI-powered discovery, score leads 1–10, and route them to booking, nurture or sales follow-up."
        breadcrumb={['Revenue', 'AI Qualification']}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Questionnaire */}
        <Card>
          <CardHeader
            title="Qualification Session"
            subtitle="Answer the discovery questions"
            action={<RotateCcw size={16} className="cursor-pointer text-ink-400 hover:text-ink-700" onClick={reset} />}
          />
          <div className="space-y-4 p-5">
            <div>
              <label className="label">Lead</label>
              <Select value={leadId} onChange={(e) => { setLeadId(e.target.value); reset(); }}>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.company} ({l.status})</option>)}
              </Select>
            </div>
            {lead && (
              <div className="flex items-center gap-2.5 rounded-lg bg-ink-50 p-3">
                <Avatar name={lead.name} color="#6366f1" size={36} />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{lead.name}</p>
                  <p className="text-xs text-ink-500">{lead.source} · current score {lead.qualification_score}/10</p>
                </div>
                <Badge tone={lead.lead_temperature === 'Hot' ? 'red' : lead.lead_temperature === 'Warm' ? 'amber' : 'gray'}>{lead.lead_temperature}</Badge>
              </div>
            )}

            {questionsLoading ? (
              <p className="text-sm text-ink-400">Loading discovery questions…</p>
            ) : questions.length === 0 ? (
              <p className="text-sm text-ink-400">No discovery questions configured yet (Settings → Qualification Questions).</p>
            ) : (
              questions.map((q) => (
                <div key={q}>
                  <label className="mb-1 block text-sm font-medium text-ink-700">{q}</label>
                  <Textarea rows={1} value={answers[q] ?? ''} onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })} placeholder="Type the prospect's answer…" />
                </div>
              ))
            )}

            {permissions.qualification.canRun && (
              <Button onClick={() => void handleRun()} className="w-full" disabled={running || !leadId}>
                <Sparkles size={16} /> {running ? 'Running…' : 'Run AI Qualification'}
              </Button>
            )}
          </div>
        </Card>

        {/* Result */}
        <Card>
          <CardHeader title="AI Assessment" subtitle="Fit score, intent & recommended next action" />
          <div className="p-5">
            {!result ? (
              <EmptyState title="No assessment yet" description="Fill in the discovery answers and run the AI qualification engine." icon={<Sparkles size={20} />} />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4 rounded-xl bg-gradient-to-r from-brand-600 to-violet-600 p-4 text-white">
                  <div className="text-center">
                    <p className="text-4xl font-bold">{result.override_score ?? result.fit_score}</p>
                    <p className="text-xs text-brand-100">/ 10 fit{result.override_score !== null ? ' (overridden)' : ''}</p>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Flame size={16} />
                      <span className="font-semibold">{result.temperature} · Grade {result.quality}</span>
                    </div>
                    <p className="mt-1 text-sm text-brand-50">{result.buying_intent} buying intent</p>
                  </div>
                  <Badge tone={result.is_ai_live ? 'green' : 'violet'}>{result.is_ai_live ? 'Live AI' : 'Mock AI'}</Badge>
                </div>

                <Detail label="Reasoning" value={result.reason} />
                <div className="grid grid-cols-2 gap-3">
                  <MiniDetail label="Urgency" value={result.urgency ?? '—'} />
                  <MiniDetail label="Recommended offer" value={result.recommended_offer || '—'} />
                </div>
                <div>
                  <p className="label">Pain points</p>
                  {result.pain_points.length > 0 ? (
                    <ul className="space-y-1">
                      {result.pain_points.map((p, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-ink-700">
                          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" /> {p}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-ink-400">None extracted.</p>}
                </div>
                <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Recommended next action</p>
                  <p className="text-sm font-medium text-ink-800">{result.next_action || '—'}</p>
                </div>
                {result.follow_up_draft && (
                  <div>
                    <p className="label">AI follow-up draft</p>
                    <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-700">{result.follow_up_draft}</p>
                  </div>
                )}

                {permissions.qualification.canApply && (
                  result.applied ? (
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                      <CheckCircle2 size={16} /> Applied to lead — score, temperature and status updated.
                    </div>
                  ) : (
                    <Button onClick={() => void handleApply()} className="w-full" disabled={applying}>
                      <Send size={15} /> {applying ? 'Applying…' : result.suggested_route ? ROUTE_LABELS[result.suggested_route] : 'Apply to lead'}
                    </Button>
                  )
                )}

                {permissions.qualification.canOverride && (
                  <div className="flex items-end gap-2 border-t border-ink-100 pt-3">
                    <div className="flex-1">
                      <label className="label flex items-center gap-1"><PenLine size={12} /> Human override (0–10)</label>
                      <Input type="number" min={0} max={10} step={0.5} value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} placeholder={String(result.fit_score)} />
                    </div>
                    <Button variant="secondary" onClick={() => void handleOverride()} disabled={overriding || !overrideValue}>
                      {overriding ? 'Saving…' : 'Override'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="label">{label}</p><p className="text-sm text-ink-700">{value || '—'}</p></div>;
}
function MiniDetail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-ink-100 p-3"><p className="text-[11px] text-ink-400">{label}</p><p className="text-sm font-medium text-ink-800">{value}</p></div>;
}
