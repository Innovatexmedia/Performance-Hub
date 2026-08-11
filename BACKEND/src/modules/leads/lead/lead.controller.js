import { asyncHandler } from '../../../shared/helpers/lead.helpers.js';
import { leadService } from './lead.service.js';
import { toLeadDTO } from '../../../shared/mappers/lead.mappers.js';

import {
  LEAD_STATUS,
  LEAD_TEMPERATURE,
  CONSENT_STATUS,
} from './lead.constants.js';

export const leadController = {
  // POST /api/leads
  create: asyncHandler(async (req, res) => {
    const lead = await leadService.createLead(req.context, req.body);
    res.status(201).json(toLeadDTO(lead));
  }),

  // GET /api/leads
  list: asyncHandler(async (req, res) => {
    const result = await leadService.getLeads(req.context, req.query);
    res.json(result);
  }),

  // GET /api/leads/:id
  get: asyncHandler(async (req, res) => {
    const lead = await leadService.getLead(req.context, req.params.id);
    res.json(toLeadDTO(lead));
  }),

  // PATCH /api/leads/:id
  update: asyncHandler(async (req, res) => {
    const lead = await leadService.updateLead(
      req.context,
      req.params.id,
      req.body,
    );
    res.json(toLeadDTO(lead));
  }),

  // DELETE /api/leads/:id  (archive)
  archive: asyncHandler(async (req, res) => {
    const lead = await leadService.archiveLead(req.context, req.params.id);
    res.json({ message: 'Lead archived', lead: toLeadDTO(lead) });
  }),

  // POST /api/leads/:id/restore  (un-archive)
  restore: asyncHandler(async (req, res) => {
    const lead = await leadService.unarchiveLead(req.context, req.params.id);
    res.json({ message: 'Lead restored', lead: toLeadDTO(lead) });
  }),

  // GET /api/leads/:id/details  (drawer)
  details: asyncHandler(async (req, res) => {
    const details = await leadService.getLeadDetails(
      req.context,
      req.params.id,
    );
    res.json(details);
  }),

  // GET /api/leads/constants
  constants: asyncHandler(async (_req, res) => {
    res.json({
      statuses: Object.values(LEAD_STATUS),
      temperatures: Object.values(LEAD_TEMPERATURE),
      consentStatuses: Object.values(CONSENT_STATUS),
    });
  }),
};