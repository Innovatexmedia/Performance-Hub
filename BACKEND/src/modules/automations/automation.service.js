/**
 * =============================================================================
 * InnovateX Revenue OS — Automation Service
 * =============================================================================
 *
 * FILE: src/modules/automations/automation.service.js
 *
 * Contains ALL business logic:
 *   - Rule CRUD
 *   - Toggle active/inactive
 *   - Condition evaluation (single condition, optional)
 *   - Simulated action execution ("Simulate run" button per FRONTEND_SPEC §15)
 *   - Run logging (append-only, trimmed to MAX_LOGS_STORED)
 *   - KPI summary for the automations page header
 *   - dispatch() - NOT wired to any trigger source yet. This is the hook
 *     other modules will call once the real event-driven engine ships
 *     (development-phase per MASTER_SPEC.md B14). Wiring it into
 *     attribution.service.js's createTrackingEvent() is a deliberate
 *     follow-up, not done here, since it would touch every module that
 *     emits a tracking event.
 *
 * AppError usage matches call.service.js / booking.service.js exactly:
 * static factories from lead.helpers.js (AppError.notFound(), etc.) -
 * NOT the (message, statusCode) class from utils/AppError.js.
 */

import * as automationRepo from './automation.repository.js';
import { AppError, paginationMeta, normalizePaging } from '../../shared/helpers/lead.helpers.js';
import {
  TRIGGER_TYPE_VALUES,
  ACTION_TYPE,
  ACTION_TYPE_VALUES,
  AUTOMATION_STATUS,
  TRIGGERED_BY,
} from './automation.constants.js';

// =============================================================================
// CONDITION EVALUATOR
// =============================================================================

const getFieldValue = (context, fieldPath) =>
  fieldPath.split('.').reduce((obj, key) => (obj != null ? obj[key] : undefined), context || {});

