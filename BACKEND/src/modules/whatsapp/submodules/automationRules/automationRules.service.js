/**
 * WhatsApp Automation Rules — service.
 *
 * Contains ALL business logic:
 *   • Rule CRUD (create, read, list, update, soft-delete, duplicate, toggle)
 *   • Trigger validation
 *   • Condition evaluation (AND / OR logic)
 *   • Action execution engine (simulate now; integrate live services later)
 *   • Manual run (simulate)
 *   • Execution history
 *   • Tenant isolation
 *   • Priority ordering
 *
 * ── Pluggable action handlers ─────────────────────────────────────────────────
 * Each ACTION_TYPE maps to a handler function in ACTION_HANDLERS below.
 * To wire a real integration (e.g. templatesService.sendTemplate), replace
 * the corresponding handler — no changes needed in engine, routes, or controller.
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { automationRulesRepository } from './automationRules.repository.js';
import { leadRepository } from '../../../leads/lead/lead.repository.js';
import { templatesRepository } from '../templates/templates.repository.js';
import { sendToOneRecipient } from '../../messageSender.js';
import { nurturesService } from '../nurtures/nurtures.service.js';
import { nurturesRepository } from '../nurtures/nurtures.repository.js';
import { noteService } from '../../../leads/notes/note.service.js';
import { notificationService } from '../../../leads/notifications/notification.service.js';
import { aiReplyAssistantService } from '../aiReplyAssistant/aiReplyAssistant.service.js';
import { messageRepository } from '../../messages/message.repository.js';
import { conversationRepository } from '../../conversations/conversation.repository.js';
import { sendCustomEmail } from '../../../auth/services/email.service.js';
import dns from 'node:dns/promises';
import net from 'node:net';
// dealService is imported dynamically inside the CHANGE_PIPELINE_STAGE
// handler below, NOT statically here -- deal.service.js already imports
// automationRulesService (to dispatch PIPELINE_STAGE_CHANGED), so a
// static import in both directions would be a circular dependency.
import {
  RULE_STATUS,
  RULE_STATUS_VALUES,
  TRIGGER_TYPE_VALUES,
  ACTION_TYPE,
  CONDITION_LOGIC,
  EXECUTION_STATUS,
  TERMINAL_ACTIONS,
  SEARCHABLE_FIELDS,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './automationRules.constants.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function escapeRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status)  filter.status = query.status;
  if (query.trigger) filter['trigger.type'] = query.trigger;

  // Default: only show non-deleted rules unless caller explicitly asks
  if (query.active !== undefined) {
    filter.isActive = query.active === true || query.active === 'true';
  } else {
    filter.isActive = true;
  }

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = SEARCHABLE_FIELDS.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  if (!sort) return { priority: -1, createdAt: -1 };
  const desc = sort.startsWith('-');
  const key  = desc ? sort.slice(1) : sort;
  const valid = ['createdAt', 'updatedAt', 'priority', 'executionCount', 'name'];
  return valid.includes(key) ? { [key]: desc ? -1 : 1 } : { priority: -1, createdAt: -1 };
}

function paging(query = {}) {
  const page  = Math.max(Number(query.page)  || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

// ── Condition evaluator ────────────────────────────────────────────────────────

/**
 * Safely read a nested path like "lead.score" from a context object.
 */
function getFieldValue(context = {}, fieldPath = '') {
  return fieldPath.split('.').reduce((obj, key) => (obj != null ? obj[key] : undefined), context);
}

/**
 * Evaluate a single condition against the execution context.
 * Returns true if the condition is satisfied.
 */
function evaluateCondition(condition, context) {
  const actual   = getFieldValue(context, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'EQUALS':       return actual == expected;
    case 'NOT_EQUALS':   return actual != expected;
    case 'GREATER_THAN': return Number(actual) > Number(expected);
    case 'LESS_THAN':    return Number(actual) < Number(expected);
    case 'CONTAINS':     return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'NOT_CONTAINS': return !String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'EXISTS':       return actual !== undefined && actual !== null;
    case 'NOT_EXISTS':   return actual === undefined || actual === null;
    case 'IN':           return Array.isArray(expected) && expected.includes(actual);
    case 'NOT_IN':       return !Array.isArray(expected) || !expected.includes(actual);
    case 'STARTS_WITH':  return String(actual ?? '').startsWith(String(expected ?? ''));
    case 'ENDS_WITH':    return String(actual ?? '').endsWith(String(expected ?? ''));
    default:             return false;
  }
}

