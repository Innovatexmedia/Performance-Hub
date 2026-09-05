import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui';
import { FunnelChartCard } from '@/components/charts';
import { formatCurrencyCompact } from '@/utils/formatters';
import { STAGE_BOARD_KEY, STAGE_COLOR } from '@/types/deal';
import type { DealStage, PipelineStats } from '@/types/deal';

export function FlowView({ stats, stages }: { stats: PipelineStats; stages: DealStage[] }) {
  const countData = stages.map((stage) => ({
    name: stage,
    value: stats.stageTotals[STAGE_BOARD_KEY[stage]]?.count ?? 0,
  }));
  const valueData = stages.map((stage) => ({
    name: stage,
    value: stats.stageTotals[STAGE_BOARD_KEY[stage]]?.value ?? 0,
  }));
  const totalOpenValue = valueData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FunnelChartCard title="Deals by Stage" subtitle="Number of deals currently in each stage" data={countData} />
        <FunnelChartCard title="Value by Stage" subtitle="Combined deal value currently in each stage" data={valueData} />
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink-900">Stage-to-Stage Conversion</h3>
        <div className="space-y-2">
          {stages.slice(0, -1).map((stage, i) => {
            const next = stages[i + 1];
            const fromCount = stats.stageTotals[STAGE_BOARD_KEY[stage]]?.count ?? 0;
            const toCount = stats.stageTotals[STAGE_BOARD_KEY[next]]?.count ?? 0;
            // Conversion here reads as "of deals currently sitting in stage
            // A, this many currently sit in stage B" -- a snapshot ratio,
            // not a true cohort conversion rate (that would need deals
            // tracked over time as they move, which stageHistory could
            // support later but isn't computed here).
            const pct = fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0;
            return (
              <div key={stage} className="flex items-center gap-3 text-sm">
                <span className="flex w-32 shrink-0 items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
                  {stage} <span className="text-ink-400">({fromCount})</span>
                </span>
                <ArrowRight size={14} className="shrink-0 text-ink-300" />
                <span className="flex w-32 shrink-0 items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[next] }} />
                  {next} <span className="text-ink-400">({toCount})</span>
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right font-semibold text-ink-700">{pct}%</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Snapshot ratio of deals currently in each stage — not a historical cohort conversion rate.
        </p>
      </Card>

      <p className="text-center text-xs text-ink-400">
        Total open pipeline across these stages: {formatCurrencyCompact(totalOpenValue)}
      </p>
    </div>
  );
}