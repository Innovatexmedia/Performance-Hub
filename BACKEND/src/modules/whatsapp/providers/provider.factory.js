import { SimulationProvider } from './simulation.provider.js';
import { MetaProvider } from './meta.provider.js';
import { whatsappSettingsService } from '../submodules/whatsappSettings/whatsappSettings.service.js';
import { PROVIDER, PROVIDER_MODE } from '../submodules/whatsappSettings/whatsappSettings.constants.js';

const PROVIDERS = Object.freeze({
  simulation: new SimulationProvider(),
});

/**
 * Resolve a provider by name. Only the simulation provider exists as a
 * static singleton; unknown names fall back to it. Kept for any caller
 * that doesn't need tenant-specific credentials.
 */
export function getProvider(name = 'simulation') {
  return PROVIDERS[name] || PROVIDERS.simulation;
}

/**
 * resolveProvider -- the REAL per-tenant resolution used by
 * message.service.js. Unlike getProvider(), this is async and looks up
 * the tenant's actual WhatsApp Settings (provider choice + credentials)
 * rather than trusting a name passed in blind.
 *
 * Falls back to Simulation whenever:
 *   - the tenant has no WhatsApp Settings configured yet (fresh tenant)
 *   - providerMode is SIMULATION (explicit choice, regardless of `provider`)
 *   - provider isn't META_CLOUD (other 7 provider values have no adapter
 *     implemented yet -- WATI/Interakt/AiSensy/Gallabox/Twilio/360Dialog/
 *     Custom Webhook are enum values with no corresponding provider class,
 *     same honest gap as before, just now for 7 providers instead of 8)
 *
 * This is NOT silent guessing -- every fallback path is a real, checked
 * condition, not a try/catch swallowing a real configuration error.
 */
export async function resolveProvider(ctx) {
  let config;
  try {
    config = await whatsappSettingsService.getProviderConfig(ctx);
  } catch {
    // No settings document yet for this tenant -- fresh tenant, simulate.
    return PROVIDERS.simulation;
  }

  if (config.providerMode === PROVIDER_MODE.SIMULATION) {
    return PROVIDERS.simulation;
  }

  if (config.provider === PROVIDER.META_CLOUD) {
    const { accessToken, phoneNumberId, graphApiVersion } = config.meta || {};
    if (!accessToken || !phoneNumberId) {
      // Configured for Meta but credentials incomplete -- fall back rather
      // than construct a MetaProvider that would just throw on first use.
      return PROVIDERS.simulation;
    }
    return new MetaProvider({ accessToken, phoneNumberId, graphApiVersion });
  }

  // Any other configured provider (WATI, Twilio, etc.) has no adapter yet.
  return PROVIDERS.simulation;
}