/**
 * Evaluate all conditions using AND or OR logic.
 * Empty conditions array → always passes.
 */
function evaluateConditions(conditions = [], logic = CONDITION_LOGIC.AND, context = {}) {
  if (!conditions.length) return { passed: true, reason: 'no conditions — always passes' };

  const results = conditions.map((c) => ({
    field:    c.field,
    operator: c.operator,
    value:    c.value,
    passed:   evaluateCondition(c, context),
  }));

  const passed = logic === CONDITION_LOGIC.OR
    ? results.some((r) => r.passed)
    : results.every((r) => r.passed);

  return { passed, results };
}

// ── Action handlers (pluggable) ────────────────────────────────────────────────
//
// Each handler receives (action, context, logs[]) and returns { success, message }.
// Replace the stub with a real service call when you're ready to integrate.
//
// ctx is the automation execution context:
//   { tenantId, userId, leadId, contactId, campaignId, lead, contact, ... }

/**
 * Blocks the classic SSRF targets before CALL_WEBHOOK is allowed to fetch
 * a user-configured URL server-side: internal/private IP ranges (RFC1918,
 * loopback, link-local -- which is how cloud metadata endpoints like
 * 169.254.169.254 get reached), and non-http(s) schemes. This is a
 * necessary baseline, not exhaustive DNS-rebinding protection (an
 * attacker controlling DNS could still change the answer between this
 * check and the actual fetch) -- good enough to stop the common,
 * accidental case (someone pastes an internal URL) and the obvious
 * attack, not a substitute for network-level egress controls in a real
 * production deployment.
 */
function isPrivateOrReservedIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata endpoint
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

