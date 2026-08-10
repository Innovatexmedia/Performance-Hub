import { asyncHandler } from '../../../shared/helpers/lead.helpers.js';
import { groupService } from './group.service.js';

export const groupController = {
  // POST /api/leads/groups
  create: asyncHandler(async (req, res) => {
    const group = await groupService.createGroup(req.context, req.body);
    res.status(201).json(group);
  }),

  // GET /api/leads/groups
  list: asyncHandler(async (req, res) => {
    const groups = await groupService.listGroups(req.context);
    res.json({ data: groups });
  }),

  // GET /api/leads/groups/:id
  get: asyncHandler(async (req, res) => {
    const group = await groupService.getGroup(req.context, req.params.id);
    res.json(group);
  }),

  // PATCH /api/leads/groups/:id
  update: asyncHandler(async (req, res) => {
    const group = await groupService.updateGroup(req.context, req.params.id, req.body);
    res.json(group);
  }),

  // DELETE /api/leads/groups/:id
  remove: asyncHandler(async (req, res) => {
    const result = await groupService.deleteGroup(req.context, req.params.id);
    res.json(result);
  }),

  // POST /api/leads/groups/:id/assign
  assign: asyncHandler(async (req, res) => {
    const result = await groupService.assignMembers(req.context, req.params.id, req.body.leadIds);
    res.json(result);
  }),

  // PUT /api/leads/groups/:id/members -- full reconciliation (checklist UI)
  setMembers: asyncHandler(async (req, res) => {
    const result = await groupService.setMembers(req.context, req.params.id, req.body.leadIds);
    res.json(result);
  }),
};