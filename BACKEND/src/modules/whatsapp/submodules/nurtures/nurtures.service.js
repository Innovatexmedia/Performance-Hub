/**
 * WhatsApp Nurtures — service.
 *
 * Manages both NurtureSequence and NurtureEnrollment lifecycle.
 * Template validation delegates to templateApprovalService.assertUsable.
 * nextExecutionAt is calculated from the step delay at enrol / resume time.
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { activityService } from '../../../leads/activities/activity.service.js';
import { ACTIVITY_TYPE }   from '../../../leads/activities/activity.model.js';
import { templateApprovalService } from '../templateApproval/templateApproval.service.js';
import { nurturesRepository } from './nurtures.repository.js';
import {
  SEQUENCE_STATUS,
  SEQUENCE_ACTION,
  SEQUENCE_ALLOWED_TRANSITIONS,
  SEQUENCE_READ_ONLY_STATUSES,
  ENROLLMENT_STATUS,
  ENROLLMENT_ACTION,
  ENROLLMENT_ALLOWED_TRANSITIONS,
  DELAY_UNIT_MS,
  SEARCHABLE_FIELDS,
  SORTABLE_FIELDS,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './nurtures.constants.js';

const ENTITY_TYPE_SEQ  = 'whatsapp_nurture_sequence';
const ENTITY_TYPE_ENRL = 'whatsapp_nurture_enrollment';

// ── Helpers ────────────────────────────────────────────────────────────────────

function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function buildSeqAudit(fromStatus, toStatus, action, performedBy, comment = '') {
  return { fromStatus, toStatus, action, performedBy: performedBy ?? null, performedAt: new Date(), comment };
}

function buildEnrlAudit(fromStatus, toStatus, action, performedBy, comment = '') {
  return { fromStatus, toStatus, action, performedBy: performedBy ?? null, performedAt: new Date(), comment };
}

async function logSeq(ctx, seq, type, message, meta = {}) {
  await activityService.logEntity(
    ctx,
    { entityType: ENTITY_TYPE_SEQ, entityId: seq._id ?? seq.id },
    type,
    { message, meta: { sequenceId: String(seq._id ?? seq.id), ...meta } },
  );
}

async function logEnrl(ctx, enrl, type, message, meta = {}) {
  await activityService.logEntity(
    ctx,
    { entityType: ENTITY_TYPE_ENRL, entityId: enrl._id ?? enrl.id },
    type,
    { message, meta: { enrollmentId: String(enrl._id ?? enrl.id), sequenceId: String(enrl.sequenceId), ...meta } },
  );
}

/** Calculate when the next step should fire, starting from `base`. */
function calcNextExecution(base, delayValue, delayUnit) {
  const ms = (DELAY_UNIT_MS[delayUnit] || 0) * delayValue;
  return new Date(base.getTime() + ms);
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status)      filter.status = query.status;
  if (query.type)        filter.type = query.type;
  if (query.triggerType) filter.triggerType = query.triggerType;
  if (query.createdBy)   filter.createdBy = query.createdBy;
  if (query.isActive !== undefined)
    filter.isActive = query.isActive === true || query.isActive === 'true';
  if (query.startDate || query.endDate) {
    filter.createdAt = {};
    if (query.startDate) filter.createdAt.$gte = new Date(query.startDate);
    if (query.endDate)   filter.createdAt.$lte = new Date(query.endDate);
  }
  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = SEARCHABLE_FIELDS.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  if (!sort) return { createdAt: -1 };
  const desc = sort.startsWith('-');
  const key  = desc ? sort.slice(1) : sort;
  if (!SORTABLE_FIELDS.includes(key)) return { createdAt: -1 };
  return { [key]: desc ? -1 : 1 };
}

