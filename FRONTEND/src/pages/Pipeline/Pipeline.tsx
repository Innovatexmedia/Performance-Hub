import { useEffect, useRef, useState } from 'react';
import {
  Plus, ChevronLeft, ChevronRight, Trash2, TrendingUp, DollarSign, Target, Briefcase,
  MousePointerClick, Maximize2, Minimize2, Download, Settings,
  Users, BadgeCheck, Phone, PhoneCall, Send, Trophy, X, type LucideIcon,
} from 'lucide-react';
import { PageHeader, Card, Badge, Button, Avatar, Select, Modal, Field, Input } from '@/components/ui';
import { KpiCard } from '@/components/ui/KpiCard';
import { formatCurrency, formatCompact } from '@/utils/formatters';
import { exportToCSV } from '@/utils/csvExport';
import { toast } from '@/store/toastStore';
import { usePipelineBoard } from '@/hooks/usePipelineBoard';
import { usePipelineStageLabels } from '@/hooks/usePipelineStageLabels';
import { useLeadNames } from '@/hooks/useLeadNames';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { usePermissions } from '@/hooks/usePermissions';
import { leadsApi } from '@/lib/leadsApi';
import { ApiError } from '@/lib/apiClient';
import { STAGE_ORDER, STAGE_BOARD_KEY, STAGE_COLOR, CLOSED_STAGES, STAGE_DEFAULT_PROBABILITY } from '@/types/deal';
import type { Deal, DealStage } from '@/types/deal';
import type { LeadListItem } from '@/types/lead';
import { DealPanel } from './DealPanel';
import { EditDealModal } from './EditDealModal';
import { LeadDrawer } from '@/pages/Leads/LeadDrawer';

const SUMMARY_STAGES: DealStage[] = ['New Lead', 'Qualified', 'Booked Call', 'Call Completed', 'Proposal Sent', 'Won'];

const STAGE_ICON: Record<DealStage, LucideIcon> = {
  'New Lead': Users, 'Qualified': BadgeCheck, 'Booked Call': Phone, 'Call Completed': PhoneCall,
  'Proposal Sent': Send, 'Negotiation': Users, 'Won': Trophy, 'Lost': X, 'Nurture': Users,
};

const SOURCE_DOTS = ['#8b5cf6', '#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#10b981', '#ef4444'];
function sourceDot(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return SOURCE_DOTS[hash % SOURCE_DOTS.length];
}

/** 0-25 red · 25-50 amber · 50-75 blue · 75-100 green -- real deal.probability, not decorative. */
function probabilityColor(p: number): string {
  if (p < 25) return '#ef4444';
  if (p < 50) return '#f59e0b';
  if (p < 75) return '#3b82f6';
  return '#10b981';
}