async function assertSafeWebhookUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('Invalid webhook URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http:// or https:// webhook URLs are allowed');
  }
  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) {
    throw new Error('Localhost/internal hostnames are not allowed');
  }
  let addresses;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname "${parsed.hostname}"`);
  }
  const blocked = addresses.find(({ address }) => isPrivateOrReservedIp(address));
  if (blocked) {
    throw new Error(`"${parsed.hostname}" resolves to a private/internal IP address (${blocked.address}) -- blocked`);
  }
  return parsed;
}

const ACTION_HANDLERS = {
  [ACTION_TYPE.SEND_TEMPLATE]: async (action, ctx, logs) => {
    const templateId = action.params?.templateId;
    if (!templateId) return { success: false, message: 'No templateId configured on this action' };
    if (!ctx.leadId) return { success: false, message: 'No lead in this execution context to send to' };
    if (ctx.dryRun) {
      logs.push(`[SEND_TEMPLATE] templateId=${templateId} lead=${ctx.leadId} → simulated (dry run)`);
      return { success: true, message: `Template ${templateId} would be sent to lead ${ctx.leadId} (dry run -- nothing actually sent)` };
    }

    const [template, lead] = await Promise.all([
      templatesRepository.findById(ctx.tenantId, templateId),
      leadRepository.findById(ctx.tenantId, ctx.leadId),
    ]);
    if (!template) return { success: false, message: `Template ${templateId} not found` };
    if (!lead) return { success: false, message: `Lead ${ctx.leadId} not found` };

    // Reuses the exact same consent-checked, fully-logged send path as
    // Campaigns/Broadcasts/manual sends (sendToOneRecipient in
    // messageSender.js) -- cfg/entity omitted since this isn't a
    // Campaign or Broadcast, just a standalone automation-triggered send.
    const result = await sendToOneRecipient(ctx, { template, lead });
    logs.push(`[SEND_TEMPLATE] templateId=${templateId} lead=${ctx.leadId} -> ${result.outcome}`);
    return {
      success: result.outcome === 'sent',
      message: result.outcome === 'sent'
        ? `Template ${template.name} sent`
        : `Template ${template.name} not sent: ${result.reason || result.outcome}`,
    };
  },

  [ACTION_TYPE.START_NURTURE]: async (action, ctx, logs) => {
    const sequenceId = action.params?.sequenceId;
    if (!sequenceId) return { success: false, message: 'No sequenceId configured on this action' };
    if (!ctx.leadId) return { success: false, message: 'No lead in this execution context to enroll' };
    if (ctx.dryRun) {
      logs.push(`[START_NURTURE] sequenceId=${sequenceId} lead=${ctx.leadId} → simulated (dry run)`);
      return { success: true, message: `Lead ${ctx.leadId} would be enrolled in sequence ${sequenceId} (dry run -- nothing actually enrolled)` };
    }

    try {
      const enrollment = await nurturesService.enrollLead(ctx, sequenceId, { leadId: ctx.leadId });
      logs.push(`[START_NURTURE] sequenceId=${sequenceId} lead=${ctx.leadId} -> enrolled ${enrollment.id}`);
      return { success: true, message: `Enrolled in nurture sequence ${sequenceId}` };
    } catch (err) {
      // Real, non-fatal case: e.g. already enrolled (enrollLead's own
      // duplicate-prevention correctly rejects that) -- not a real failure.
      logs.push(`[START_NURTURE] sequenceId=${sequenceId} lead=${ctx.leadId} -> ${err.message}`);
      return { success: false, message: err.message };
    }
  },

  [ACTION_TYPE.STOP_NURTURE]: async (action, ctx, logs) => {
    const sequenceId = action.params?.sequenceId;
    if (!sequenceId) return { success: false, message: 'No sequenceId configured on this action' };
    if (!ctx.leadId) return { success: false, message: 'No lead in this execution context' };
    if (ctx.dryRun) {
      logs.push(`[STOP_NURTURE] sequenceId=${sequenceId} lead=${ctx.leadId} → simulated (dry run)`);
      return { success: true, message: `Lead ${ctx.leadId}'s enrollment in sequence ${sequenceId} would be cancelled (dry run)` };
    }

    const enrollment = await nurturesRepository.findActiveEnrollmentByLeadAndSequence(ctx.tenantId, sequenceId, ctx.leadId);
    if (!enrollment) {
      logs.push(`[STOP_NURTURE] sequenceId=${sequenceId} lead=${ctx.leadId} -> no active enrollment, nothing to stop`);
      return { success: true, message: 'No active enrollment for this lead in that sequence -- nothing to stop' };
    }

    await nurturesService.cancelEnrollment(ctx, String(enrollment._id), { comment: `Stopped by automation rule "${ctx.ruleName || ''}"`.trim() });
    logs.push(`[STOP_NURTURE] sequenceId=${sequenceId} lead=${ctx.leadId} -> cancelled enrollment ${enrollment._id}`);
    return { success: true, message: 'Nurture enrollment cancelled' };
  },

  [ACTION_TYPE.SEND_BROADCAST]: async (action, ctx, logs) => {
    // Not wired -- Broadcasts target a whole audience query, not a single
    // lead/contact, so "send this broadcast because this one lead's rule
    // fired" doesn't map cleanly onto the existing Broadcast model
    // without real product decisions this pass doesn't make. Left
    // simulated rather than guessed at.
    logs.push(`[SEND_BROADCAST] broadcastId=${action.params?.broadcastId} → simulated (not yet wired)`);
    return { success: true, message: `Broadcast ${action.params?.broadcastId || '(none)'} would be sent (simulated)` };
  },

  [ACTION_TYPE.GENERATE_AI_REPLY]: async (action, ctx, logs) => {
    if (!ctx.contactId) return { success: false, message: 'No conversation in this execution context (needs contactId)' };
    if (ctx.dryRun) {
      logs.push(`[GENERATE_AI_REPLY] goal=${action.params?.goal} conversation=${ctx.contactId} → simulated (dry run)`);
      return { success: true, message: `AI reply would be generated for goal: ${action.params?.goal || 'general'} (dry run)` };
    }

    const conversation = await conversationRepository.findById(ctx.tenantId, ctx.contactId);
    if (!conversation) return { success: false, message: `Conversation ${ctx.contactId} not found` };
    const [history, lead] = await Promise.all([
      messageRepository.findMostRecent(ctx.tenantId, ctx.contactId, 20),
      ctx.leadId ? leadRepository.findById(ctx.tenantId, ctx.leadId) : null,
    ]);

    // Deliberately does NOT auto-send: an unreviewed AI-generated message
    // going out to a real customer with zero human check is a real
    // reputational/compliance risk (wrong tone, hallucinated claim,
    // promising something the business can't deliver). Saved as a note
    // instead -- exactly the same "suggestion, human sends it" model the
    // AI Reply Assistant tab already uses for its manual button.
    try {
      const result = await aiReplyAssistantService.generateReply(ctx, {
        conversation: history,
        lead: lead || {},
        goal: action.params?.goal || 'continue the conversation naturally and helpfully',
        tone: action.params?.tone || 'Professional',
        language: action.params?.language || 'en',
      });

      if (ctx.leadId) {
        await noteService.addNote(ctx, ctx.leadId, `[AI-suggested reply] ${result.generatedReply}`);
      }
      logs.push(`[GENERATE_AI_REPLY] conversation=${ctx.contactId} -> generated (${result.provider}, live=${result.isLive ?? false})`);
      return { success: true, message: `AI reply drafted and added as a note for review: "${result.generatedReply.slice(0, 80)}${result.generatedReply.length > 80 ? '…' : ''}"` };
    } catch (err) {
      logs.push(`[GENERATE_AI_REPLY] conversation=${ctx.contactId} -> failed: ${err.message}`);
      return { success: false, message: `AI reply generation failed: ${err.message}` };
    }
  },

  [ACTION_TYPE.ASSIGN_USER]: async (action, ctx, logs) => {
    const userId = action.params?.userId;
    if (!userId) return { success: false, message: 'No userId configured on this action' };
    if (!ctx.leadId) return { success: false, message: 'No lead in this execution context' };
    if (ctx.dryRun) {
      logs.push(`[ASSIGN_USER] userId=${userId} lead=${ctx.leadId} → simulated (dry run)`);
      return { success: true, message: `Lead ${ctx.leadId} would be assigned to user ${userId} (dry run)` };
    }

    await leadRepository.updateById(ctx.tenantId, ctx.leadId, { assigned_user_id: userId });
    logs.push(`[ASSIGN_USER] userId=${userId} lead=${ctx.leadId}`);
    return { success: true, message: `Lead assigned to user ${userId}` };
  },

  [ACTION_TYPE.CHANGE_PIPELINE_STAGE]: async (action, ctx, logs) => {
    const stage = action.params?.stage;
    if (!stage) return { success: false, message: 'No stage configured on this action' };
    if (!ctx.dealId) return { success: false, message: 'No deal in this execution context (this trigger doesn\'t carry a dealId)' };
    if (ctx.dryRun) {
      logs.push(`[CHANGE_PIPELINE_STAGE] stage=${stage} deal=${ctx.dealId} → simulated (dry run)`);
      return { success: true, message: `Deal ${ctx.dealId} would move to stage ${stage} (dry run)` };
    }

    try {
      // Dynamic import -- see the top-of-file note on why this can't be
      // a static import (circular dependency with deal.service.js).
      const { dealService } = await import('../../../pipeline/deals/deal.service.js');
      await dealService.moveStage(ctx, ctx.dealId, stage);
      logs.push(`[CHANGE_PIPELINE_STAGE] stage=${stage} deal=${ctx.dealId} -> moved`);
      return { success: true, message: `Deal moved to stage ${stage}` };
    } catch (err) {
      logs.push(`[CHANGE_PIPELINE_STAGE] stage=${stage} deal=${ctx.dealId} -> failed: ${err.message}`);
      return { success: false, message: err.message };
    }
  },

  [ACTION_TYPE.ADD_TAG]: async (action, ctx, logs) => {
    const tag = action.params?.tag;
    if (!tag) return { success: false, message: 'No tag configured on this action' };
    if (!ctx.leadId) return { success: false, message: 'No lead in this execution context' };
    if (ctx.dryRun) {
      logs.push(`[ADD_TAG] tag="${tag}" lead=${ctx.leadId} → simulated (dry run)`);
      return { success: true, message: `Tag "${tag}" would be added (dry run)` };
    }

    await leadRepository.addTag(ctx.tenantId, ctx.leadId, tag);
    logs.push(`[ADD_TAG] tag="${tag}" lead=${ctx.leadId}`);
    return { success: true, message: `Tag "${tag}" added` };
  },

  [ACTION_TYPE.REMOVE_TAG]: async (action, ctx, logs) => {
    const tag = action.params?.tag;
    if (!tag) return { success: false, message: 'No tag configured on this action' };
    if (!ctx.leadId) return { success: false, message: 'No lead in this execution context' };
    if (ctx.dryRun) {
      logs.push(`[REMOVE_TAG] tag="${tag}" lead=${ctx.leadId} → simulated (dry run)`);
      return { success: true, message: `Tag "${tag}" would be removed (dry run)` };
    }

    await leadRepository.removeTag(ctx.tenantId, ctx.leadId, tag);
    logs.push(`[REMOVE_TAG] tag="${tag}" lead=${ctx.leadId}`);
    return { success: true, message: `Tag "${tag}" removed` };
  },

  [ACTION_TYPE.CREATE_TASK]: async (action, ctx, logs) => {
    // Not wired -- there is no Task model/module anywhere in this
    // codebase yet (checked: only Bookings/Calls/Qualification exist as
    // schedulable-work concepts). Building one is a real feature, not
    // something to improvise inside an action handler. Left simulated.
    logs.push(`[CREATE_TASK] title=${action.params?.title} → simulated (no Task model exists yet)`);
    return { success: true, message: `Task "${action.params?.title || 'Untitled'}" would be created (simulated -- no Task feature exists yet)` };
  },

  [ACTION_TYPE.CREATE_NOTE]: async (action, ctx, logs) => {
    const text = action.params?.text;
    if (!text) return { success: false, message: 'No note text configured on this action' };
    if (!ctx.leadId) return { success: false, message: 'No lead in this execution context' };
    if (ctx.dryRun) {
      logs.push(`[CREATE_NOTE] lead=${ctx.leadId} → simulated (dry run)`);
      return { success: true, message: 'Note would be added to lead (dry run)' };
    }

    await noteService.addNote(ctx, ctx.leadId, text);
    logs.push(`[CREATE_NOTE] lead=${ctx.leadId} text="${String(text).slice(0, 50)}"`);
    return { success: true, message: 'Note added to lead' };
  },

  [ACTION_TYPE.NOTIFY_USER]: async (action, ctx, logs) => {
    const userId = action.params?.userId;
    const message = action.params?.message;
    if (!userId || !message) return { success: false, message: 'userId and message are both required on this action' };
    if (ctx.dryRun) {
      logs.push(`[NOTIFY_USER] userId=${userId} → simulated (dry run)`);
      return { success: true, message: `User ${userId} would be notified (dry run)` };
    }

    await notificationService.createNotification({
      tenantId: ctx.tenantId,
      userId,
      title: 'Automation rule notification',
      body: message,
      metadata: { source: 'automation_rule', leadId: ctx.leadId || null },
    });
    logs.push(`[NOTIFY_USER] userId=${userId} message="${message}"`);
    return { success: true, message: `User ${userId} notified` };
  },

  [ACTION_TYPE.SEND_EMAIL]: async (action, ctx, logs) => {
    const subject = action.params?.subject;
    const body = action.params?.body || action.params?.html;
    if (!subject || !body) return { success: false, message: 'subject and body are both required on this action' };

    let to = action.params?.to;
    if (!to && ctx.leadId) {
      const lead = await leadRepository.findById(ctx.tenantId, ctx.leadId);
      to = lead?.email || null;
    }
    if (!to) return { success: false, message: 'No recipient email configured, and the lead in context has none on file' };

    if (ctx.dryRun) {
      logs.push(`[SEND_EMAIL] to=${to} subject=${subject} → simulated (dry run)`);
      return { success: true, message: `Email would be sent to ${to} (dry run)` };
    }

    try {
      await sendCustomEmail({ to, subject, html: body });
      logs.push(`[SEND_EMAIL] to=${to} subject=${subject} -> sent`);
      return { success: true, message: `Email sent to ${to}` };
    } catch (err) {
      logs.push(`[SEND_EMAIL] to=${to} subject=${subject} -> failed: ${err.message}`);
      return { success: false, message: `Email failed to send: ${err.message}` };
    }
  },

  [ACTION_TYPE.CALL_WEBHOOK]: async (action, ctx, logs) => {
    const url = action.params?.url;
    if (!url) return { success: false, message: 'No url configured on this action' };
    if (ctx.dryRun) {
      logs.push(`[CALL_WEBHOOK] url=${url} → simulated (dry run)`);
      return { success: true, message: `Webhook ${url} would be called (dry run)` };
    }

    try {
      const parsed = await assertSafeWebhookUrl(url);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s -- a hung external endpoint must never stall the rule engine indefinitely
      let response;
      try {
        response = await fetch(parsed, {
          method: action.params?.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'automation_rule',
            leadId: ctx.leadId || null,
            payload: action.params?.body || {},
          }).slice(0, 100_000), // 100KB cap -- a rule config field is never a legitimate reason to send more than that
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      logs.push(`[CALL_WEBHOOK] url=${url} -> HTTP ${response.status}`);
      return { success: response.ok, message: `Webhook responded with HTTP ${response.status}` };
    } catch (err) {
      logs.push(`[CALL_WEBHOOK] url=${url} -> blocked/failed: ${err.message}`);
      return { success: false, message: err.message };
    }
  },

  [ACTION_TYPE.WAIT]: async (action, ctx, logs) => {
    const { delayValue = 0, delayUnit = 'minutes' } = action;
    logs.push(`[WAIT] ${delayValue} ${delayUnit} (simulated — skipped in manual run)`);
    return { success: true, message: `Wait of ${delayValue} ${delayUnit} would be applied` };
  },

  [ACTION_TYPE.END_WORKFLOW]: async (action, ctx, logs) => {
    logs.push(`[END_WORKFLOW] sequence terminated`);
    return { success: true, message: `Workflow ended` };
  },
};

