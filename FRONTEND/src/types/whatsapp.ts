

export type ConversationStatus = 'New' | 'Open' | 'Pending' | 'Qualified' | 'Booked' | 'Won' | 'Lost' | 'Ghosted';
export const CONVERSATION_STATUS_VALUES: ConversationStatus[] = ['New', 'Open', 'Pending', 'Qualified', 'Booked', 'Won', 'Lost', 'Ghosted'];

export type MessageStatus =
  | 'Draft' | 'Pending Approval' | 'Scheduled' | 'Queued' | 'Sent' | 'Delivered'
  | 'Read' | 'Replied' | 'Failed' | 'Cancelled' | 'Blocked by Opt-Out' | 'Blocked by Template Not Approved';

export type MessageDirection = 'inbound' | 'outbound';
export type MessageType = 'text' | 'image' | 'document' | 'audio' | 'template';

export interface Conversation {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  phone: string;
  contact_name: string;
  assigned_user_id: string | null;
  status: ConversationStatus;
  tags: string[];
  unread_count: number;
  last_message_preview: string;
  last_message_at: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  tenant_id: string;
  conversation_id: string;
  lead_id: string | null;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  /** Populated only when type is image/document/audio -- media_url is a
   * durable Cloudinary URL (never Meta's own short-lived one). */
  media_url: string | null;
  media_filename: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  sender: string | null;
  recipient: string | null;
  provider: string;
  status: MessageStatus;
  provider_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface LeadContext {
  lead_id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  qualification_score: number;
  source: string;
  lead_temperature: 'Hot' | 'Warm' | 'Cold';
  status: string;
  pipeline_stage: string | null;
  payment_status: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  value: number;
  last_contacted_at: string | null;
}

export interface ConversationDetails {
  conversation: Conversation;
  messages: Message[];
  leadContext: LeadContext | null;
  /** Whether there are older messages beyond the initial batch -- drives infinite-scroll-up in the Inbox. */
  hasMoreOlder: boolean;
}

export interface LoadOlderMessagesResult {
  messages: Message[];
  hasMoreOlder: boolean;
}

export interface ConversationNote {
  id: string;
  tenant_id: string;
  conversation_id: string;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface ConversationListQuery {
  search?: string;
  status?: ConversationStatus;
  assigned_user_id?: string;
  tags?: string;
  unreadOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ConversationListResult {
  data: Conversation[];
  pagination: Pagination;
}

export interface SendMessageResult {
  message: Message;
  conversation: Conversation;
  providerResponse: unknown;
  blocked?: boolean;
  blockedReason?: 'opt_out';
}

/** SOURCE: POST /api/whatsapp/messages/upload response shape. */
export interface UploadedMedia {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}