/**
 * =============================================================================
 * InnovateX Revenue OS — Public Lead Capture Routes
 * =============================================================================
 * FILE: src/modules/leads/capture/publicCapture.routes.js
 * Mounted at app.use('/api/public/capture', ...) -- BEFORE the
 * authenticated /api/leads router and outside its `authenticate` chain,
 * same real precedent as calcomPublicBooking.routes.js.
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './publicCapture.controller.js';
import { validateCapture } from './publicCapture.validator.js';
import { publicCaptureRateLimit } from '../../../shared/middlewares/rateLimit.middleware.js';

const router = Router();

router.post('/:tenantId', publicCaptureRateLimit, validateCapture, controller.capture);

export default router;
