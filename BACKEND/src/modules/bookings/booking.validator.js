import { body, param, query, validationResult } from 'express-validator';
import { BOOKING_STATUS_VALUES, MEETING_TYPE_VALUES } from './booking.constants.js';
import { sendError } from '../../utils/apiResponse.js';

/** Collect express-validator errors and return 422 if any exist. */
export const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendError(
      res,
      'Validation failed',
      422,
      errors.array().map((e) => ({ field: e.path, message: e.msg }))
    );
  }
  next();
};

/**
 * validateCreateBooking — POST /api/bookings
 * Required fields match DEVELOPER_HANDOFF.md §6 Booking entity.
 */
export const validateCreateBooking = [
  body('lead_id')
    .notEmpty().withMessage('lead_id is required')
    .isMongoId().withMessage('lead_id must be a valid MongoDB ObjectId'),

  body('assigned_user_id')
    .notEmpty().withMessage('assigned_user_id is required')
    .isMongoId().withMessage('assigned_user_id must be a valid MongoDB ObjectId'),

  body('meeting_date')
    .notEmpty().withMessage('meeting_date is required')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('meeting_date must be YYYY-MM-DD'),

  body('meeting_time')
    .notEmpty().withMessage('meeting_time is required')
    .matches(/^\d{2}:\d{2}$/).withMessage('meeting_time must be HH:MM'),

  body('meeting_type')
    .optional()
    .isIn(MEETING_TYPE_VALUES)
    .withMessage(`meeting_type must be one of: ${MEETING_TYPE_VALUES.join(', ')}`),

  body('duration_minutes')
    .optional()
    .isInt({ min: 15 }).withMessage('duration_minutes must be at least 15'),

  body('meeting_link')
    .optional({ nullable: true, checkFalsy: true })
    .isURL().withMessage('meeting_link must be a valid URL'),

  body('notes')
    .optional()
    .isString()
    .isLength({ max: 1000 }).withMessage('notes cannot exceed 1000 characters'),

  handleValidation,
];

/**
 * validateUpdateBooking — PATCH /api/bookings/:id
 * Every field optional (partial edit), but at least one must be a real
 * editable field -- service layer enforces "at least one provided".
 * Deliberately excludes meeting_date/meeting_time/status -- those go
 * through reschedule/status endpoints, which carry their own real side
 * effects (new document / lead+deal updates respectively).
 */
export const validateUpdateBooking = [
  param('id')
    .isMongoId().withMessage('Booking ID must be a valid MongoDB ObjectId'),

  body('meeting_type')
    .optional()
    .isIn(MEETING_TYPE_VALUES)
    .withMessage(`meeting_type must be one of: ${MEETING_TYPE_VALUES.join(', ')}`),

  body('assigned_user_id')
    .optional()
    .isMongoId().withMessage('assigned_user_id must be a valid MongoDB ObjectId'),

  body('meeting_link')
    .optional({ nullable: true, checkFalsy: true })
    .isURL().withMessage('meeting_link must be a valid URL'),

  body('duration_minutes')
    .optional()
    .isInt({ min: 15 }).withMessage('duration_minutes must be at least 15'),

  body('notes')
    .optional()
    .isString()
    .isLength({ max: 1000 }).withMessage('notes cannot exceed 1000 characters'),

  handleValidation,
];

/**
 * validateUpdateStatus — PATCH /api/bookings/:id/status
 * Inline status update from the table dropdown (FRONTEND_SPEC §9).
 */
export const validateUpdateStatus = [
  param('id')
    .isMongoId().withMessage('Booking ID must be a valid MongoDB ObjectId'),

  body('status')
    .notEmpty().withMessage('status is required')
    .isIn(BOOKING_STATUS_VALUES)
    .withMessage(`status must be one of: ${BOOKING_STATUS_VALUES.join(', ')}`),

  handleValidation,
];

/**
 * validateReschedule — POST /api/bookings/:id/reschedule
 */
export const validateReschedule = [
  param('id')
    .isMongoId().withMessage('Booking ID must be a valid MongoDB ObjectId'),

  body('meeting_date')
    .notEmpty().withMessage('New meeting_date is required')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('meeting_date must be YYYY-MM-DD'),

  body('meeting_time')
    .notEmpty().withMessage('New meeting_time is required')
    .matches(/^\d{2}:\d{2}$/).withMessage('meeting_time must be HH:MM'),

  body('notes')
    .optional()
    .isString()
    .isLength({ max: 1000 }),

  handleValidation,
];

/**
 * validateListQuery — GET /api/bookings
 * Filters align with the table columns in FRONTEND_SPEC §9.
 */
export const validateListQuery = [
  query('status')
    .optional()
    .isIn(BOOKING_STATUS_VALUES)
    .withMessage('Invalid status filter'),

  query('meeting_type')
    .optional()
    .isIn(MEETING_TYPE_VALUES)
    .withMessage('Invalid meeting_type filter'),

  query('assigned_user_id')
    .optional()
    .isMongoId().withMessage('assigned_user_id must be a valid MongoDB ObjectId'),

  query('date_from')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date_from must be YYYY-MM-DD'),

  query('date_to')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date_to must be YYYY-MM-DD'),

  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('page must be >= 1'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),

  handleValidation,
];