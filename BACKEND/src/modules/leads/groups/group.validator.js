import { AppError } from '../../../shared/helpers/lead.helpers.js';

function isString(v) {
  return typeof v === 'string';
}

export const validateCreateGroup = (req, _res, next) => {
  const body = req.body || {};
  const errors = [];

  if (!isString(body.name) || !body.name.trim()) {
    errors.push({ field: 'name', message: 'name is required' });
  }
  if (body.description !== undefined && !isString(body.description)) {
    errors.push({ field: 'description', message: 'description must be a string' });
  }

  if (errors.length) return next(AppError.badRequest('Validation failed', errors));
  next();
};

export const validateUpdateGroup = (req, _res, next) => {
  const body = req.body || {};
  const errors = [];

  if (Object.keys(body).length === 0) {
    errors.push({ field: 'body', message: 'At least one field is required' });
  }
  if (body.name !== undefined && (!isString(body.name) || !body.name.trim())) {
    errors.push({ field: 'name', message: 'name cannot be empty' });
  }
  if (body.description !== undefined && !isString(body.description)) {
    errors.push({ field: 'description', message: 'description must be a string' });
  }

  if (errors.length) return next(AppError.badRequest('Validation failed', errors));
  next();
};

export const validateAssignMembers = (req, _res, next) => {
  const body = req.body || {};
  const errors = [];

  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    errors.push({ field: 'leadIds', message: 'leadIds must be a non-empty array' });
  }

  if (errors.length) return next(AppError.badRequest('Validation failed', errors));
  next();
};