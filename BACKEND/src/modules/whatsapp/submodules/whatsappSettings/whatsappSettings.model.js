/**
 * WhatsApp Settings — model.
 *
 * Exactly ONE document per tenant (enforced by a unique index on tenantId).
 * Sensitive credentials (accessToken, appSecret, verifyToken) are stored here
 * but stripped by the service before any response leaves the server.
 */
import mongoose from 'mongoose';
import {
  PROVIDER_VALUES,
  PROVIDER,
  PROVIDER_MODE_VALUES,
  PROVIDER_MODE,
  PANEL_MODE_VALUES,
  PANEL_MODE,
  AI_PROVIDER_VALUES,
  AI_PROVIDER,
  BUSINESS_VERTICAL_VALUES,
  BUSINESS_VERTICAL,
} from './whatsappSettings.constants.js';

const { Schema } = mongoose;

const metaSchema = new Schema(
  {
    businessAccountId: { type: String, default: '' },
    phoneNumberId:     { type: String, default: '' },
    accessToken:       { type: String, default: '' },
    verifyToken:       { type: String, default: '' },
    appId:             { type: String, default: '' },
    appSecret:         { type: String, default: '' },
    graphApiVersion:   { type: String, default: 'v21.0' },
    webhookUrl:        { type: String, default: '' },
    connected:         { type: Boolean, default: false },
    connectedAt:       { type: Date, default: null },
    lastVerifiedAt:    { type: Date, default: null },
    // Populated from Meta's real Graph API response during Test Connection
    // -- NOT a user-typed field. Confirms the phoneNumberId actually
    // resolves to a real, working WhatsApp Business number.
    displayPhoneNumber: { type: String, default: '' },
    verifiedName:       { type: String, default: '' },
  },
  { _id: false },
);

const businessProfileSchema = new Schema(
  {
    displayName:      { type: String, default: '' },
    about:            { type: String, default: '' },
    description:      { type: String, default: '' },
    email:            { type: String, default: '' },
    website:          { type: String, default: '' },
    address:          { type: String, default: '' },
    profilePicture:   { type: String, default: '' },
    vertical:         { type: String, enum: BUSINESS_VERTICAL_VALUES, default: BUSINESS_VERTICAL.OTHER },
    businessCategory: { type: String, default: '' },
  },
  { _id: false },
);

