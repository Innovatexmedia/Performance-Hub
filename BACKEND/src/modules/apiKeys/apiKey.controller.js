/**
 * API Keys — dashboard controller.
 */

import asyncHandler from '../../utils/asyncHandler.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import { sendSuccess, sendCreated } from '../../utils/responses.js';
import { apiKeyService } from './apiKey.service.js';

function buildCtx(req) {
  const user = req.user || {};
  const fallback = req.context || {};
  const tenantId = user.tenantId || fallback.tenantId;
  if (!tenantId) throw new AppError(401, 'Missing tenant context');
  return { tenantId, userId: user.sub || user.id || user._id || fallback.userId || null };
}

export const list = asyncHandler(async (req, res) => {
  const keys = await apiKeyService.list(buildCtx(req));
  return sendSuccess(res, { keys });
});

/**
 * POST /api/api-keys
 *
 * The response carries `key` — the only time the plaintext ever exists outside
 * the caller's own storage. The message is part of the contract, not decoration:
 * the UI shows it verbatim so nobody closes the dialog assuming they can copy
 * the key again later.
 */
export const create = asyncHandler(async (req, res) => {
  const { apiKey, key } = await apiKeyService.create(buildCtx(req), {
    name: req.body?.name,
    scopes: req.body?.scopes,
    expiresAt: req.body?.expiresAt ?? null,
  });

  return sendCreated(
    res,
    { apiKey, key },
    'API key created. Copy it now — it cannot be shown again.'
  );
});

export const revoke = asyncHandler(async (req, res) => {
  const apiKey = await apiKeyService.revoke(buildCtx(req), req.params.id);
  return sendSuccess(res, { apiKey }, 'API key revoked');
});