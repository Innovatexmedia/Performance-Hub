import { apiKeyService } from '../../modules/apiKeys/apiKey.service.js';
import { ROLES } from '../../modules/auth/constants/roles.js';

/**
 * extractApiKey — accepts either header style:
 *   Authorization: Bearer ixk_live_...
 *   X-API-Key: ixk_live_...
 *
 * Both are common in the wild (Stripe uses the first, SendGrid and most
 * no-code tools the second) and supporting both costs four lines. n8n and
 * Zapier-style tools in particular make the second far easier to configure.
 */
function extractApiKey(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();

  const direct = req.headers['x-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  return null;
}

export const authenticateApiKey = async (req, res, next) => {
  const presented = extractApiKey(req);

  if (!presented) {
    return res.status(401).json({
      success: false,
      code: 'MISSING_API_KEY',
      message: 'No API key provided. Send it as "Authorization: Bearer <key>" or "X-API-Key: <key>".',
    });
  }

  const apiKey = await apiKeyService.verify(presented);

  // One message for unknown, revoked and expired alike. Distinguishing them
  // tells an attacker probing with stolen keys which ones were once real.
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_API_KEY',
      message: 'This API key is not valid. It may have been revoked or expired — check your API Keys page.',
    });
  }

  req.apiKey = apiKey;
  req.user = {
    sub:         null,               // an API key acts as the workspace, not as a person
    tenantId:    apiKey.tenantId,
    role:        ROLES.TENANT_OWNER, // full workspace scope, narrowed by `scopes` below
    permissions: [],
    viaApiKey:   true,
  };

  // Not awaited: a usage timestamp must never add latency to, or fail, a
  // customer's request.
  void apiKeyService.touchLastUsed(apiKey._id);

  return next();
};

/**
 * requireScope — per-route authorisation.
 *
 * Separate from authentication so a future read-only or analytics scope can be
 * added by listing it on a route, with no change to key issuance and no
 * reissuing of keys that already exist.
 */
export const requireScope = (scope) => (req, res, next) => {
  if (!req.apiKey?.scopes?.includes(scope)) {
    return res.status(403).json({
      success: false,
      code: 'INSUFFICIENT_SCOPE',
      message: `This API key does not have the "${scope}" scope.`,
    });
  }
  return next();
};