import { AppError } from '../../../shared/helpers/lead.helpers.js';
import { MESSAGE_TYPE_VALUES } from './message.model.js';

function validateBody(req) {
  const errors = [];
  if (!req.body?.conversationId || !String(req.body.conversationId).trim()) {
    errors.push({ field: 'conversationId', message: 'conversationId is required' });
  }
  // content is only required for a plain text message -- a media send
  // (image/document/audio) can legitimately have no caption at all, and
  // Meta doesn't even allow a caption on audio messages, so requiring
  // non-empty content here would incorrectly reject every valid
  // caption-less media send.
  const hasMedia = !!req.body?.media?.url;
  if (!hasMedia && (!req.body?.content || !String(req.body.content).trim())) {
    errors.push({ field: 'content', message: 'content is required' });
  }
  if (req.body?.type !== undefined && !MESSAGE_TYPE_VALUES.includes(req.body.type)) {
    errors.push({ field: 'type', message: 'Invalid message type' });
  }
  if (req.body?.media !== undefined && req.body.media !== null) {
    if (typeof req.body.media !== 'object' || !req.body.media.url) {
      errors.push({ field: 'media', message: 'media.url is required when media is provided' });
    }
    if (!['image', 'document', 'audio'].includes(req.body.type)) {
      errors.push({ field: 'type', message: 'type must be image, document, or audio when media is provided' });
    }
  }
  return errors;
}

export const validateSend = (req, _res, next) => {
  const errors = validateBody(req);
  if (errors.length) return next(AppError.badRequest('Validation failed', errors));
  next();
};

export const validateSimulateInbound = (req, _res, next) => {
  const errors = validateBody(req);
  if (errors.length) return next(AppError.badRequest('Validation failed', errors));
  next();
};