/**
 * Real WhatsApp Settings types -- match the backend model exactly.
 *
 * SOURCE: src/modules/whatsapp/submodules/whatsappSettings/whatsappSettings.model.js
 * Standard envelope (unlike Leads/Pipeline/Messages) -- uses request(), not requestRaw().
 *
 * SCOPED to Phase 1: the Provider Settings screen (provider connection +
 * sync toggles) -- the other 8 settings sections (business profile,
 * messaging, media, ai, automation, notifications, security, limits)
 * exist on the backend but aren't part of this screen, so they're not
 * fully typed here.
 *
 * IMPORTANT: accessToken/appSecret/verifyToken are NEVER returned by the
 * API (stripped server-side) -- only hasAccessToken/hasAppSecret/
 * hasVerifyToken booleans, so the UI can show "already set" without ever
 * seeing the real secret again. This is deliberate backend behavior, not
 * a bug to work around.
 *
 * ARCHITECTURE DECISION (Option B) -- WhatsApp Mode governs Provider, and
 * the backend owns execution mode entirely:
 *   - panelMode 'NATIVE' (default)  -> provider is FORCED to META_CLOUD
 *     server-side. The Provider dropdown must be locked/disabled in the
 *     UI, not just "some options disabled" -- there is only one valid
 *     provider in this mode.
 *   - panelMode 'THIRD_PARTY'       -> provider becomes a real user choice
 *     among THIRD_PARTY_PROVIDER_VALUES. None of these have a working
 *     adapter yet (Phase 1 scope) -- show them, but disabled, "(coming
 *     soon)", per IMPLEMENTED_THIRD_PARTY_PROVIDERS below.
 *   - `providerMode` is NEVER sent by the client, ever, under any
 *     endpoint. It does not appear on UpdateProviderInput on purpose. The
 *     backend derives it exclusively: reset to 'SIMULATION' (meaning
 *     "unverified") whenever `provider` changes, flipped to 'LIVE' only
 *     inside testConnection() after a real successful Meta Graph API
 *     response. Simulation/Sandbox are not user-facing concepts at all --
 *     they never appear as selectable values anywhere in this UI.
 */

export type WhatsAppProvider =
  | 'META_CLOUD' | 'WATI' | 'INTERAKT' | 'AISENSY' | 'GALLABOX'
  | 'TWILIO' | '360DIALOG' | 'CUSTOM_WEBHOOK' | 'SIMULATION';

export const PROVIDER_LABELS: Record<WhatsAppProvider, string> = {
  META_CLOUD: 'Native Meta Cloud API',
  WATI: 'WATI',
  INTERAKT: 'Interakt',
  AISENSY: 'AiSensy',
  GALLABOX: 'Gallabox',
  TWILIO: 'Twilio WhatsApp',
  '360DIALOG': '360dialog',
  CUSTOM_WEBHOOK: 'Custom Webhook Provider',
  SIMULATION: 'Simulation Mode', // internal-only value; never rendered as a selectable option
};

/** The single provider used when WhatsApp Mode = 'NATIVE'. Not a user choice. */
export const NATIVE_PROVIDER: WhatsAppProvider = 'META_CLOUD';

/**
 * Providers selectable when WhatsApp Mode = 'THIRD_PARTY'. Mirrors the
 * backend's THIRD_PARTY_PROVIDER_VALUES exactly (whatsappSettings.constants.js)
 * -- excludes META_CLOUD (NATIVE-only) and SIMULATION (internal-only,
 * never a user-facing choice).
 */
export const THIRD_PARTY_PROVIDER_VALUES: WhatsAppProvider[] = [
  'WATI', 'INTERAKT', 'AISENSY', 'GALLABOX', 'TWILIO', '360DIALOG', 'CUSTOM_WEBHOOK',
];

/**
 * Third-party providers with a real, working adapter. Phase 1: none --
 * every third-party option renders disabled with "(coming soon)". Update
 * this list as adapters actually ship; nothing else in the UI needs to
 * change when they do.
 */
export const IMPLEMENTED_THIRD_PARTY_PROVIDERS: WhatsAppProvider[] = [];

export type ProviderMode = 'LIVE' | 'SANDBOX' | 'SIMULATION';
export type PanelMode = 'NATIVE' | 'THIRD_PARTY';

export interface WhatsAppSettingsMeta {
  businessAccountId: string;
  phoneNumberId: string;
  graphApiVersion: string;
  webhookUrl: string;
  connected: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  displayPhoneNumber: string;
  verifiedName: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
}

export interface WhatsAppSettingsSync {
  autoSyncTemplates: boolean;
  autoSyncContacts: boolean;
  autoSyncMessages: boolean;
  autoSyncBusinessProfile: boolean;
  lastSyncAt: string | null;
}

export interface WhatsAppSettings {
  id: string;
  tenantId: string;
  provider: WhatsAppProvider;
  /** Backend-derived, read-only. 'LIVE' only after a successful Test Connection. */
  providerMode: ProviderMode;
  panelMode: PanelMode;
  meta: WhatsAppSettingsMeta;
  sync: WhatsAppSettingsSync;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * NOTE: deliberately has NO `providerMode` field. It is never accepted by
 * the backend (stripped in the validator + service regardless of what's
 * sent), so it isn't offered here either -- there should be no code path
 * in this app that even tries to set it.
 */
export interface UpdateProviderInput {
  /** Ignored/overridden server-side whenever panelMode resolves to 'NATIVE'. */
  provider?: WhatsAppProvider;
  panelMode?: PanelMode;
  meta?: {
    businessAccountId?: string;
    phoneNumberId?: string;
    accessToken?: string;
    verifyToken?: string;
    appSecret?: string;
    graphApiVersion?: string;
    /** Settable directly (not just by Test Connection) -- used by the Disconnect action. */
    connected?: boolean;
  };
}

export interface UpdateSyncInput {
  autoSyncTemplates?: boolean;
  autoSyncContacts?: boolean;
  autoSyncMessages?: boolean;
  autoSyncBusinessProfile?: boolean;
}

export interface TestConnectionResult {
  connected: boolean;
  provider: WhatsAppProvider;
  mode?: ProviderMode;
  displayPhoneNumber?: string;
  verifiedName?: string;
  message: string;
}