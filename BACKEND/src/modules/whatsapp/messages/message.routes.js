import { Router } from 'express';
import { messageController } from './message.controller.js';
import { validateSend, validateSimulateInbound } from './message.validator.js';
import { withContext } from '../../../shared/helpers/lead.helpers.js';
import { upload } from '../../../shared/middlewares/upload.middleware.js';

const router = Router();
router.use(withContext);

// POST /api/whatsapp/messages/send
router.post('/send', validateSend, messageController.send);

// POST /api/whatsapp/messages/upload -- multipart/form-data, field "file"
router.post('/upload', upload.single('file'), messageController.uploadMedia);

// POST /api/whatsapp/messages/simulate-inbound
router.post('/simulate-inbound', validateSimulateInbound, messageController.simulateInbound);

export default router;