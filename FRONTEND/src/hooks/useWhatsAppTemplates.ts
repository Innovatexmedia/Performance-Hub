import { useCallback, useEffect, useState } from 'react';
import { whatsappTemplatesApi } from '@/lib/whatsappTemplatesApi';
import { ApiError } from '@/lib/apiClient';
import type {
  WhatsAppTemplate, CreateTemplateInput, UpdateTemplateInput, TemplateListQuery, Pagination,
} from '@/types/whatsappTemplate';

export interface UseWhatsAppTemplatesResult {
  templates: WhatsAppTemplate[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createTemplate: (input: CreateTemplateInput) => Promise<WhatsAppTemplate>;
  updateTemplate: (id: string, patch: UpdateTemplateInput) => Promise<WhatsAppTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<WhatsAppTemplate>;
  activateTemplate: (id: string) => Promise<WhatsAppTemplate>;
  pauseTemplate: (id: string) => Promise<WhatsAppTemplate>;
  archiveTemplate: (id: string) => Promise<WhatsAppTemplate>;
}

export function useWhatsAppTemplates(query: TemplateListQuery = {}): UseWhatsAppTemplatesResult {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    whatsappTemplatesApi.list(query)
      .then((result) => {
        if (cancelled) return;
        setTemplates(result.data);
        setPagination(result.pagination);
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
    const template = await whatsappTemplatesApi.create(input);
    refetch();
    return template;
  }, [refetch]);

  const updateTemplate = useCallback(async (id: string, patch: UpdateTemplateInput) => {
    const template = await whatsappTemplatesApi.update(id, patch);
    refetch();
    return template;
  }, [refetch]);

  const deleteTemplate = useCallback(async (id: string) => {
    await whatsappTemplatesApi.delete(id);
    refetch();
  }, [refetch]);

  const duplicateTemplate = useCallback(async (id: string) => {
    const template = await whatsappTemplatesApi.duplicate(id);
    refetch();
    return template;
  }, [refetch]);

  const activateTemplate = useCallback(async (id: string) => {
    const template = await whatsappTemplatesApi.activate(id);
    refetch();
    return template;
  }, [refetch]);

  const pauseTemplate = useCallback(async (id: string) => {
    const template = await whatsappTemplatesApi.pause(id);
    refetch();
    return template;
  }, [refetch]);

  const archiveTemplate = useCallback(async (id: string) => {
    const template = await whatsappTemplatesApi.archive(id);
    refetch();
    return template;
  }, [refetch]);

  return {
    templates, pagination, loading, error, refetch,
    createTemplate, updateTemplate, deleteTemplate, duplicateTemplate,
    activateTemplate, pauseTemplate, archiveTemplate,
  };
}