function paging(query = {}) {
  const page  = Math.max(Number(query.page)  || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

// ── Service ────────────────────────────────────────────────────────────────────

export const nurturesService = {
  // ── Validation helpers ───────────────────────────────────────────────────

  validateStatusTransition(fromStatus, toStatus) {
    const allowed = SEQUENCE_ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(409, `Invalid sequence transition: ${fromStatus} → ${toStatus}`);
    }
  },

  validateEnrollmentTransition(fromStatus, toStatus) {
    const allowed = ENROLLMENT_ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(409, `Invalid enrollment transition: ${fromStatus} → ${toStatus}`);
    }
  },

  /**
   * Validate that every active step has a PROVIDER_APPROVED template.
   * Returns the validated steps with templateName + approvalStatus snapshots.
   */
  async validateSteps(ctx, steps = []) {
    if (!steps.length) throw new AppError(400, 'Sequence must have at least one step');

    const numbers = steps.map((s) => s.stepNumber);
    if (new Set(numbers).size !== numbers.length) {
      throw new AppError(400, 'Step numbers must be unique within a sequence');
    }

    const validated = [];
    for (const step of steps) {
      if (!step.isActive) { validated.push(step); continue; }
      const template = await templateApprovalService.assertUsable(ctx, String(step.templateId));
      validated.push({
        ...step,
        templateName:   template.name || '',
        approvalStatus: template.approvalStatus || 'PROVIDER_APPROVED',
      });
    }
    return validated;
  },

  async validateTemplates(ctx, steps = []) {
    return this.validateSteps(ctx, steps);
  },

  // ── Sequence CRUD ────────────────────────────────────────────────────────

  async createSequence(ctx, data) {
    const steps    = await this.validateSteps(ctx, data.steps || []);
    const auditEntry = buildSeqAudit(null, SEQUENCE_STATUS.DRAFT, SEQUENCE_ACTION.CREATE, ctx.userId);

    const sequence = await nurturesRepository.createSequence({
      ...data,
      tenantId:   ctx.tenantId,
      steps,
      totalSteps: steps.filter((s) => s.isActive !== false).length,
      status:     SEQUENCE_STATUS.DRAFT,
      isActive:   false,
      auditLog:   [auditEntry],
      createdBy:  ctx.userId,
      updatedBy:  ctx.userId,
    });

    await logSeq(ctx, sequence, ACTIVITY_TYPE.WHATSAPP_NURTURE_CREATED,
      `Nurture sequence "${sequence.name}" created`);
    return toDTO(sequence);
  },

  async getSequence(ctx, id) {
    const seq = await nurturesRepository.findById(ctx.tenantId, id);
    if (!seq) throw new AppError(404, 'Nurture sequence not found');
    return toDTO(seq);
  },

  async listSequences(ctx, query) {
    const filter = buildFilter(query);
    const sort   = buildSort(query.sort);
    const { page, limit, skip } = paging(query);
    const [items, total] = await Promise.all([
      nurturesRepository.listSequences(ctx.tenantId, filter, { sort, skip, limit }),
      nurturesRepository.countSequences(ctx.tenantId, filter),
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

  async updateSequence(ctx, id, patch) {
    const existing = await nurturesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Nurture sequence not found');
    if (SEQUENCE_READ_ONLY_STATUSES.includes(existing.status)) {
      throw new AppError(409, `Sequence in ${existing.status} status is read-only`);
    }

    if (patch.steps !== undefined) {
      patch.steps      = await this.validateSteps(ctx, patch.steps);
      patch.totalSteps = patch.steps.filter((s) => s.isActive !== false).length;
    }

    patch.updatedBy = ctx.userId;
    const updated = await nurturesRepository.updateSequence(ctx.tenantId, id, patch);
    await logSeq(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_UPDATED,
      'Nurture sequence updated', { fields: Object.keys(patch) });
    return toDTO(updated);
  },

  async deleteSequence(ctx, id) {
    const existing = await nurturesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Nurture sequence not found');
    if (SEQUENCE_READ_ONLY_STATUSES.includes(existing.status)) {
      throw new AppError(409, `Sequence in ${existing.status} status cannot be deleted`);
    }
    await nurturesRepository.deleteSequence(ctx.tenantId, id);
    await logSeq(ctx, existing, ACTIVITY_TYPE.WHATSAPP_NURTURE_ARCHIVED,
      `Nurture sequence "${existing.name}" deleted`);
    return { id: String(existing._id), deleted: true };
  },

  // ── Sequence lifecycle ───────────────────────────────────────────────────

  async activateSequence(ctx, id, { comment = '' } = {}) {
    const existing = await nurturesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Nurture sequence not found');
    this.validateStatusTransition(existing.status, SEQUENCE_STATUS.ACTIVE);

    // Re-validate all active steps before going live.
    await this.validateSteps(ctx, existing.steps);

    if (!existing.steps.some((s) => s.isActive !== false)) {
      throw new AppError(400, 'Cannot activate sequence with no active steps');
    }

    const auditEntry = buildSeqAudit(existing.status, SEQUENCE_STATUS.ACTIVE, SEQUENCE_ACTION.ACTIVATE, ctx.userId, comment);
    const updated = await nurturesRepository.activateSequence(ctx.tenantId, id, {
      performedBy: ctx.userId, auditEntry,
    });
    await logSeq(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_ACTIVATED, 'Nurture sequence activated');
    return toDTO(updated);
  },

  async pauseSequence(ctx, id, { comment = '' } = {}) {
    const existing = await nurturesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Nurture sequence not found');
    this.validateStatusTransition(existing.status, SEQUENCE_STATUS.PAUSED);

    const auditEntry = buildSeqAudit(existing.status, SEQUENCE_STATUS.PAUSED, SEQUENCE_ACTION.PAUSE, ctx.userId, comment);
    const updated = await nurturesRepository.pauseSequence(ctx.tenantId, id, {
      performedBy: ctx.userId, auditEntry,
    });
    await logSeq(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_PAUSED, 'Nurture sequence paused', { comment });
    return toDTO(updated);
  },

  async archiveSequence(ctx, id, { comment = '' } = {}) {
    const existing = await nurturesRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Nurture sequence not found');
    this.validateStatusTransition(existing.status, SEQUENCE_STATUS.ARCHIVED);

    const auditEntry = buildSeqAudit(existing.status, SEQUENCE_STATUS.ARCHIVED, SEQUENCE_ACTION.ARCHIVE, ctx.userId, comment);
    const updated = await nurturesRepository.archiveSequence(ctx.tenantId, id, {
      performedBy: ctx.userId, auditEntry,
    });
    await logSeq(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_ARCHIVED, 'Nurture sequence archived', { comment });
    return toDTO(updated);
  },

  // ── Enrollment ───────────────────────────────────────────────────────────

  async enrollLead(ctx, sequenceId, { leadId, contactId } = {}) {
    if (!leadId && !contactId) {
      throw new AppError(400, 'leadId or contactId is required for enrollment');
    }

    const sequence = await nurturesRepository.findById(ctx.tenantId, sequenceId);
    if (!sequence) throw new AppError(404, 'Nurture sequence not found');
    if (sequence.status !== SEQUENCE_STATUS.ACTIVE) {
      throw new AppError(409, 'Only ACTIVE sequences accept new enrollments');
    }
    if (!sequence.steps.some((s) => s.isActive !== false)) {
      throw new AppError(400, 'Sequence has no active steps');
    }

    // Block duplicate active enrollments for the same lead.
    if (leadId) {
      const dup = await nurturesRepository.findActiveEnrollmentByLeadAndSequence(ctx.tenantId, sequenceId, leadId);
      if (dup) throw new AppError(409, 'Lead is already actively enrolled in this sequence');
    }

    // Calculate when step 1 should fire (from now + step 1 delay).
    const firstStep = sequence.steps
      .filter((s) => s.isActive !== false)
      .sort((a, b) => a.stepNumber - b.stepNumber)[0];

    const now             = new Date();
    const nextExecutionAt = calcNextExecution(now, firstStep.delayValue, firstStep.delayUnit);
    const auditEntry      = buildEnrlAudit(null, ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_ACTION.ENROLL, ctx.userId);

    let enrollment;
    try {
      enrollment = await nurturesRepository.createEnrollment({
        tenantId:        ctx.tenantId,
        sequenceId,
        leadId:          leadId || null,
        contactId:       contactId || null,
        currentStep:     firstStep.stepNumber,
        status:          ENROLLMENT_STATUS.ACTIVE,
        enrolledAt:      now,
        nextExecutionAt,
        auditLog:        [auditEntry],
      });
    } catch (err) {
      // Real DB-level dedup index catching a genuine race (two enroll
      // calls for the same lead+sequence landing concurrently) --
      // surfaced as the same clean error the earlier application-level
      // check already throws for the non-race case, not a raw Mongo error.
      if (err.code === 11000) {
        throw new AppError(409, 'Lead is already actively enrolled in this sequence');
      }
      throw err;
    }

    // Increment counters on the sequence document.
    await nurturesRepository.incrementEnrollmentCounter(ctx.tenantId, sequenceId, 'activeEnrollmentCount', 1);

    await logEnrl(ctx, enrollment, ACTIVITY_TYPE.WHATSAPP_NURTURE_ENROLLMENT_CREATED,
      'Lead enrolled in nurture sequence', { leadId, contactId, sequenceId });
    return toDTO(enrollment);
  },

  async getEnrollment(ctx, id) {
    const enrl = await nurturesRepository.findEnrollmentById(ctx.tenantId, id);
    if (!enrl) throw new AppError(404, 'Enrollment not found');
    return toDTO(enrl);
  },

  async listEnrollments(ctx, query) {
    const filter = {};
    if (query.sequenceId) filter.sequenceId = query.sequenceId;
    if (query.leadId)     filter.leadId = query.leadId;
    if (query.contactId)  filter.contactId = query.contactId;
    if (query.status)     filter.status = query.status;

    const { page, limit, skip } = paging(query);
    const sort = query.sort === 'enrolledAt' ? { enrolledAt: 1 } : { enrolledAt: -1 };

    const [items, total] = await Promise.all([
      nurturesRepository.listEnrollments(ctx.tenantId, filter, { sort, skip, limit }),
      nurturesRepository.countEnrollments(ctx.tenantId, filter),
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

  async pauseEnrollment(ctx, id, { comment = '' } = {}) {
    const enrl = await nurturesRepository.findEnrollmentById(ctx.tenantId, id);
    if (!enrl) throw new AppError(404, 'Enrollment not found');
    this.validateEnrollmentTransition(enrl.status, ENROLLMENT_STATUS.PAUSED);

    const auditEntry = buildEnrlAudit(enrl.status, ENROLLMENT_STATUS.PAUSED, ENROLLMENT_ACTION.PAUSE, ctx.userId, comment);
    const updated = await nurturesRepository.pauseEnrollment(ctx.tenantId, id, {
      performedBy: ctx.userId, auditEntry,
    });
    await nurturesRepository.incrementEnrollmentCounter(ctx.tenantId, String(enrl.sequenceId), 'activeEnrollmentCount', -1);
    await logEnrl(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_ENROLLMENT_PAUSED, 'Enrollment paused', { comment });
    return toDTO(updated);
  },

  async resumeEnrollment(ctx, id, { comment = '' } = {}) {
    const enrl = await nurturesRepository.findEnrollmentById(ctx.tenantId, id);
    if (!enrl) throw new AppError(404, 'Enrollment not found');
    this.validateEnrollmentTransition(enrl.status, ENROLLMENT_STATUS.ACTIVE);

    const sequence = await nurturesRepository.findById(ctx.tenantId, String(enrl.sequenceId));
    if (!sequence || sequence.status !== SEQUENCE_STATUS.ACTIVE) {
      throw new AppError(409, 'Cannot resume enrollment: parent sequence is not ACTIVE');
    }

    const step = sequence.steps.find((s) => s.stepNumber === enrl.currentStep && s.isActive !== false);
    const nextExecutionAt = step
      ? calcNextExecution(new Date(), step.delayValue, step.delayUnit)
      : new Date();

    const auditEntry = buildEnrlAudit(enrl.status, ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_ACTION.RESUME, ctx.userId, comment);
    const updated = await nurturesRepository.resumeEnrollment(ctx.tenantId, id, {
      performedBy: ctx.userId, nextExecutionAt, auditEntry,
    });
    await nurturesRepository.incrementEnrollmentCounter(ctx.tenantId, String(enrl.sequenceId), 'activeEnrollmentCount', 1);
    await logEnrl(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_ENROLLMENT_RESUMED, 'Enrollment resumed');
    return toDTO(updated);
  },

  async cancelEnrollment(ctx, id, { comment = '' } = {}) {
    const enrl = await nurturesRepository.findEnrollmentById(ctx.tenantId, id);
    if (!enrl) throw new AppError(404, 'Enrollment not found');
    this.validateEnrollmentTransition(enrl.status, ENROLLMENT_STATUS.CANCELLED);

    const auditEntry = buildEnrlAudit(enrl.status, ENROLLMENT_STATUS.CANCELLED, ENROLLMENT_ACTION.CANCEL, ctx.userId, comment);
    const updated = await nurturesRepository.cancelEnrollment(ctx.tenantId, id, {
      performedBy: ctx.userId, auditEntry,
    });

    if (enrl.status === ENROLLMENT_STATUS.ACTIVE) {
      await nurturesRepository.incrementEnrollmentCounter(ctx.tenantId, String(enrl.sequenceId), 'activeEnrollmentCount', -1);
    }
    await nurturesRepository.incrementEnrollmentCounter(ctx.tenantId, String(enrl.sequenceId), 'cancelledEnrollmentCount', 1);
    await logEnrl(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_ENROLLMENT_CANCELLED, 'Enrollment cancelled', { comment });
    return toDTO(updated);
  },

  async completeEnrollment(ctx, id, { comment = '' } = {}) {
    const enrl = await nurturesRepository.findEnrollmentById(ctx.tenantId, id);
    if (!enrl) throw new AppError(404, 'Enrollment not found');
    this.validateEnrollmentTransition(enrl.status, ENROLLMENT_STATUS.COMPLETED);

    const now        = new Date();
    const auditEntry = buildEnrlAudit(enrl.status, ENROLLMENT_STATUS.COMPLETED, ENROLLMENT_ACTION.COMPLETE, ctx.userId, comment);
    const updated = await nurturesRepository.completeEnrollment(ctx.tenantId, id, {
      performedBy: ctx.userId, now, auditEntry,
    });

    if (enrl.status === ENROLLMENT_STATUS.ACTIVE) {
      await nurturesRepository.incrementEnrollmentCounter(ctx.tenantId, String(enrl.sequenceId), 'activeEnrollmentCount', -1);
    }
    await nurturesRepository.incrementEnrollmentCounter(ctx.tenantId, String(enrl.sequenceId), 'completedEnrollmentCount', 1);
    await logEnrl(ctx, updated, ACTIVITY_TYPE.WHATSAPP_NURTURE_ENROLLMENT_COMPLETED, 'Enrollment completed');
    return toDTO(updated);
  },

  // ── nextExecutionAt calculation (exposed for automation module) ──────────
  calculateNextExecution(base, delayValue, delayUnit) {
    return calcNextExecution(base, delayValue, delayUnit);
  },
};