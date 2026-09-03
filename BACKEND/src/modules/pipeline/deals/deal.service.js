// ── Shared utilities (adjust paths to your repo — see README) ────────────────
import {
  AppError,
  paginationMeta,
  normalizePaging,
} from '../../../shared/helpers/lead.helpers.js';

// ── Reused Lead module pieces (read-only; Lead module is not modified) ───────
import { leadRepository } from '../../leads/lead/lead.repository.js';
import { leadService } from '../../leads/lead/lead.service.js';
import { activityService } from '../../leads/activities/activity.service.js';

// ── Pipeline-local ───────────────────────────────────────────────────────────
import { dealRepository } from './deal.repository.js';
import { pipelineEvents } from '../../../shared/events/pipeline.events.js';
import { automationRulesService } from '../../whatsapp/submodules/automationRules/automationRules.service.js';
import { TRIGGER_TYPE as AUTOMATION_TRIGGER_TYPE } from '../../whatsapp/submodules/automationRules/automationRules.constants.js';
import {
  DEAL_STAGE,
  DEAL_STAGE_VALUES,
  STAGE_ORDER,
  STAGE_BOARD_KEY,
  STAGE_TO_LEAD_STATUS,
  STAGE_DEFAULT_PROBABILITY,
  PIPELINE_ACTIVITY,
  SEARCHABLE_FIELDS,
  SORTABLE_FIELDS,
} from './deal.constants.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDealDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.includeArchived !== 'true') filter.archived = false;

  if (query.stage) {
    if (!DEAL_STAGE_VALUES.includes(query.stage)) {
      throw AppError.badRequest(`Invalid stage filter: ${query.stage}`);
    }
    filter.stage = query.stage;
  }
  if (query.source) filter.source = String(query.source).trim();
  if (query.assigned_user_id) filter.assigned_user_id = String(query.assigned_user_id).trim();
  if (query.lead_id) filter.lead_id = query.lead_id;

  const min = query.minValue !== undefined ? Number(query.minValue) : undefined;
  const max = query.maxValue !== undefined ? Number(query.maxValue) : undefined;
  if (!Number.isNaN(min) && min !== undefined) filter.value = { ...filter.value, $gte: min };
  if (!Number.isNaN(max) && max !== undefined) filter.value = { ...filter.value, $lte: max };

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = SEARCHABLE_FIELDS.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  if (!sort) return { created_at: -1 };
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  if (!SORTABLE_FIELDS.includes(key)) return { created_at: -1 };
  return { [key]: desc ? -1 : 1 };
}

async function ensureLead(tenantId, leadId) {
  const lead = await leadRepository.findById(tenantId, leadId);
  if (!lead) throw AppError.notFound('Linked lead not found');
  return lead;
}

// ── Service ──────────────────────────────────────────────────────────────────

