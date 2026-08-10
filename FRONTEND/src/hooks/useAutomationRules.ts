import { useCallback, useEffect, useState } from 'react';
import { automationRulesApi } from '@/lib/automationRulesApi';
import { ApiError, type PaginationMeta } from '@/lib/apiClient';
import type { AutomationRule, AutomationRuleInput, AutomationRuleListQuery } from '@/types/automationRule';

export interface UseAutomationRulesResult {
  rules: AutomationRule[];
  pagination: PaginationMeta | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createRule: (input: AutomationRuleInput) => Promise<AutomationRule>;
  updateRule: (id: string, input: Partial<AutomationRuleInput>) => Promise<AutomationRule>;
  deleteRule: (id: string) => Promise<void>;
  duplicateRule: (id: string) => Promise<AutomationRule>;
  toggleRule: (id: string) => Promise<AutomationRule>;
}

export function useAutomationRules(query: AutomationRuleListQuery = {}): UseAutomationRulesResult {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    automationRulesApi.list(query)
      .then((result) => {
        if (cancelled) return;
        setRules(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load automation rules');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const createRule = useCallback(async (input: AutomationRuleInput) => {
    const rule = await automationRulesApi.create(input);
    refetch();
    return rule;
  }, [refetch]);

  const updateRule = useCallback(async (id: string, input: Partial<AutomationRuleInput>) => {
    const rule = await automationRulesApi.update(id, input);
    refetch();
    return rule;
  }, [refetch]);

  const deleteRule = useCallback(async (id: string) => {
    await automationRulesApi.remove(id);
    refetch();
  }, [refetch]);

  const duplicateRule = useCallback(async (id: string) => {
    const rule = await automationRulesApi.duplicate(id);
    refetch();
    return rule;
  }, [refetch]);

  const toggleRule = useCallback(async (id: string) => {
    const rule = await automationRulesApi.toggle(id);
    refetch();
    return rule;
  }, [refetch]);

  return { rules, pagination, loading, error, refetch, createRule, updateRule, deleteRule, duplicateRule, toggleRule };
}