const messagingSchema = new Schema(
  {
    defaultLanguage:  { type: String, default: 'en' },
    defaultTemplate:  { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', default: null },
    typingIndicator:  { type: Boolean, default: true },
    readReceipts:     { type: Boolean, default: true },
    deliveryReceipts: { type: Boolean, default: true },
    autoMarkRead:     { type: Boolean, default: false },
    replyDelay:       { type: Number, default: 0, min: 0 },
    timezone:         { type: String, default: 'Asia/Kolkata' },
  },
  { _id: false },
);

const mediaSchema = new Schema(
  {
    maxUploadSize:     { type: Number, default: 16, min: 1 },
    allowedExtensions: { type: [String], default: ['jpg', 'jpeg', 'png', 'pdf', 'mp4', 'mp3', 'docx'] },
    imageCompression:  { type: Boolean, default: true },
    videoCompression:  { type: Boolean, default: true },
    documentPreview:   { type: Boolean, default: true },
    audioSupport:      { type: Boolean, default: true },
    stickerSupport:    { type: Boolean, default: true },
  },
  { _id: false },
);

const aiSchema = new Schema(
  {
    enabled:             { type: Boolean, default: false },
    provider:            { type: String, enum: AI_PROVIDER_VALUES, default: AI_PROVIDER.MOCK },
    model:               { type: String, default: 'mock-1' },
    temperature:         { type: Number, default: 0.7, min: 0, max: 2 },
    maxTokens:           { type: Number, default: 1024, min: 1 },
    confidenceThreshold: { type: Number, default: 0.6, min: 0, max: 1 },
    fallbackReply:       { type: String, default: '' },
    humanHandoff:        { type: Boolean, default: true },
  },
  { _id: false },
);

const automationSchema = new Schema(
  {
    enabled:               { type: Boolean, default: true },
    retryFailedMessages:   { type: Boolean, default: true },
    retryAttempts:         { type: Number, default: 3, min: 0, max: 10 },
    retryInterval:         { type: Number, default: 5, min: 0 },   // minutes
    defaultExecutionDelay: { type: Number, default: 0, min: 0 },   // minutes
  },
  { _id: false },
);

const notificationsSchema = new Schema(
  {
    campaignCompleted:    { type: Boolean, default: true },
    templateRejected:     { type: Boolean, default: true },
    providerDisconnected: { type: Boolean, default: true },
    failedMessages:       { type: Boolean, default: true },
    quotaExceeded:        { type: Boolean, default: true },
    systemAlerts:         { type: Boolean, default: true },
  },
  { _id: false },
);

const securitySchema = new Schema(
  {
    encryptAccessToken: { type: Boolean, default: true },
    ipWhitelist:        { type: [String], default: [] },
    allowedDomains:     { type: [String], default: [] },
    auditEnabled:       { type: Boolean, default: true },
    apiKeyRotation:     { type: Boolean, default: false },
  },
  { _id: false },
);

const syncSchema = new Schema(
  {
    autoSyncTemplates:       { type: Boolean, default: false },
    autoSyncContacts:        { type: Boolean, default: false },
    autoSyncMessages:        { type: Boolean, default: false },
    autoSyncBusinessProfile: { type: Boolean, default: false },
    lastSyncAt:              { type: Date, default: null },
  },
  { _id: false },
);

const limitsSchema = new Schema(
  {
    dailyMessages:   { type: Number, default: 1000, min: 0 },
    monthlyMessages: { type: Number, default: 30000, min: 0 },
    contacts:        { type: Number, default: 10000, min: 0 },
    campaigns:       { type: Number, default: 100, min: 0 },
    broadcasts:      { type: Number, default: 100, min: 0 },
    templates:       { type: Number, default: 250, min: 0 },
    apiRequests:     { type: Number, default: 10000, min: 0 },
  },
  { _id: false },
);

const advancedSchema = new Schema(
  {
    // DEPRECATED -- see whatsappSettings.constants.js DEFAULT_SETTINGS.advanced.
    simulationMode:  { type: Boolean, default: true },
    developerMode:   { type: Boolean, default: false },
    debugMode:       { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
  },
  { _id: false },
);

const whatsappSettingsSchema = new Schema(
  {
    tenantId: { type: String, required: true, unique: true },

    // Schema-level defaults kept in sync with DEFAULT_SETTINGS: panelMode
    // NATIVE means provider is automatically META_CLOUD (Architecture
    // Decision, Option B). providerMode starts "unverified" (SIMULATION)
    // until a real Test Connection succeeds -- it is never client-settable
    // (enforced in whatsappSettings.service.js / .validator.js, not here).
    provider:     { type: String, enum: PROVIDER_VALUES, default: PROVIDER.META_CLOUD },
    providerMode: { type: String, enum: PROVIDER_MODE_VALUES, default: PROVIDER_MODE.SIMULATION },
    panelMode:    { type: String, enum: PANEL_MODE_VALUES, default: PANEL_MODE.NATIVE },

    meta:            { type: metaSchema, default: () => ({}) },
    businessProfile: { type: businessProfileSchema, default: () => ({}) },
    messaging:       { type: messagingSchema, default: () => ({}) },
    media:           { type: mediaSchema, default: () => ({}) },
    ai:              { type: aiSchema, default: () => ({}) },
    automation:      { type: automationSchema, default: () => ({}) },
    notifications:   { type: notificationsSchema, default: () => ({}) },
    security:        { type: securitySchema, default: () => ({}) },
    sync:            { type: syncSchema, default: () => ({}) },
    limits:          { type: limitsSchema, default: () => ({}) },
    advanced:        { type: advancedSchema, default: () => ({}) },

    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// One settings doc per tenant.
whatsappSettingsSchema.index({ tenantId: 1 }, { unique: true });

// Prevent two tenants from connecting the SAME WhatsApp Business phone
// number -- a given phoneNumberId can only route to one tenant's inbox,
// otherwise inbound messages would be ambiguous and one tenant could
// effectively hijack another's number.
//
// partialFilterExpression, NOT sparse: meta.phoneNumberId defaults to ''
// (empty string), not null/undefined. A sparse index only excludes
// documents where the field is MISSING -- every unconfigured tenant would
// still have the literal value '', so a plain sparse+unique index would
// let the FIRST unconfigured tenant through and then fail for every
// tenant created after it. The partial filter explicitly only enforces
// uniqueness on documents where a real, non-empty phoneNumberId is set.
whatsappSettingsSchema.index(
  { 'meta.phoneNumberId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'meta.phoneNumberId': { $type: 'string', $ne: '' } },
  },
);

export const WhatsAppSettings = mongoose.model('WhatsAppSettings', whatsappSettingsSchema);