export const dealService = {
  async createDeal(ctx, data) {
    await ensureLead(ctx.tenantId, data.lead_id);

    const stage = data.stage || DEAL_STAGE.NEW_LEAD;
    const probability =
      data.probability ?? STAGE_DEFAULT_PROBABILITY[stage] ?? 0;

    const deal = await dealRepository.create({
      ...data,
      stage,
      probability,
      tenant_id: ctx.tenantId,
    });

    await activityService.log(ctx, deal.lead_id, PIPELINE_ACTIVITY.DEAL_CREATED, {
      message: `Deal "${deal.title}" created`,
      meta: { deal_id: String(deal._id), stage: deal.stage, value: deal.value },
    });

    pipelineEvents.created({
      tenantId: ctx.tenantId,
      dealId: String(deal._id),
      leadId: String(deal.lead_id),
      deal: toDealDTO(deal),
      actor: ctx.userId,
    });

    return toDealDTO(deal);
  },

  async getDeal(ctx, id) {
    const deal = await dealRepository.findById(ctx.tenantId, id);
    if (!deal) throw AppError.notFound('Deal not found');
    return toDealDTO(deal);
  },

  async getDeals(ctx, query) {
    const filter = buildFilter(query);
    const sort = buildSort(query.sort);
    const { page, limit, skip } = normalizePaging(query);

    const [items, total] = await Promise.all([
      dealRepository.find(ctx.tenantId, filter, { sort, skip, limit }),
      dealRepository.count(ctx.tenantId, filter),
    ]);

    return {
      data: items.map(toDealDTO),
      pagination: paginationMeta({ page, limit, total }),
    };
  },

  async updateDeal(ctx, id, patch) {
    const existing = await dealRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Deal not found');

    const fromStage = existing.stage;
    const stageChanging =
      patch.stage !== undefined && patch.stage !== fromStage;

    // Keep probability consistent for terminal stages.
    if (stageChanging) {
      if (patch.stage === DEAL_STAGE.WON) patch.probability = 100;
      if (patch.stage === DEAL_STAGE.LOST) patch.probability = 0;
    }

    const updated = await dealRepository.updateById(ctx.tenantId, id, patch);

    await activityService.log(ctx, updated.lead_id, PIPELINE_ACTIVITY.DEAL_UPDATED, {
      message: 'Deal updated',
      meta: { deal_id: id, fields: Object.keys(patch) },
    });

    pipelineEvents.updated({
      tenantId: ctx.tenantId,
      dealId: id,
      leadId: String(updated.lead_id),
      deal: toDealDTO(updated),
      actor: ctx.userId,
      changed: Object.keys(patch),
    });

    if (stageChanging) {
      await this._applyStageSideEffects(ctx, updated, fromStage, patch.stage);
    }

    return toDealDTO(updated);
  },

  async archiveDeal(ctx, id) {
    const existing = await dealRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Deal not found');

    const archived = await dealRepository.archiveById(ctx.tenantId, id);

    await activityService.log(ctx, archived.lead_id, PIPELINE_ACTIVITY.DEAL_ARCHIVED, {
      message: `Deal "${archived.title}" archived`,
      meta: { deal_id: id },
    });

    pipelineEvents.archived({
      tenantId: ctx.tenantId,
      dealId: id,
      leadId: String(archived.lead_id),
      deal: toDealDTO(archived),
      actor: ctx.userId,
    });

    return toDealDTO(archived);
  },

  /**
   * Move a deal to a new stage — the most important pipeline action.
   * Steps: update deal stage → activity → tracking event → sync lead status.
   */
  async moveStage(ctx, id, newStage) {
    if (!DEAL_STAGE_VALUES.includes(newStage)) {
      throw AppError.badRequest(`Invalid stage: ${newStage}`);
    }

    const existing = await dealRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Deal not found');

    const fromStage = existing.stage;
    if (fromStage === newStage) {
      return toDealDTO(existing); // no-op
    }

    const patch = { stage: newStage };
    if (newStage === DEAL_STAGE.WON) patch.probability = 100;
    if (newStage === DEAL_STAGE.LOST) patch.probability = 0;

    const updated = await dealRepository.updateById(ctx.tenantId, id, patch);

    await this._applyStageSideEffects(ctx, updated, fromStage, newStage);

    return toDealDTO(updated);
  },

  /** Shared stage-change side effects: activity + event + lead status sync. */
  async _applyStageSideEffects(ctx, deal, fromStage, toStage) {
    // 1 + 2. Activity ("Pipeline Stage Changed", plus Won/Lost markers).
    await activityService.log(ctx, deal.lead_id, PIPELINE_ACTIVITY.STAGE_CHANGED, {
      message: `Pipeline stage changed: ${fromStage} → ${toStage}`,
      meta: { deal_id: String(deal._id), from: fromStage, to: toStage },
    });
    if (toStage === DEAL_STAGE.WON) {
      await activityService.log(ctx, deal.lead_id, PIPELINE_ACTIVITY.DEAL_WON, {
        message: `Deal "${deal.title}" won`,
        meta: { deal_id: String(deal._id), value: deal.value },
      });
    } else if (toStage === DEAL_STAGE.LOST) {
      await activityService.log(ctx, deal.lead_id, PIPELINE_ACTIVITY.DEAL_LOST, {
        message: `Deal "${deal.title}" lost`,
        meta: { deal_id: String(deal._id) },
      });
    }

    // 3. Tracking event (Attribution module persists this).
    pipelineEvents.stageChanged({
      tenantId: ctx.tenantId,
      dealId: String(deal._id),
      leadId: String(deal.lead_id),
      from: fromStage,
      to: toStage,
      deal: toDealDTO(deal),
      actor: ctx.userId,
    });

    // Real Automation Rules dispatch for PIPELINE_STAGE_CHANGED -- same
    // previously-idle dispatch() as the other real trigger sites. dealId
    // is included so a rule's CHANGE_PIPELINE_STAGE action (or any future
    // deal-aware action) has something real to act on.
    automationRulesService
      .dispatch(ctx, AUTOMATION_TRIGGER_TYPE.PIPELINE_STAGE_CHANGED, {
        leadId: String(deal.lead_id),
        dealId: String(deal._id),
        deal: toDealDTO(deal),
        fromStage,
        toStage,
      })
      .catch((err) => {
        console.warn(`[automation] PIPELINE_STAGE_CHANGED dispatch failed for deal ${deal._id}: ${err.message}`);
      });

    // 4. Sync the linked lead's status where a mapping exists.
    const leadStatus = STAGE_TO_LEAD_STATUS[toStage];
    if (leadStatus) {
      try {
        await leadService.updateLead(ctx, String(deal.lead_id), {
          status: leadStatus,
        });
      } catch (err) {
        // Lead may be archived/missing — don't fail the stage move.
        console.warn(
          `[pipeline] could not sync lead status for ${deal.lead_id}: ${err.message}`,
        );
      }
    }
  },

  /** Grouped board for the Kanban UI (all 9 columns, archived excluded). */
  async getBoard(ctx, query = {}) {
    const filter = { archived: false };
    if (query.assigned_user_id) filter.assigned_user_id = query.assigned_user_id;
    if (query.source) filter.source = query.source;

    const deals = await dealRepository.find(ctx.tenantId, filter, {
      sort: { updated_at: -1 },
      skip: 0,
      limit: 5000,
    });

    // Initialize every column so the UI always gets all 9 keys.
    const board = {};
    for (const stage of STAGE_ORDER) board[STAGE_BOARD_KEY[stage]] = [];

    for (const deal of deals) {
      const key = STAGE_BOARD_KEY[deal.stage];
      if (key) board[key].push(toDealDTO(deal));
    }
    return board;
  },
};