import { asyncHandler, AppError } from '../../../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../../../utils/responses.js';
import { templatesService } from './templates.service.js';
import {
  TEMPLATE_CATEGORY_VALUES,
  SUPPORTED_LANGUAGES,
} from './templates.constants.js';

/**
 * Resolve request context. Uses req.user (auth middleware); falls back to
 * req.context (the WhatsApp module's withContext) so it works under either.
 */
function buildCtx(req) {
  const user = req.user || {};
  const fallback = req.context || {};
  const tenantId = user.tenantId || fallback.tenantId;

  if (!tenantId) {
    throw new AppError(401, "Missing tenant context");
  }

  return {
    tenantId,
    userId: user.id || user._id || fallback.userId || null,
    userName: user.name || user.fullName || null,
    role: user.role || fallback.role || null,
  };
}

export const templatesController = {
  // POST /api/whatsapp/templates
  create: asyncHandler(async (req, res) => {
    const template = await templatesService.createTemplate(buildCtx(req), req.body);
    return sendCreated(res, template, 'Template created');
  }),

  // GET /api/whatsapp/templates
  list: asyncHandler(async (req, res) => {
    const { data, pagination } = await templatesService.listTemplates(buildCtx(req), req.query);
    return sendPaginated(res, data, pagination);
  }),

  // GET /api/whatsapp/templates/:id
  get: asyncHandler(async (req, res) => {
    const template = await templatesService.getTemplate(buildCtx(req), req.params.id);
    return sendSuccess(res, template);
  }),

  // PATCH /api/whatsapp/templates/:id
  update: asyncHandler(async (req, res) => {
    const template = await templatesService.updateTemplate(buildCtx(req), req.params.id, req.body);
    return sendSuccess(res, template, 'Template updated');
  }),

  // DELETE /api/whatsapp/templates/:id
  remove: asyncHandler(async (req, res) => {
    const result = await templatesService.deleteTemplate(buildCtx(req), req.params.id);
    return sendSuccess(res, result, 'Template deleted');
  }),

  // POST /api/whatsapp/templates/:id/duplicate
  duplicate: asyncHandler(async (req, res) => {
    const template = await templatesService.duplicateTemplate(buildCtx(req), req.params.id);
    return sendCreated(res, template, 'Template duplicated');
  }),

  // POST /api/whatsapp/templates/:id/activate
  activate: asyncHandler(async (req, res) => {
    const template = await templatesService.activateTemplate(buildCtx(req), req.params.id);
    return sendSuccess(res, template, 'Template activated');
  }),

  // POST /api/whatsapp/templates/:id/pause
  pause: asyncHandler(async (req, res) => {
    const template = await templatesService.pauseTemplate(buildCtx(req), req.params.id);
    return sendSuccess(res, template, 'Template paused');
  }),

  // POST /api/whatsapp/templates/:id/archive
  archive: asyncHandler(async (req, res) => {
    const template = await templatesService.archiveTemplate(buildCtx(req), req.params.id);
    return sendSuccess(res, template, 'Template archived');
  }),

  // POST /api/whatsapp/templates/:id/sync
  sync: asyncHandler(async (req, res) => {
    const template = await templatesService.syncTemplate(buildCtx(req), req.params.id);
    return sendSuccess(res, template, 'Template synced');
  }),

  // POST /api/whatsapp/templates/:id/preview
  preview: asyncHandler(async (req, res) => {
    const result = await templatesService.previewTemplate(buildCtx(req), req.params.id, req.body.variables || {});
    return sendSuccess(res, result);
  }),

  // GET /api/whatsapp/templates/categories
  categories: asyncHandler(async (_req, res) => {
    return sendSuccess(res, TEMPLATE_CATEGORY_VALUES);
  }),

  // GET /api/whatsapp/templates/languages
  languages: asyncHandler(async (_req, res) => {
    return sendSuccess(res, SUPPORTED_LANGUAGES);
  }),
};