export function Pipeline() {
  const permissions = usePermissions();
  const { members, nameById } = useTeamMembers();
  const [ownerFilter, setOwnerFilter] = useState<string | undefined>(undefined);
  const { board, stats, loading, error, refetch, createDeal, updateDeal, moveStage, archiveDeal } = usePipelineBoard(ownerFilter);
  const { stageLabel, stageColor } = usePipelineStageLabels();

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const [addStage, setAddStage] = useState<DealStage | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [viewingLeadId, setViewingLeadId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const columnRefs = useRef<Partial<Record<DealStage, HTMLDivElement | null>>>({});

  const allDeals: Deal[] = board
    ? Object.keys(board).reduce<Deal[]>((acc, key) => acc.concat(board[key] ?? []), [])
    : [];
  const leadNames = useLeadNames(allDeals.map((d) => d.lead_id));
  const selectedDeal = selectedDealId ? allDeals.find((d) => d.id === selectedDealId) ?? null : null;

  const activeDeals = stats ? stats.totalDeals - (stats.stageTotals.won?.count ?? 0) - (stats.stageTotals.lost?.count ?? 0) : 0;
  const winRatePct = stats ? Math.round(stats.winRate * 100) : 0;

  const onDrop = async (stage: DealStage) => {
    setDragOverStage(null);
    if (!dragId) return;
    const deal = allDeals.find((d) => d.id === dragId);
    setDragId(null);
    if (!deal || deal.stage === stage) return;
    if (!permissions.pipeline.canMove) return toast.error('Your role cannot move deals');
    try {
      await moveStage(deal.id, stage);
    } catch (err) {
      toast.error('Could not move deal', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const moveByOffset = async (deal: Deal, offset: 1 | -1) => {
    const idx = STAGE_ORDER.indexOf(deal.stage);
    const target = STAGE_ORDER[idx + offset];
    if (!target) return;
    try {
      await moveStage(deal.id, target);
    } catch (err) {
      toast.error('Could not move deal', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const handleArchive = async (id: string, title: string) => {
    try {
      await archiveDeal(id);
      if (selectedDealId === id) setSelectedDealId(null);
      toast.success('Deal archived', title);
    } catch (err) {
      toast.error('Could not archive deal', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  const scrollToStage = (stage: DealStage) => {
    columnRefs.current[stage]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  const exportPipeline = () => {
    // Client-side export -- there is no dedicated /api/pipeline/export
    // endpoint on the backend (unlike Leads). getBoard already fetches
    // every non-archived deal (up to 5000) in one call, so this is a
    // complete export of what's currently loaded, not a partial page.
    exportToCSV('pipeline-deals', allDeals.map((d) => ({
      title: d.title,
      stage: d.stage,
      value: d.value,
      probability: d.probability,
      source: d.source,
      owner: nameById(d.assigned_user_id),
      lead_id: d.lead_id,
      expected_close_date: d.expected_close_date ?? '',
      created_at: d.created_at,
    })));
  };

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Drag deals between stages — every move updates the lead, timeline & attribution."
        breadcrumb={['Revenue', 'Pipeline']}
        actions={
          <>
            <Select value={ownerFilter ?? 'all'} onChange={(e) => setOwnerFilter(e.target.value === 'all' ? undefined : e.target.value)} className="w-auto">
              <option value="all">All owners</option>
              {members.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
            {permissions.pipeline.canCreate && (
              <Button onClick={() => setAddStage('New Lead')}><Plus size={16} /> Add Deal</Button>
            )}
          </>
        }
      />

      {/* KPI row -- no trend deltas: accurate 30-day comparisons need a
          historical-snapshot backend feature that doesn't exist yet. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Open Pipeline" value={stats ? formatCompact(stats.pipelineValue) : '—'} icon={<TrendingUp size={18} />} accent="#6366f1" />
        <KpiCard label="Won Value" value={stats ? formatCompact(stats.wonValue) : '—'} icon={<DollarSign size={18} />} accent="#10b981" />
        <KpiCard label="Win Rate" value={`${winRatePct}%`} icon={<Target size={18} />} accent="#f59e0b" />
        <KpiCard label="Active Deals" value={activeDeals} icon={<Briefcase size={18} />} accent="#06b6d4" />
      </div>

      {/* Stage summary strip -- clickable: scrolls the board to that column */}
      {stats && (
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          {SUMMARY_STAGES.map((stage, i) => {
            const key = STAGE_BOARD_KEY[stage];
            const t = stats.stageTotals[key] ?? { count: 0, value: 0 };
            const Icon = STAGE_ICON[stage];
            return (
              <div key={stage} className="flex items-center gap-1.5">
                <button
                  onClick={() => scrollToStage(stage)}
                  className="flex shrink-0 items-center gap-2 rounded-lg border border-ink-100 bg-white px-3 py-1.5 transition hover:border-brand-200 hover:bg-brand-50"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: `${stageColor(stage)}1a`, color: stageColor(stage) }}>
                    <Icon size={12} />
                  </span>
                  <span className="text-xs font-semibold text-ink-700">{stageLabel(stage)}</span>
                  <span className="text-xs text-ink-400">{t.count}</span>
                  <span className="text-xs font-medium text-ink-500">{formatCompact(t.value)}</span>
                </button>
                {i < SUMMARY_STAGES.length - 1 && (
                  <div className="h-px w-4 shrink-0 border-t-2 border-dashed border-ink-200" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <Card className="mb-4 p-4 text-sm text-red-600">{error}</Card>}
      {loading && !board && <p className="p-8 text-center text-sm text-ink-400">Loading pipeline…</p>}

      {board && (
        <div className="flex gap-0 rounded-xl border border-ink-100 bg-white">
          <div className={`flex flex-1 gap-3 overflow-x-auto p-3 ${expanded ? 'max-h-[calc(100vh-220px)]' : 'max-h-[calc(100vh-420px)]'} min-h-[420px]`}>
            {STAGE_ORDER.map((stage) => {
              const key = STAGE_BOARD_KEY[stage];
              const stageDeals: Deal[] = board[key] ?? [];
              const stageValue = stageDeals.reduce((s, d) => s + d.value, 0);
              const isDragTarget = dragOverStage === stage && dragId && allDeals.find((d) => d.id === dragId)?.stage !== stage;
              return (
                <div
                  key={stage}
                  ref={(el) => { columnRefs.current[stage] = el; }}
                  className="flex w-72 shrink-0 flex-col overflow-y-auto rounded-xl bg-ink-100/60"
                  onDragEnter={(e) => { e.preventDefault(); setDragOverStage(stage); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={(e) => {
                    // dragleave fires every time the cursor crosses from the
                    // column onto a child card (event bubbling), not just
                    // when truly leaving the column -- that's what caused
                    // the flicker on non-empty columns. Only clear when the
                    // cursor is moving to an element OUTSIDE this column.
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDragOverStage((s) => (s === stage ? null : s));
                    }
                  }}
                  onDrop={() => void onDrop(stage)}
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-ink-100/95 px-3 py-2.5 backdrop-blur">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: stageColor(stage) }} />
                      <span className="text-sm font-semibold text-ink-800">{stageLabel(stage)}</span>
                      <span className="rounded-full bg-white px-1.5 text-xs font-medium text-ink-500">{stageDeals.length}</span>
                    </div>
                    <span className="text-xs font-medium text-ink-400">{formatCompact(stageValue)}</span>
                  </div>
                  <div className="flex-1 space-y-2 px-2 pb-2">
                    {isDragTarget && (
                      <div className="rounded-lg border-2 border-dashed border-brand-400 bg-brand-50 py-6 text-center text-xs font-medium text-brand-600">
                        Drop here to move to {stageLabel(stage)}
                      </div>
                    )}
                    {stageDeals.map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        leadName={leadNames[deal.lead_id]}
                        ownerName={nameById(deal.assigned_user_id)}
                        selected={deal.id === selectedDealId}
                        canMove={permissions.pipeline.canMove}
                        canDelete={permissions.pipeline.canDelete}
                        onSelect={() => setSelectedDealId(deal.id)}
                        onDragStart={() => setDragId(deal.id)}
                        onMovePrev={() => void moveByOffset(deal, -1)}
                        onMoveNext={() => void moveByOffset(deal, 1)}
                        onDelete={() => void handleArchive(deal.id, deal.title)}
                        isFirstStage={stage === STAGE_ORDER[0]}
                        isLastStage={stage === STAGE_ORDER[STAGE_ORDER.length - 1]}
                      />
                    ))}
                    {stageDeals.length === 0 && !isDragTarget && (
                      <div className="rounded-lg border border-dashed border-ink-300 py-6 text-center text-xs text-ink-400">Drop deals here</div>
                    )}
                    {permissions.pipeline.canCreate && (
                      <button
                        onClick={() => setAddStage(stage)}
                        className="flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-ink-400 hover:bg-white hover:text-brand-600"
                      >
                        <Plus size={13} /> Add Deal
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedDeal && (
            <DealPanel
              deal={selectedDeal}
              nameById={nameById}
              onClose={() => setSelectedDealId(null)}
              onViewDetails={() => setViewingLeadId(selectedDeal.lead_id)}
              onEdit={() => setEditingDeal(selectedDeal)}
            />
          )}
        </div>
      )}

      {/* Probability legend + bottom actions */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-ink-500">
          <span className="font-medium text-ink-400">Probability:</span>
          <LegendDot color="#ef4444" label="0–25%" />
          <LegendDot color="#f59e0b" label="25–50%" />
          <LegendDot color="#3b82f6" label="50–75%" />
          <LegendDot color="#10b981" label="75–100%" />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportPipeline}><Download size={15} /> Export Pipeline</Button>
          <Button variant="secondary" onClick={() => setShowSettings(true)}><Settings size={15} /> Pipeline Settings</Button>
        </div>
      </div>

      {addStage && (
        <AddDealModal
          initialStage={addStage}
          onClose={() => setAddStage(null)}
          onCreated={() => { refetch(); setAddStage(null); }}
          createDeal={createDeal}
        />
      )}
      {editingDeal && (
        <EditDealModal
          deal={editingDeal}
          onClose={() => setEditingDeal(null)}
          onSave={updateDeal}
        />
      )}
      {viewingLeadId && <LeadDrawer leadId={viewingLeadId} onClose={() => setViewingLeadId(null)} />}
      {showSettings && <PipelineSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

/**
 * PipelineSettingsModal -- READ-ONLY. Pipeline stages are system-defined on
 * this backend (deal.constants.js) -- there is no per-tenant customization
 * endpoint. This deliberately does NOT pretend to be an editable settings
 * page; it documents the fixed stages and their default probabilities
 * instead of shipping a form that would silently do nothing.
 */
function PipelineSettingsModal({ onClose }: { onClose: () => void }) {
  const { stageLabel, stageColor } = usePipelineStageLabels();
  return (
    <Modal open onClose={onClose} title="Pipeline Settings" footer={<Button onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-sm text-ink-500">
        Stage names and colors can be customized in Settings → Pipeline Stages. The 9 stages
        themselves and their order are fixed. Here is the current list and the default
        win-probability applied when a deal enters each stage:
      </p>
      <div className="divide-y divide-ink-100 rounded-lg border border-ink-100">
        {STAGE_ORDER.map((stage) => (
          <div key={stage} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: stageColor(stage) }} /> {stageLabel(stage)}
            </span>
            <span className="text-ink-400">{STAGE_DEFAULT_PROBABILITY[stage]}% default</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function DealCard({
  deal, leadName, ownerName, selected, canMove, canDelete, onSelect, onDragStart, onMovePrev, onMoveNext, onDelete, isFirstStage, isLastStage,
}: {
  deal: Deal;
  leadName?: { name: string; company: string };
  ownerName: string;
  selected: boolean;
  canMove: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onMovePrev: () => void;
  onMoveNext: () => void;
  onDelete: () => void;
  isFirstStage: boolean;
  isLastStage: boolean;
}) {
  return (
    <div
      draggable={canMove}
      onDragStart={canMove ? onDragStart : undefined}
      onClick={onSelect}
      className={`card group cursor-pointer p-3 transition ${canMove ? 'active:cursor-grabbing' : ''} ${selected ? 'ring-2 ring-brand-500' : ''}`}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-semibold text-ink-900">{deal.title}</p>
        {canDelete && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-ink-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"><Trash2 size={13} /></button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-ink-500">{leadName?.name ?? '…'}</p>
      <div className="mt-2 flex items-center justify-between">
        <Badge tone="green">{formatCurrency(deal.value)}</Badge>
        <span className="text-xs font-semibold" style={{ color: probabilityColor(deal.probability) }}>{deal.probability}%</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Avatar name={ownerName} size={20} color="#8b5cf6" />
          <span className="flex items-center gap-1 text-[11px] text-ink-500">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: sourceDot(deal.source) }} />
            {deal.source}
          </span>
        </div>
        {canMove && (
          <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
            <button disabled={isFirstStage} onClick={(e) => { e.stopPropagation(); onMovePrev(); }} className="rounded p-1 text-ink-400 hover:bg-ink-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <button disabled={isLastStage} onClick={(e) => { e.stopPropagation(); onMoveNext(); }} className="rounded p-1 text-ink-400 hover:bg-ink-100 disabled:opacity-30"><ChevronRight size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddDealModal({ initialStage, onClose, onCreated, createDeal }: {
  initialStage: DealStage;
  onClose: () => void;
  onCreated: () => void;
  createDeal: ReturnType<typeof usePipelineBoard>['createDeal'];
}) {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [leadId, setLeadId] = useState('');
  const [value, setValue] = useState(5000);
  const [stage, setStage] = useState<DealStage>(initialStage);
  const [saving, setSaving] = useState(false);
  const { stageLabel } = usePipelineStageLabels();

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
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return toast.error('Select a lead');
    setSaving(true);
    try {
      await createDeal({
        lead_id: lead.id,
        title: `${lead.company || lead.name} — Revenue OS`,
        value: Number(value),
        stage,
        source: lead.source,
        assigned_user_id: lead.assigned_user_id,
      });
      toast.success('Deal created', lead.name);
      onCreated();
    } catch (err) {
      toast.error('Could not create deal', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Deal"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !leadId}>{saving ? 'Creating…' : 'Create deal'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Lead">
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.company}</option>)}
          </Select>
        </Field>
        <Field label="Deal value (USD)"><Input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /></Field>
        <Field label="Stage">
          <Select value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
            {STAGE_ORDER.filter((s) => !CLOSED_STAGES.includes(s)).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}