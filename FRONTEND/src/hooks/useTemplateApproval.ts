import { useCallback } from 'react';
import { whatsappTemplateApprovalApi } from '@/lib/whatsappTemplateApprovalApi';
import type { WhatsAppTemplate } from '@/types/whatsappTemplate';

export interface UseTemplateApprovalResult {
  submitForReview: (id: string, comment?: string) => Promise<WhatsAppTemplate>;
  requestChanges: (id: string, comment: string) => Promise<WhatsAppTemplate>;
  approve: (id: string, comment?: string) => Promise<WhatsAppTemplate>;
  reject: (id: string, comment: string) => Promise<WhatsAppTemplate>;
  submitToProvider: (id: string) => Promise<WhatsAppTemplate>;
}

/**
 * useTemplateApproval -- thin wrapper around whatsappTemplateApprovalApi.
 * Deliberately does NOT hold its own template list (ApprovalTab reuses
 * useWhatsAppTemplates() for that, same list Templates tab uses, since
 * approvalStatus/transitionHistory/approvalComments are already fields on
 * the real WhatsAppTemplate the list endpoint returns). Each action calls
 * `onChanged` (typically that list's refetch) after a successful mutation
 * so the UI reflects the new approvalStatus immediately.
 */
export function useTemplateApproval(onChanged?: () => void): UseTemplateApprovalResult {
  const submitForReview = useCallback(async (id: string, comment?: string) => {
    const template = await whatsappTemplateApprovalApi.submitForReview(id, comment);
    onChanged?.();
    return template;
  }, [onChanged]);

  const requestChanges = useCallback(async (id: string, comment: string) => {
    const template = await whatsappTemplateApprovalApi.requestChanges(id, comment);
    onChanged?.();
    return template;
  }, [onChanged]);

  const approve = useCallback(async (id: string, comment?: string) => {
    const template = await whatsappTemplateApprovalApi.approve(id, comment);
    onChanged?.();
    return template;
  }, [onChanged]);

  const reject = useCallback(async (id: string, comment: string) => {
    const template = await whatsappTemplateApprovalApi.reject(id, comment);
    onChanged?.();
    return template;
  }, [onChanged]);

  const submitToProvider = useCallback(async (id: string) => {
    const template = await whatsappTemplateApprovalApi.submitToProvider(id);
    onChanged?.();
    return template;
  }, [onChanged]);

  return { submitForReview, requestChanges, approve, reject, submitToProvider };
}