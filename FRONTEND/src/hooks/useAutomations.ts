import { useCallback, useEffect, useState } from 'react';
import { automationsApi } from '@/lib/automationsApi';
import { ApiError, type PaginationMeta } from '@/lib/apiClient';
import type { Automation, CreateAutomationInput, AutomationKpis, SimulateResult } from '@/types/automation';

export interface UseAutomationsResult {
  automations: Automation[];
  pagination: PaginationMeta | null;
  kpis: AutomationKpis | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createAutomation: (input: CreateAutomationInput) => Promise<Automation>;
  toggleAutomation: (id: string) => Promise<Automation>;
  simulateAutomation: (id: string, context?: Record<string, unknown>, leadId?: string) => Promise<SimulateResult>;
}

export function useAutomations(query: { status?: string; trigger?: string; search?: string; limit?: number } = {}): UseAutomationsResult {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [kpis, setKpis] = useState<AutomationKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([automationsApi.list(query), automationsApi.getKpis()])
      .then(([listResult, kpisResult]) => {
        if (cancelled) return;
        setAutomations(listResult.data);
        setPagination(listResult.pagination);
        setKpis(kpisResult);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load automations');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const createAutomation = useCallback(async (input: CreateAutomationInput) => {
    const automation = await automationsApi.create(input);
    refetch();
    return automation;
  }, [refetch]);

  const toggleAutomation = useCallback(async (id: string) => {
    const automation = await automationsApi.toggle(id);
    refetch();
    return automation;
  }, [refetch]);

  const simulateAutomation = useCallback(async (id: string, context?: Record<string, unknown>, leadId?: string) => {
    const result = await automationsApi.simulate(id, context, leadId);
    refetch();
    return result;
  }, [refetch]);

  return { automations, pagination, kpis, loading, error, refetch, createAutomation, toggleAutomation, simulateAutomation };
}