// ── Execution engine ───────────────────────────────────────────────────────────

/**
 * Execute a single rule against an execution context.
 * Returns a structured result that is persisted as AutomationRuleHistory.
 *
 * @param {object} rule     - AutomationRule document
 * @param {object} execCtx  - { tenantId, userId, leadId, contactId, campaignId, lead, contact, ... }
 */
async function executeRule(rule, execCtx) {
  const startedAt = new Date();
  const logs      = [];
  const actionLogs = [];
  let actionsExecuted = 0;
  let overallStatus   = EXECUTION_STATUS.SUCCESS;
  let errorMessage    = null;

  // Sort actions by order field.
  const sortedActions = [...(rule.actions || [])].sort((a, b) => a.order - b.order);

  try {
    for (const action of sortedActions) {
      const actionStart = Date.now();
      const handler = ACTION_HANDLERS[action.type];

      if (!handler) {
        logs.push(`[SKIP] no handler for action type: ${action.type}`);
        actionLogs.push({
          order: action.order,
          type:  action.type,
          status: EXECUTION_STATUS.SKIPPED,
          message: 'No handler registered',
          durationMs: 0,
        });
        continue;
      }

      let actionStatus  = EXECUTION_STATUS.SUCCESS;
      let actionMessage = '';

      try {
        const result  = await handler(action, execCtx, logs);
        actionMessage = result.message || '';
        if (!result.success) {
          actionStatus  = EXECUTION_STATUS.FAILED;
          overallStatus = EXECUTION_STATUS.PARTIAL;
        }
      } catch (err) {
        actionStatus  = EXECUTION_STATUS.FAILED;
        overallStatus = EXECUTION_STATUS.PARTIAL;
        actionMessage = err.message || 'Action failed';
        logs.push(`[ERROR] ${action.type}: ${actionMessage}`);
      }

      actionLogs.push({
        order:      action.order,
        type:       action.type,
        status:     actionStatus,
        message:    actionMessage,
        durationMs: Date.now() - actionStart,
      });

      if (actionStatus === EXECUTION_STATUS.SUCCESS) actionsExecuted += 1;

      // Stop on terminal action.
      if (TERMINAL_ACTIONS.includes(action.type)) {
        logs.push(`[STOP] terminal action "${action.type}" — workflow ended`);
        break;
      }
    }
  } catch (fatalErr) {
    overallStatus = EXECUTION_STATUS.FAILED;
    errorMessage  = fatalErr.message || 'Unexpected engine error';
    logs.push(`[FATAL] ${errorMessage}`);
  }

  const completedAt = new Date();
  const duration    = completedAt - startedAt;

  return {
    status:          overallStatus,
    actionsExecuted,
    actionLogs,
    startedAt,
    completedAt,
    duration,
    error:           errorMessage,
    logs,
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

export const automationRulesService = {
  // ── Rule CRUD ──────────────────────────────────────────────────────────────

  async createRule(ctx, data) {
    if (!TRIGGER_TYPE_VALUES.includes(data?.trigger?.type)) {
      throw new AppError(400, `trigger.type must be one of: ${TRIGGER_TYPE_VALUES.join(', ')}`);
    }
    const rule = await automationRulesRepository.createRule({
      ...data,
      tenantId:  ctx.tenantId,
      status:    data.status || RULE_STATUS.DRAFT,
      isActive:  true,
      executionCount: 0,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    return toDTO(rule);
  },

  async getRule(ctx, id) {
    const rule = await automationRulesRepository.findById(ctx.tenantId, id);
    if (!rule) throw new AppError(404, 'Automation rule not found');
    return toDTO(rule);
  },

  async listRules(ctx, query) {
    const filter = buildFilter(query);
    const sort   = buildSort(query.sort);
    const { page, limit, skip } = paging(query);
    const [items, total] = await Promise.all([
      automationRulesRepository.listRules(ctx.tenantId, filter, { sort, skip, limit }),
      automationRulesRepository.countRules(ctx.tenantId, filter),
    ]);
    return {
      data: items.map(toDTO),
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  async updateRule(ctx, id, patch) {
    const existing = await automationRulesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Automation rule not found');
    if (existing.status === RULE_STATUS.ARCHIVED) {
      throw new AppError(409, 'Archived rules are read-only');
    }
    if (patch?.trigger?.type && !TRIGGER_TYPE_VALUES.includes(patch.trigger.type)) {
      throw new AppError(400, `trigger.type "${patch.trigger.type}" is not valid`);
    }
    patch.updatedBy = ctx.userId;
    const updated = await automationRulesRepository.updateRule(ctx.tenantId, id, patch);
    return toDTO(updated);
  },

  async deleteRule(ctx, id) {
    const existing = await automationRulesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Automation rule not found');
    await automationRulesRepository.softDeleteRule(ctx.tenantId, id);
    return { id: String(existing._id), deleted: true };
  },

  async duplicateRule(ctx, id) {
    const source = await automationRulesRepository.findById(ctx.tenantId, id);
    if (!source) throw new AppError(404, 'Automation rule not found');
    const src   = source.toObject ? source.toObject() : source;
    const clone = await automationRulesRepository.createRule({
      tenantId:       ctx.tenantId,
      name:           `${src.name} (Copy)`,
      description:    src.description,
      trigger:        src.trigger,
      conditions:     src.conditions,
      conditionLogic: src.conditionLogic,
      actions:        src.actions,
      status:         RULE_STATUS.DRAFT,   // copies always start as DRAFT
      priority:       src.priority,
      executionMode:  src.executionMode,
      delay:          src.delay,
      isActive:       true,
      executionCount: 0,
      createdBy:      ctx.userId,
      updatedBy:      ctx.userId,
    });
    return toDTO(clone);
  },

  async toggleRule(ctx, id) {
    const existing = await automationRulesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Automation rule not found');
    if (existing.status === RULE_STATUS.ARCHIVED) {
      throw new AppError(409, 'Archived rules cannot be toggled');
    }
    const isNowActive = existing.status !== RULE_STATUS.ACTIVE;
    const newStatus   = isNowActive ? RULE_STATUS.ACTIVE : RULE_STATUS.PAUSED;
    const updated     = await automationRulesRepository.toggleRule(ctx.tenantId, id, newStatus, isNowActive);
    return toDTO(updated);
  },

  // ── Manual run / simulate ──────────────────────────────────────────────────

  async runRule(ctx, id, payload = {}) {
    const rule = await automationRulesRepository.findById(ctx.tenantId, id);
    if (!rule) throw new AppError(404, 'Automation rule not found');

    // Build execution context from payload + auth context.
    const execCtx = {
      tenantId:   ctx.tenantId,
      userId:     ctx.userId,
      leadId:     payload.leadId     || null,
      contactId:  payload.contactId  || null,
      campaignId: payload.campaignId || null,
      lead:       payload.lead       || {},
      contact:    payload.contact    || {},
      ruleName:   rule.name,
      // Real actions (SEND_TEMPLATE, START_NURTURE, ASSIGN_USER, etc.)
      // now genuinely send messages / write data -- a "Run" button click
      // to test a rule must NOT silently message a real customer or
      // reassign a real lead. Defaults to dry-run (matches the always-safe
      // behaviour this button had before real handlers existed);
      // payload.live === true is the one explicit way to actually
      // execute for real from this manual-run path.
      dryRun:     payload.live !== true,
    };

    // Evaluate conditions if provided.
    let conditionResult = { passed: true, reason: 'manual run — conditions evaluated' };
    if (rule.conditions?.length && Object.keys(execCtx.lead).length) {
      conditionResult = evaluateConditions(rule.conditions, rule.conditionLogic, execCtx.lead);
    }

    const result = await executeRule(rule, execCtx);

    // Persist history.
    const historyDoc = await automationRulesRepository.saveHistory({
      automationId:    rule._id,
      tenantId:        ctx.tenantId,
      trigger:         rule.trigger?.type || 'MANUAL_RUN',
      leadId:          execCtx.leadId,
      contactId:       execCtx.contactId,
      campaignId:      execCtx.campaignId,
      status:          result.status,
      actionsExecuted: result.actionsExecuted,
      actionLogs:      result.actionLogs,
      startedAt:       result.startedAt,
      completedAt:     result.completedAt,
      duration:        result.duration,
      error:           result.error,
      logs:            result.logs,
    });

    // Update rule counters.
    await automationRulesRepository.incrementExecutionCount(ctx.tenantId, id, result.completedAt);

    return {
      success:          result.status !== EXECUTION_STATUS.FAILED,
      status:           result.status,
      conditionsPassed: conditionResult.passed,
      actionsExecuted:  result.actionsExecuted,
      executionTime:    result.duration,
      logs:             result.logs,
      actionLogs:       result.actionLogs,
      failureReason:    result.error || null,
      historyId:        String(historyDoc._id),
    };
  },

  // ── Execution history ──────────────────────────────────────────────────────

  async getHistory(ctx, id, query = {}) {
    const rule = await automationRulesRepository.findById(ctx.tenantId, id);
    if (!rule) throw new AppError(404, 'Automation rule not found');

    const { page, limit, skip } = paging(query);
    const [items, total] = await Promise.all([
      automationRulesRepository.listHistory(ctx.tenantId, id, { skip, limit }),
      automationRulesRepository.countHistory(ctx.tenantId, id),
    ]);

    return {
      data: items.map(toDTO),
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  // ── Trigger dispatch (called by other modules when events fire) ────────────
  /**
   * Process all active rules for a given trigger type.
   * Other modules call this when an event occurs.
   *
   * Example:
   *   import { automationRulesService } from '../automationRules/automationRules.service.js';
   *   await automationRulesService.dispatch(ctx, 'LEAD_QUALIFIED', { lead, leadId: lead._id });
   */
  async dispatch(ctx, triggerType, payload = {}) {
    const rules = await automationRulesRepository.findActiveByTrigger(ctx.tenantId, triggerType);
    const results = [];

    for (const rule of rules) {
      try {
        const conditionResult = evaluateConditions(
          rule.conditions, rule.conditionLogic, payload,
        );
        if (!conditionResult.passed) {
          results.push({ ruleId: String(rule._id), skipped: true, reason: 'conditions not met' });
          continue;
        }
        const result = await executeRule(rule, { ...ctx, ...payload, dryRun: false });
        await automationRulesRepository.saveHistory({
          automationId:    rule._id,
          tenantId:        ctx.tenantId,
          trigger:         triggerType,
          leadId:          payload.leadId     || null,
          contactId:       payload.contactId  || null,
          campaignId:      payload.campaignId || null,
          status:          result.status,
          actionsExecuted: result.actionsExecuted,
          actionLogs:      result.actionLogs,
          startedAt:       result.startedAt,
          completedAt:     result.completedAt,
          duration:        result.duration,
          error:           result.error,
          logs:            result.logs,
        });
        await automationRulesRepository.incrementExecutionCount(ctx.tenantId, String(rule._id), result.completedAt);
        results.push({ ruleId: String(rule._id), status: result.status });
      } catch (err) {
        results.push({ ruleId: String(rule._id), error: err.message });
      }
    }

    return results;
  },
};