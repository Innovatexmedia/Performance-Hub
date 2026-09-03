

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
  /** Meta APP ID (from the Facebook Developer App) -- required for the
   * Resumable Upload API when submitting a template with a media header
   * for approval. Distinct from businessAccountId (the WABA) and
   * phoneNumberId (the sending number). */
  appId: string;
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
  /** App-level (shared across every tenant, not per-tenant) -- whether
   * Meta Embedded Signup ("Continue with Facebook") is available yet.
   * False until InnovateX's own Meta Tech Provider approval is complete
   * and the resulting App ID / Config ID are set server-side -- manual
   * connect (the `meta` fields above) remains the only path until then. */
  embeddedSignupAvailable: boolean;
  embeddedSignupAppId: string | null;
  embeddedSignupConfigId: string | null;
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
    appId?: string;
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