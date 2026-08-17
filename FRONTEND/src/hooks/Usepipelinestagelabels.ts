import { useEffect, useState } from 'react';
import { settingsApi } from '@/lib/settingsApi';
import { STAGE_BOARD_KEY, STAGE_COLOR } from '@/types/deal';
import type { DealStage } from '@/types/deal';

/**
 * Reads the real /settings/pipeline-stages/board endpoint (ungated, so
 * sales_user+ can call it -- see settingsApi's comment) and exposes
 * per-stage display label/color, falling back to the hardcoded defaults
 * in types/deal.ts if a tenant hasn't customized a stage (or the fetch is
 * still loading/failed). The 9 DealStage keys/order themselves are never
 * affected by this -- only what's shown for each one.
 */
export function usePipelineStageLabels() {
  const [overrides, setOverrides] = useState<Record<string, { name: string; color: string }>>({});

  useEffect(() => {
    let cancelled = false;
    settingsApi.getPipelineStagesForBoard()
      .then((stages) => {
        if (cancelled) return;
        const map: Record<string, { name: string; color: string }> = {};
        for (const s of stages) map[s.key] = { name: s.name, color: s.color };
        setOverrides(map);
      })
      .catch(() => { /* silently keep defaults -- this is a display-only nicety */ });
    return () => { cancelled = true; };
  }, []);

  const stageLabel = (stage: DealStage): string => overrides[STAGE_BOARD_KEY[stage]]?.name || stage;
  const stageColor = (stage: DealStage): string => overrides[STAGE_BOARD_KEY[stage]]?.color || STAGE_COLOR[stage];

  return { stageLabel, stageColor };
}