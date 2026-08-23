import { asyncHandler, AppError } from '../../../shared/helpers/lead.helpers.js';
import { messageService } from './message.service.js';
import { uploadBuffer } from '../../../shared/services/cloudinary.service.js';

export const messageController = {
  // POST /api/whatsapp/messages/send
  send: asyncHandler(async (req, res) => {
    const result = await messageService.sendMessage(req.context, req.body);
    res.status(201).json(result);
  }),

  /**
   * POST /api/whatsapp/messages/upload
   * multipart/form-data, field name "file" -- see upload.middleware.js
   * (5MB limit, in-memory). Frontend calls this FIRST (before the file
   * is attached to any message), gets back a durable Cloudinary URL, then
   * calls send() with that URL in `media`. Two separate requests rather
   * than one combined upload+send so the UI can show real upload
   * progress before the send even starts, and so a failed send doesn't
   * mean re-uploading the file.
   */
  uploadMedia: asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded -- expected multipart/form-data field "file"');
    const result = await uploadBuffer(req.file.buffer, {
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
    });
    res.status(201).json({
      url: result.url,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
  }),

  // POST /api/whatsapp/messages/simulate-inbound
  simulateInbound: asyncHandler(async (req, res) => {
    const result = await messageService.simulateInbound(req.context, req.body);
    res.status(201).json(result);
  }),

  // GET /api/whatsapp/conversations/:id/messages
  listForConversation: asyncHandler(async (req, res) => {
    const result = await messageService.getMessages(req.context, req.params.id, req.query);
    res.json(result);
  }),
};