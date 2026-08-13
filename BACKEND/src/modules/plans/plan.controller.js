import { asyncHandler } from '../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated } from '../../utils/apiResponse.js';
import { planService } from './plan.service.js';

export const planController = {
  /** GET /api/plans -- any authenticated user (a tenant_owner needs to see
   * available plans to consider upgrading; only mutations are super_admin-only). */
  list: asyncHandler(async (req, res) => {
    const plans = await planService.list({ includeInactive: req.query.includeInactive === 'true' });
    return sendSuccess(res, plans, 'Plans fetched successfully');
  }),

  get: asyncHandler(async (req, res) => {
    const plan = await planService.getById(req.params.id);
    return sendSuccess(res, plan, 'Plan fetched successfully');
  }),

  // ── super_admin only, from here down ──────────────────────────────────────

  create: asyncHandler(async (req, res) => {
    const plan = await planService.create(req.body);
    return sendCreated(res, plan, 'Plan created successfully');
  }),

  update: asyncHandler(async (req, res) => {
    const plan = await planService.update(req.params.id, req.body);
    return sendSuccess(res, plan, 'Plan updated successfully');
  }),

  remove: asyncHandler(async (req, res) => {
    await planService.remove(req.params.id);
    return sendSuccess(res, null, 'Plan deleted successfully');
  }),
};
