/**
 * =============================================================================
 * InnovateX Revenue OS — Module Access Middleware
 * =============================================================================
 *
 * FILE: src/shared/middlewares/module.middleware.js
 *
 * PURPOSE
 * ───────
 * Gates an entire route file to tenants whose plan's track actually
 * includes that module -- e.g. Calls/Attribution/Payments/Reports/etc.
 * are 'full' track only; a tenant on a 'whatsapp_only' plan gets a clear
 * 403, not data leakage or a confusing empty page.
 *
 * Reads req.tenant.planTrack, which resolveTenant already loaded (a real
 * Tenant document) -- so this adds ZERO extra DB queries. Must run AFTER
 * resolveTenant in the middleware chain.
 *
 * FAILS CLOSED on an unrecognized track value (a corrupted/invalid
 * planTrack denies access with a 403) -- only the literal string 'full'
 * is treated as unrestricted. An earlier version of this file failed
 * OPEN on any track it didn't recognize, which would have silently
 * granted access on data corruption instead of denying it -- fixed.
 *
 * super_admin bypasses entirely (req.tenant is null for that role --
 * resolveTenant skips tenant loading for it, see tenant.middleware.js --
 * platform staff aren't subject to any tenant's plan).
 *
 * USAGE
 * ─────
 *   router.use(authenticate, resolveTenant, requireModule('calls'));
 *   // every route below this line in the file is now gated
 * =============================================================================
 */

import { TRACK_MODULES } from '../../modules/plans/plan.model.js';
import AppError from '../../utils/AppError.js';

export const requireModule = (moduleKey) => (req, res, next) => {
  if (!req.tenant) return next(); // super_admin (no tenant context) -- unrestricted

  const track = req.tenant.planTrack;
  // 'full' explicitly means unrestricted (allowed === null). Any OTHER
  // unrecognized value (a track string that isn't a real key in
  // TRACK_MODULES at all -- shouldn't normally happen, but data can
  // drift) must fail CLOSED, not open -- silently granting access on an
  // invalid/corrupt planTrack would be a real authorization bypass, not
  // a harmless default.
  if (track === 'full') return next();
  if (!(track in TRACK_MODULES)) {
    return next(new AppError('Invalid subscription configuration -- contact support.', 403));
  }

  const allowed = TRACK_MODULES[track];
  if (allowed && allowed.includes(moduleKey)) return next();

  return next(new AppError(
    `This feature isn't included in your current plan. Upgrade to the Full plan to access it.`,
    403,
  ));
};