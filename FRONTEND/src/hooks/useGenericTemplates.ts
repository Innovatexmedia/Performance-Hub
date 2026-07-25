import { useCallback, useEffect, useState } from 'react';
import { genericTemplatesApi } from '@/lib/genericTemplatesApi';
import { ApiError, type PaginationMeta } from '@/lib/apiClient';
import type {
  GenericTemplate, CreateTemplateInput, UpdateTemplateInput, TemplateListQuery, TemplateCounts,
} from '@/types/genericTemplate';

export interface UseGenericTemplatesResult {
  templates: GenericTemplate[];
  pagination: PaginationMeta | null;
  counts: TemplateCounts | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createTemplate: (input: CreateTemplateInput) => Promise<GenericTemplate>;
  updateTemplate: (id: string, patch: UpdateTemplateInput) => Promise<GenericTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<GenericTemplate>;
}

export function useGenericTemplates(query: TemplateListQuery = {}): UseGenericTemplatesResult {
  const [templates, setTemplates] = useState<GenericTemplate[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [counts, setCounts] = useState<TemplateCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      genericTemplatesApi.list(query),
      genericTemplatesApi.getCounts({ scope: query.scope, search: query.search }),
    ])
      .then(([listResult, countsResult]) => {
        if (cancelled) return;
        setTemplates(listResult.data);
        setPagination(listResult.pagination);
        setCounts(countsResult);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load templates');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const createTemplate = useCallback(async (input: CreateTemplateInput) => {
    const template = await genericTemplatesApi.create(input);
    refetch();
    return template;
  }, [refetch]);

  const updateTemplate = useCallback(async (id: string, patch: UpdateTemplateInput) => {
    const template = await genericTemplatesApi.update(id, patch);
    refetch();
    return template;
  }, [refetch]);

  const deleteTemplate = useCallback(async (id: string) => {
    await genericTemplatesApi.delete(id);
    refetch();
  }, [refetch]);

  const duplicateTemplate = useCallback(async (id: string) => {
    const template = await genericTemplatesApi.duplicate(id);
    refetch();
    return template;
  }, [refetch]);

  return { templates, pagination, counts, loading, error, refetch, createTemplate, updateTemplate, deleteTemplate, duplicateTemplate };
}