const evaluateCondition = (condition, context) => {
  if (!condition || !condition.operator) return true;

  const actual = getFieldValue(context, condition.field || '');
  const expected = condition.value;

  switch (condition.operator) {
    case 'equals':
      return actual == expected;
    case 'not_equals':
      return actual != expected;
    case 'greater_than':
      return Number(actual) > Number(expected);
    case 'less_than':
      return Number(actual) < Number(expected);
    case 'contains':
      return String(actual == null ? '' : actual).toLowerCase().includes(String(expected == null ? '' : expected).toLowerCase());
    case 'exists':
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
};

// =============================================================================
// SIMULATED ACTION HANDLERS
// =============================================================================
// Each handler receives (params, context) and returns { success, message }.
// All handlers are SIMULATED - the comment above each shows the future real
// service call. Replace the body when the real execution engine ships.

const ACTION_HANDLERS = {
  [ACTION_TYPE.SEND_WHATSAPP_MESSAGE]: async (params) => {
    // Future: await messageService.send(ctx, { conversationId, templateId: params.templateId });
    return { success: true, message: 'WhatsApp message (template ' + (params.templateId || '-') + ') would be sent' };
  },
  [ACTION_TYPE.SEND_EMAIL]: async (params) => {
    // Future: await emailService.send(ctx, { to: params.to, subject: params.subject });
    return { success: true, message: 'Email would be sent to ' + (params.to || '(recipient)') };
  },
  [ACTION_TYPE.ASSIGN_USER]: async (params) => {
    // Future: await leadService.assign(tenantId, leadId, params.userId);
    return { success: true, message: 'Lead would be assigned to user ' + (params.userId || '(unspecified)') };
  },
  [ACTION_TYPE.ADD_TAG]: async (params) => {
    // Future: await leadService.addTag(tenantId, leadId, params.tag);
    return { success: true, message: 'Tag "' + (params.tag || '(unspecified)') + '" would be added' };
  },
  [ACTION_TYPE.CHANGE_PIPELINE_STAGE]: async (params) => {
    // Future: await dealService.moveStage(tenantId, dealId, params.stage);
    return { success: true, message: 'Deal stage would move to "' + (params.stage || '(unspecified)') + '"' };
  },
  [ACTION_TYPE.CREATE_TASK]: async (params) => {
    // Future: await taskService.create(tenantId, { title: params.title, leadId });
    return { success: true, message: 'Task "' + (params.title || 'Untitled') + '" would be created' };
  },
  [ACTION_TYPE.CREATE_NOTE]: async () => {
    // Future: await leadService.addNote(tenantId, leadId, params.text);
    return { success: true, message: 'Note would be added to the lead' };
  },
  [ACTION_TYPE.NOTIFY_USER]: async (params) => {
    // Future: await Notification.create({ tenantId, userId: params.userId, title, body });
    return { success: true, message: 'User ' + (params.userId || '(unspecified)') + ' would be notified' };
  },
  [ACTION_TYPE.ENROLL_NURTURE]: async (params) => {
    // Future: await nurturesService.enrollLead(ctx, params.sequenceId, { leadId });
    return { success: true, message: 'Lead would be enrolled in nurture sequence ' + (params.sequenceId || '(unspecified)') };
  },
  [ACTION_TYPE.CALL_WEBHOOK]: async (params) => {
    // Future: await fetch(params.url, { method: 'POST', body: JSON.stringify(context) });
    return { success: true, message: 'Webhook ' + (params.url || '(unspecified)') + ' would be called' };
  },
};

/** Run a single action and return a structured result - never throws. */
const executeAction = async (action, context) => {
  const handler = ACTION_HANDLERS[action.type];
  if (!handler) {
    return { success: false, message: 'No handler registered for action type "' + action.type + '"' };
  }
  try {
    return await handler(action.params || {}, context);
  } catch (err) {
    return { success: false, message: err.message || 'Action failed' };
  }
};

// =============================================================================
// CRUD
// =============================================================================

export const createAutomation = async (tenantId, userId, data) => {
  if (!data || !data.trigger || !TRIGGER_TYPE_VALUES.includes(data.trigger.type)) {
    throw AppError.badRequest('trigger.type must be one of the tracked event types');
  }
  if (!data.action || !ACTION_TYPE_VALUES.includes(data.action.type)) {
    throw AppError.badRequest('action.type must be one of: ' + ACTION_TYPE_VALUES.join(', '));
  }

  const automation = await automationRepo.create({
    tenant_id: tenantId,
    name: data.name,
    description: data.description || '',
    trigger: data.trigger,
    condition: data.condition || {},
    action: data.action,
    status: AUTOMATION_STATUS.INACTIVE,
    created_by: userId,
    updated_by: userId,
  });

  return automation;
};

export const getAutomation = async (tenantId, id) => {
  const automation = await automationRepo.findById(tenantId, id);
  if (!automation) throw AppError.notFound('Automation not found');
  return automation;
};

export const listAutomations = async (tenantId, filter, options) => {
  const { page, limit, skip } = normalizePaging(options || {});
  const [automations, total] = await Promise.all([
    automationRepo.list(tenantId, filter || {}, { skip, limit }),
    automationRepo.count(tenantId, filter || {}),
  ]);
  return { automations, pagination: paginationMeta({ page, limit, total }) };
};

// NOTE: updateAutomation / deleteAutomation were removed -- not named in
// any of the 3 spec documents' action lists for this module.

// =============================================================================
// TOGGLE
// =============================================================================

export const toggleAutomation = async (tenantId, id, userId) => {
  const existing = await automationRepo.findById(tenantId, id);
  if (!existing) throw AppError.notFound('Automation not found');

  const newStatus = existing.status === AUTOMATION_STATUS.ACTIVE
    ? AUTOMATION_STATUS.INACTIVE
    : AUTOMATION_STATUS.ACTIVE;

  return automationRepo.setStatus(tenantId, id, newStatus, userId);
};

// =============================================================================
// SIMULATE RUN - "Simulate run" button, FRONTEND_SPEC section 15
// =============================================================================

export const simulateAutomation = async (tenantId, id, userId, payload) => {
  const automation = await automationRepo.findById(tenantId, id);
  if (!automation) throw AppError.notFound('Automation not found');

  const p = payload || {};
  const context = p.context || {};
  const conditionPassed = evaluateCondition(automation.condition, context);

  let result;
  if (!conditionPassed) {
    result = { success: false, message: 'Condition not met - action skipped' };
  } else {
    result = await executeAction(automation.action, context);
  }

  const logEntry = {
    at: new Date(),
    result: result.message,
    success: result.success,
    triggeredBy: TRIGGERED_BY.MANUAL,
    leadId: p.leadId || null,
  };

  const updated = await automationRepo.recordRun(tenantId, id, logEntry);

  return {
    automation: updated,
    conditionPassed,
    result,
  };
};

// =============================================================================
// LOGS
// =============================================================================

export const getLogs = async (tenantId, id, options) => {
  const automation = await automationRepo.findById(tenantId, id);
  if (!automation) throw AppError.notFound('Automation not found');

  const page = (options && options.page) || 1;
  const limit = (options && options.limit) || 20;

  const allLogs = automation.logs.slice().reverse();
  const start = (page - 1) * limit;
  const rows = allLogs.slice(start, start + limit);

  return {
    logs: rows,
    pagination: paginationMeta({ page, limit, total: allLogs.length }),
  };
};

// =============================================================================
// KPIs
// =============================================================================

export const getKpiSummary = async (tenantId) => {
  const counts = await automationRepo.getKpiCounts(tenantId);
  return {
    total: counts.total,
    active: counts.active,
    inactive: counts.total - counts.active,
    totalRuns: counts.totalRuns,
  };
};

// =============================================================================
// DISPATCH - future event-driven hook (NOT wired to any trigger source yet)
// =============================================================================

export const dispatch = async (tenantId, triggerType, context) => {
  const ctx = context || {};
  const automations = await automationRepo.findActiveByTrigger(tenantId, triggerType);
  const results = [];

  for (const automation of automations) {
    const conditionPassed = evaluateCondition(automation.condition, ctx);
    if (!conditionPassed) {
      results.push({ automationId: String(automation._id), skipped: true });
      continue;
    }

    const result = await executeAction(automation.action, ctx);
    await automationRepo.recordRun(tenantId, String(automation._id), {
      at: new Date(),
      result: result.message,
      success: result.success,
      triggeredBy: TRIGGERED_BY.EVENT,
      leadId: ctx.leadId || null,
    });
    results.push({ automationId: String(automation._id), success: result.success });
  }

  return results;
};