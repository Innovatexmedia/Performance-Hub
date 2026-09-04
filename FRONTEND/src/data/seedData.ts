import type {
  Tenant, User, Lead, Deal, Booking, CallRecord, WhatsAppConversation,
  WhatsAppMessage, WhatsAppTemplate, WhatsAppCampaign, DeliveryLog,
  NurtureSequence, NurtureEnrollment, Campaign, TrackingEvent, Payment,
  Automation, GenericTemplate, Notification, Integration, Task, AuditLog,
  TenantSettings, LeadStatus, LeadTemperature, PipelineStageId, TrackingEventType,
} from '@/types';
import { daysAgo, hoursAgo, daysFromNow } from '@/utils/id';

// Deterministic PRNG so the demo data is stable across reloads
let seed = 1337;
function rng(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function rint(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export interface Database {
  tenants: Tenant[];
  users: User[];
  leads: Lead[];
  deals: Deal[];
  bookings: Booking[];
  calls: CallRecord[];
  conversations: WhatsAppConversation[];
  messages: WhatsAppMessage[];
  templates: WhatsAppTemplate[];
  campaigns: WhatsAppCampaign[];
  deliveryLogs: DeliveryLog[];
  nurtureSequences: NurtureSequence[];
  nurtureEnrollments: NurtureEnrollment[];
  marketingCampaigns: Campaign[];
  trackingEvents: TrackingEvent[];
  payments: Payment[];
  automations: Automation[];
  genericTemplates: GenericTemplate[];
  notifications: Notification[];
  integrations: Integration[];
  tasks: Task[];
  auditLogs: AuditLog[];
  settings: Record<string, TenantSettings>;
}

const T1 = 'tenant_alpha';
const T2 = 'tenant_beta';

const PIPELINE_STAGES = [
  { id: 'new_lead' as PipelineStageId, name: 'New Lead', order: 1, color: '#64748b' },
  { id: 'qualified' as PipelineStageId, name: 'Qualified', order: 2, color: '#3b82f6' },
  { id: 'booked_call' as PipelineStageId, name: 'Booked Call', order: 3, color: '#8b5cf6' },
  { id: 'call_completed' as PipelineStageId, name: 'Call Completed', order: 4, color: '#06b6d4' },
  { id: 'proposal_sent' as PipelineStageId, name: 'Proposal Sent', order: 5, color: '#f59e0b' },
  { id: 'negotiation' as PipelineStageId, name: 'Negotiation', order: 6, color: '#ec4899' },
  { id: 'won' as PipelineStageId, name: 'Won', order: 7, color: '#10b981' },
  { id: 'lost' as PipelineStageId, name: 'Lost', order: 8, color: '#ef4444' },
  { id: 'nurture' as PipelineStageId, name: 'Nurture', order: 9, color: '#14b8a6' },
];

const SOURCES = ['Meta Ads', 'Google Ads', 'LinkedIn', 'Webinar', 'Referral', 'Organic', 'Cold Outreach', 'YouTube'];
const MEDIUMS = ['paid', 'organic', 'social', 'referral', 'email'];
const SEGMENTS = ['Coaches', 'EdTech', 'SaaS Founders', 'Ecommerce', 'Agencies', 'Consultants'];
const STATUSES: LeadStatus[] = ['New', 'Contacted', 'Qualified', 'Booked', 'Call Completed', 'Proposal Sent', 'Won', 'Lost', 'Nurture', 'Ghosted'];
const FIRST = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas', 'Mia', 'Logan', 'Charlotte', 'James', 'Amelia', 'Benjamin', 'Harper', 'Henry', 'Evelyn', 'Daniel', 'Sofia', 'Marcus', 'Priya', 'Diego', 'Yuki', 'Hannah', 'Omar', 'Lena', 'Carlos', 'Nina', 'Felix', 'Zara', 'Tom', 'Grace', 'Leo', 'Maya', 'Sam', 'Ruby', 'Jack', 'Chloe'];
const LAST = ['Bennett', 'Carter', 'Hughes', 'Foster', 'Reyes', 'Morgan', 'Patel', 'Nguyen', 'Schmidt', 'Rossi', 'Kim', 'Silva', 'Andersen', 'Costa', 'Murphy', 'Tanaka', 'Hassan', 'Larsson', 'Mendez', 'Volkov'];
const COMPANIES = ['Peak Coaching', 'EduSpark', 'CloudNova', 'ShopWave', 'GrowthLab Agency', 'ScaleUp Inc', 'BrightPath', 'NexaLearn', 'FlowState', 'Vertex Studio', 'Lumen Co', 'Apex Digital', 'NorthStar', 'Pulse Media', 'Orbit Labs'];
const CAMPAIGN_NAMES = ['coach_webinar', 'q2_brand', 'edtech_launch', 'saas_retarget', 'ecom_blackfriday', 'referral_push', 'youtube_series', 'linkedin_abm'];

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#3b82f6'];

function makeSettings(name: string, website: string, color: string): TenantSettings {
  return {
    company_name: name,
    company_website: website,
    accent_color: color,
    qualification_questions: [
      'What problem are you trying to solve?',
      'What is your monthly lead volume?',
      'What is your current revenue range?',
      'What tools are you using now?',
      'How soon do you want to implement?',
      'What is your budget range?',
      'Who makes the buying decision?',
    ],
    pipeline_stages: PIPELINE_STAGES,
    scoring_rules: [
      { factor: 'Budget fit', weight: 30 },
      { factor: 'Urgency', weight: 25 },
      { factor: 'Decision authority', weight: 20 },
      { factor: 'Engagement', weight: 15 },
      { factor: 'Company size', weight: 10 },
    ],
    consent_required: true,
    data_retention_days: 365,
    notification_prefs: {
      'New lead': true,
      'Hot lead qualified': true,
      'WhatsApp reply pending': true,
      'Payment received': true,
      'Weekly summary': true,
    },
    whatsapp: {
      whatsapp_mode: 'native',
      provider_name: 'Native Meta Cloud API',
      provider_status: 'connected',
      access_token: 'EAAG••••••••••••sim',
      business_account_id: '1029384756',
      phone_number_id: '5566778899',
      webhook_url: 'https://app.innovatex.com/webhooks/whatsapp',
      verify_token: 'innovatex_verify_2026',
      default_sender_number: '+1 (415) 555-0142',
      sync_templates_enabled: true,
      sync_messages_enabled: true,
      sync_contacts_enabled: true,
    },
  };
}

export function generateSeed(): Database {
  seed = 1337;

  const tenants: Tenant[] = [
    { id: T1, name: 'Innovate Coaching Co', domain: 'innovatecoaching.com', plan: 'Scale', status: 'active', industry: 'Coaching & Consulting', region: 'North America', seats: 12, mrr: 2400, created_at: daysAgo(220), updated_at: daysAgo(2), logo_color: '#6366f1' },
    { id: T2, name: 'NexaLearn EdTech', domain: 'nexalearn.io', plan: 'Growth', status: 'active', industry: 'EdTech', region: 'Europe', seats: 8, mrr: 1200, created_at: daysAgo(140), updated_at: daysAgo(5), logo_color: '#14b8a6' },
  ];

  const users: User[] = [
    { id: 'u_super', tenant_id: T1, name: 'Alex Mercer', email: 'super@innovatex.com', password: 'password123', role: 'Super Admin', status: 'active', avatar_color: '#0f172a', title: 'Platform Admin', created_at: daysAgo(220), updated_at: daysAgo(1), last_active_at: hoursAgo(1) },
    { id: 'u_owner', tenant_id: T1, name: 'Jordan Lee', email: 'owner@demo.com', password: 'password123', role: 'Tenant Owner', status: 'active', avatar_color: '#6366f1', title: 'Founder & CEO', created_at: daysAgo(210), updated_at: daysAgo(1), last_active_at: hoursAgo(2) },
    { id: 'u_admin', tenant_id: T1, name: 'Taylor Brooks', email: 'admin@demo.com', password: 'password123', role: 'Tenant Admin', status: 'active', avatar_color: '#8b5cf6', title: 'Revenue Operations', created_at: daysAgo(200), updated_at: daysAgo(3), last_active_at: hoursAgo(5) },
    { id: 'u_sales', tenant_id: T1, name: 'Riley Quinn', email: 'sales@demo.com', password: 'password123', role: 'Sales User', status: 'active', avatar_color: '#ec4899', title: 'Senior Account Executive', created_at: daysAgo(180), updated_at: daysAgo(1), last_active_at: hoursAgo(1) },
    { id: 'u_readonly', tenant_id: T1, name: 'Sam Rivera', email: 'viewer@demo.com', password: 'password123', role: 'Read-Only User', status: 'active', avatar_color: '#f59e0b', title: 'Marketing Analyst', created_at: daysAgo(120), updated_at: daysAgo(7), last_active_at: hoursAgo(20) },
  ];

  const salesUsers = ['u_owner', 'u_admin', 'u_sales'];

  // ---- Leads ----
  const leads: Lead[] = [];
  for (let i = 0; i < 40; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const name = `${first} ${last}`;
    const company = pick(COMPANIES);
    const source = pick(SOURCES);
    const status = STATUSES[i % STATUSES.length] || pick(STATUSES);
    const score = rint(1, 10);
    const temp: LeadTemperature = score >= 8 ? 'Hot' : score >= 5 ? 'Warm' : 'Cold';
    const created = daysAgo(rint(1, 90));
    const campaign = pick(CAMPAIGN_NAMES);
    leads.push({
      id: `lead_${i + 1}`,
      tenant_id: T1,
      name,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/[^a-z]/g, '')}.com`,
      phone: `+1 415 555 ${String(rint(1000, 9999))}`,
      whatsapp_number: `+1 415 555 ${String(rint(1000, 9999))}`,
      company,
      source,
      medium: pick(MEDIUMS),
      campaign,
      utm_source: source.toLowerCase().replace(/ /g, '_'),
      utm_medium: pick(MEDIUMS),
      utm_campaign: campaign,
      utm_content: pick(['hero_cta', 'sidebar', 'video_ad', 'carousel', 'lead_form']),
      utm_term: pick(['revenue os', 'whatsapp crm', 'lead qualification', 'sales automation']),
      status,
      qualification_score: score,
      lead_temperature: temp,
      assigned_user_id: pick(salesUsers),
      segment: pick(SEGMENTS),
      notes: '',
      consent_status: rng() > 0.15 ? 'granted' : 'pending',
      opt_out_status: rng() > 0.92,
      value: rint(2, 40) * 1000,
      last_contacted_at: rng() > 0.2 ? hoursAgo(rint(1, 240)) : null,
      created_at: created,
      updated_at: hoursAgo(rint(1, 200)),
    });
  }
  // A few leads in tenant 2
  for (let i = 0; i < 6; i++) {
    leads.push({
      id: `lead_b${i + 1}`, tenant_id: T2, name: `${pick(FIRST)} ${pick(LAST)}`,
      email: `lead${i}@nexalearn.io`, phone: `+44 20 555 ${rint(1000, 9999)}`,
      whatsapp_number: `+44 20 555 ${rint(1000, 9999)}`, company: pick(COMPANIES),
      source: pick(SOURCES), medium: pick(MEDIUMS), campaign: pick(CAMPAIGN_NAMES),
      utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'edtech_launch', utm_content: '', utm_term: '',
      status: pick(STATUSES), qualification_score: rint(1, 10), lead_temperature: 'Warm',
      assigned_user_id: null, segment: 'EdTech', notes: '', consent_status: 'granted',
      opt_out_status: false, value: rint(3, 20) * 1000, last_contacted_at: hoursAgo(rint(1, 100)),
      created_at: daysAgo(rint(1, 60)), updated_at: hoursAgo(rint(1, 50)),
    });
  }

  // ---- Deals (15) ----
  const dealStages: PipelineStageId[] = ['new_lead', 'qualified', 'booked_call', 'call_completed', 'proposal_sent', 'negotiation', 'won', 'lost', 'nurture'];
  const deals: Deal[] = [];
  for (let i = 0; i < 15; i++) {
    const lead = leads[i];
    const stage = dealStages[i % dealStages.length];
    deals.push({
      id: `deal_${i + 1}`, tenant_id: T1, title: `${lead.company} — Revenue OS`,
      lead_id: lead.id, stage, value: lead.value, currency: 'USD',
      expected_close_date: daysFromNow(rint(5, 45)), assigned_user_id: lead.assigned_user_id,
      source: lead.source, campaign: lead.campaign,
      probability: stage === 'won' ? 100 : stage === 'lost' ? 0 : rint(20, 80),
      stage_history: [{ stage: 'new_lead', at: lead.created_at }, { stage, at: hoursAgo(rint(1, 100)) }],
      created_at: lead.created_at, updated_at: hoursAgo(rint(1, 80)),
    });
  }

  // ---- Bookings (12) ----
  const bookingStatuses = ['Scheduled', 'Completed', 'No Show', 'Cancelled', 'Rescheduled'] as const;
  const bookings: Booking[] = [];
  for (let i = 0; i < 12; i++) {
    const lead = leads[i + 2];
    bookings.push({
      id: `booking_${i + 1}`, tenant_id: T1, lead_id: lead.id,
      deal_id: i < deals.length ? deals[i].id : null,
      meeting_date: i % 3 === 0 ? daysFromNow(rint(1, 14)) : daysAgo(rint(1, 20)),
      meeting_time: `${rint(9, 17)}:${pick(['00', '30'])}`,
      meeting_type: pick(['Discovery Call', 'Strategy Session', 'Demo', 'Proposal Review']),
      assigned_user_id: lead.assigned_user_id, status: bookingStatuses[i % bookingStatuses.length],
      source: lead.source, campaign: lead.campaign, notes: 'Auto-booked via WhatsApp link.',
      created_at: daysAgo(rint(1, 25)), updated_at: hoursAgo(rint(1, 50)),
    });
  }

  // ---- Calls (6) ----
  const callOutcomes = ['Interested', 'Proposal Requested', 'Needs Follow-Up', 'Closed Won', 'Not Interested', 'No Show'] as const;
  const calls: CallRecord[] = [];
  for (let i = 0; i < 6; i++) {
    const lead = leads[i];
    calls.push({
      id: `call_${i + 1}`, tenant_id: T1, lead_id: lead.id, deal_id: deals[i]?.id ?? null,
      duration_minutes: rint(18, 52),
      transcript: `Rep: Thanks for hopping on, ${lead.name.split(' ')[0]}. Walk me through your biggest revenue bottleneck right now.\nProspect: We're generating leads but losing them in follow-up — response time is killing us.\nRep: That's exactly what Revenue OS solves with AI qualification and WhatsApp automation...\nProspect: Pricing is a concern, and I'd need buy-in from my co-founder.`,
      summary: `${lead.name} from ${lead.company} is experiencing slow lead follow-up causing pipeline leakage. Strong fit for AI qualification + WhatsApp automation. Budget sensitivity noted; co-founder is a second decision maker.`,
      objections: ['Pricing concern', 'Needs co-founder buy-in', i % 2 ? 'Timing — busy quarter' : 'Already evaluating a competitor'],
      next_steps: ['Send tailored proposal', 'Share ROI calculator', 'Schedule follow-up with co-founder'],
      outcome: callOutcomes[i % callOutcomes.length], score: rint(5, 9),
      assigned_user_id: lead.assigned_user_id, call_date: daysAgo(rint(1, 30)),
      created_at: daysAgo(rint(1, 30)), updated_at: daysAgo(rint(1, 10)),
    });
  }

  // ---- WhatsApp Conversations (15) ----
  const convStatuses = ['New', 'Open', 'Pending', 'Qualified', 'Booked', 'Won', 'Lost', 'Ghosted'] as const;
  const conversations: WhatsAppConversation[] = [];
  for (let i = 0; i < 15; i++) {
    const lead = leads[i];
    conversations.push({
      id: `conv_${i + 1}`, tenant_id: T1, lead_id: lead.id,
      status: convStatuses[i % convStatuses.length], assigned_user_id: lead.assigned_user_id,
      tags: i % 2 ? ['hot', 'webinar'] : ['follow-up'],
      last_message_at: hoursAgo(rint(1, 72)),
      unread_count: rng() > 0.6 ? rint(1, 4) : 0,
      internal_notes: i % 3 === 0 ? [{ author_id: 'u_sales', text: 'High intent — prioritize.', at: hoursAgo(10) }] : [],
      created_at: daysAgo(rint(1, 40)), updated_at: hoursAgo(rint(1, 60)),
    });
  }

  // ---- WhatsApp Messages (80) ----
  const inboundSamples = [
    'Hi, I saw your webinar — interested in learning more!',
    'What does pricing look like for a team of 5?',
    'Can we book a call this week?',
    'Sounds good, send me the details.',
    'I need to check with my co-founder first.',
    'Yes please send the payment link.',
    'How does the WhatsApp automation work exactly?',
    'Thanks! Looking forward to the demo.',
  ];
  const outboundSamples = [
    'Hi {{lead_name}}! Thanks for your interest in InnovateX Revenue OS. 🚀',
    'I can set you up with a quick strategy call — here\'s my booking link: {{booking_link}}',
    'Our Scale plan is built for teams like yours. Want me to send a tailored proposal?',
    'No problem! Here\'s a one-pager you can share with your co-founder.',
    'Great — here\'s your secure payment link: {{payment_link}}',
    'Following up on our call earlier — let me know if you have any questions!',
    'Just confirming your demo for tomorrow at 2pm. 📅',
  ];
  const messages: WhatsAppMessage[] = [];
  let mIdx = 0;
  for (const conv of conversations) {
    const count = rint(4, 7);
    for (let j = 0; j < count && mIdx < 90; j++) {
      const inbound = j % 2 === 0;
      messages.push({
        id: `msg_${mIdx + 1}`, tenant_id: T1, conversation_id: conv.id, lead_id: conv.lead_id,
        direction: inbound ? 'inbound' : 'outbound',
        body: inbound ? pick(inboundSamples) : pick(outboundSamples),
        status: inbound ? 'Replied' : pick(['Sent', 'Delivered', 'Read'] as const),
        template_id: null, campaign_id: null, provider_name: 'Native Meta Cloud API',
        sender: inbound ? conv.lead_id : '+1 (415) 555-0142',
        recipient: inbound ? '+1 (415) 555-0142' : conv.lead_id,
        message_type: 'text',
        created_at: hoursAgo(rint(1, 72) + (count - j)), updated_at: hoursAgo(rint(1, 72)),
      });
      mIdx++;
    }
  }

  // ---- WhatsApp Templates (10) ----
  const templates: WhatsAppTemplate[] = [
    tpl('welcome_hot_lead', 'Marketing', 'Active', 'Welcome a new hot lead', 'Hi {{lead_name}}! Thanks for your interest in {{company_name}}. Ready to scale your revenue? Book a free strategy call below.', [{ type: 'Booking link', text: 'Book a Call' }]),
    tpl('booking_confirmation', 'Booking', 'Active', 'Confirm a booked call', 'Hi {{lead_name}}, your {{offer_name}} call is confirmed for {{call_date}}. See you then! 📅', [{ type: 'Quick reply', text: 'Reschedule' }]),
    tpl('payment_reminder', 'Payment', 'Active', 'Remind a lead to pay', 'Hi {{lead_name}}, here is your secure payment link to get started: {{payment_link}}', [{ type: 'Payment link', text: 'Pay Now' }]),
    tpl('proposal_followup', 'Follow-up', 'Provider Approved', 'Follow up on a proposal', 'Hi {{lead_name}}, just following up on the proposal we sent. Happy to answer any questions! — {{sales_rep_name}}', [{ type: 'Quick reply', text: 'I have questions' }]),
    tpl('ghosted_reengage', 'Re-engagement', 'Active', 'Re-engage a ghosted lead', 'Hey {{lead_name}}, still thinking about solving {{lead_problem}}? We just opened a few spots this month.', [{ type: 'Quick reply', text: 'Yes, tell me more' }]),
    tpl('webinar_nurture', 'Marketing', 'Internally Approved', 'Nurture webinar attendees', 'Thanks for attending our webinar, {{lead_name}}! Here is the replay + a special offer for {{campaign_name}} attendees.', [{ type: 'Visit website', text: 'Watch Replay', value: 'https://innovatex.com/replay' }]),
    tpl('no_show_recovery', 'Reminder', 'Submitted for Internal Review', 'Recover a no-show', 'Hi {{lead_name}}, sorry we missed you! Want to grab a new time? {{booking_link}}', [{ type: 'Booking link', text: 'Rebook' }]),
    tpl('onboarding_welcome', 'Onboarding', 'Draft', 'Welcome a new customer', 'Welcome aboard, {{lead_name}}! 🎉 Your {{company_name}} workspace is ready. Here is how to get started.', []),
    tpl('otp_auth', 'Authentication', 'Provider Approved', 'Send an OTP code', 'Your {{company_name}} verification code is {{otp}}. It expires in 5 minutes.', [{ type: 'Copy code', text: 'Copy Code' }]),
    tpl('objection_pricing', 'Support', 'Changes Requested', 'Handle a pricing objection', 'I understand budget matters, {{lead_name}}. Most clients see ROI within 60 days. Want me to share a case study?', [{ type: 'Quick reply', text: 'Yes please' }]),
  ];

  // ---- WhatsApp Campaigns (5) ----
  const campaigns: WhatsAppCampaign[] = [];
  const campStatuses: WhatsAppCampaign['status'][] = ['Completed', 'Sending', 'Scheduled', 'Pending Approval', 'Draft'];
  for (let i = 0; i < 5; i++) {
    const sent = rint(120, 800);
    const delivered = Math.floor(sent * 0.94);
    const read = Math.floor(delivered * 0.78);
    const replied = Math.floor(read * 0.22);
    campaigns.push({
      id: `wacamp_${i + 1}`, tenant_id: T1,
      name: pick(['Q2 Hot Lead Blast', 'Webinar Replay Push', 'Payment Reminder Wave', 'Ghosted Re-Engage', 'New Offer Launch']) + ` ${i + 1}`,
      template_id: templates[i % templates.length].id,
      audience_filter: pick(['Hot leads', 'Webinar attendees', 'Payment pending', 'Ghosted 14d+', 'All qualified']),
      audience_count: sent, status: campStatuses[i],
      scheduled_at: i === 2 ? daysFromNow(2) : null,
      metrics: { sent, delivered, read, replied, failed: sent - delivered, bookings: rint(5, 30), payments: rint(2, 15), revenue: rint(5, 40) * 1000 },
      is_broadcast: false,
      created_at: daysAgo(rint(2, 30)), updated_at: hoursAgo(rint(1, 40)),
    });
  }
  // Broadcasts (2)
  for (let i = 0; i < 2; i++) {
    const sent = rint(300, 1200);
    campaigns.push({
      id: `wabroad_${i + 1}`, tenant_id: T1, name: `Broadcast: ${pick(['Product Update', 'Holiday Offer'])}`,
      template_id: templates[0].id, audience_filter: 'All opted-in contacts', audience_count: sent,
      status: pick(campStatuses), scheduled_at: null,
      metrics: { sent, delivered: Math.floor(sent * 0.95), read: Math.floor(sent * 0.7), replied: rint(20, 90), failed: rint(5, 40), bookings: rint(3, 20), payments: rint(1, 10), revenue: rint(3, 25) * 1000 },
      is_broadcast: true, created_at: daysAgo(rint(2, 20)), updated_at: hoursAgo(rint(1, 30)),
    });
  }

  // ---- Delivery Logs ----
  const deliveryLogs: DeliveryLog[] = [];
  messages.slice(0, 40).forEach((m, i) => {
    deliveryLogs.push({
      id: `dlog_${i + 1}`, tenant_id: T1, message_id: m.id, lead_id: m.lead_id,
      conversation_id: m.conversation_id, template_id: m.template_id, campaign_id: m.campaign_id,
      provider_name: m.provider_name, sender: m.sender, recipient: m.recipient,
      message_type: m.message_type, status: m.status,
      sent_at: m.created_at, delivered_at: m.created_at, read_at: m.status === 'Read' || m.status === 'Replied' ? m.updated_at : null,
      failed_at: null, failure_reason: '', provider_response: '{"id":"wamid.sim","status":"accepted"}', retry_count: 0,
      created_at: m.created_at, updated_at: m.updated_at,
    });
  });

  // ---- Nurture Sequences (6) ----
  const seqDefs = [
    ['Hot Lead Follow-Up Sequence', 'Rapid touchpoints for high-intent leads', 'Lead score above 7'],
    ['Webinar Lead Nurture Sequence', 'Educate and convert webinar attendees', 'Tag: webinar'],
    ['Ghosted Lead Re-Engagement Sequence', 'Win back leads who went silent', 'Ghosted for 14 days'],
    ['Demo No-Show Recovery Sequence', 'Recover missed demo bookings', 'Booking status: No Show'],
    ['Payment Reminder Sequence', 'Nudge leads with pending payments', 'Payment pending'],
    ['Proposal Follow-Up Sequence', 'Keep proposals moving to close', 'Stage: Proposal Sent'],
  ];
  const channels = ['WhatsApp', 'Email', 'SMS', 'Manual task'] as const;
  const nurtureSequences: NurtureSequence[] = seqDefs.map((d, i) => ({
    id: `seq_${i + 1}`, tenant_id: T1, name: d[0], description: d[1], trigger: d[2],
    status: i < 4 ? 'active' : i === 4 ? 'active' : 'paused',
    enrolled_count: rint(8, 60),
    steps: Array.from({ length: rint(3, 5) }, (_, s) => ({
      id: `seq_${i + 1}_step_${s + 1}`, order: s + 1, channel: channels[s % channels.length],
      delay_days: s === 0 ? 0 : s * 2, message: `Step ${s + 1}: ${pick(outboundSamples)}`,
    })),
    created_at: daysAgo(rint(20, 90)), updated_at: hoursAgo(rint(1, 100)),
  }));

  const nurtureEnrollments: NurtureEnrollment[] = [];
  for (let i = 0; i < 8; i++) {
    nurtureEnrollments.push({
      id: `enr_${i + 1}`, tenant_id: T1, sequence_id: nurtureSequences[i % nurtureSequences.length].id,
      lead_id: leads[i].id, current_step: rint(0, 2), status: 'active',
      steps_sent: [{ step_id: `seq_1_step_1`, at: daysAgo(rint(1, 10)) }],
      created_at: daysAgo(rint(1, 20)), updated_at: hoursAgo(rint(1, 40)),
    });
  }

  // ---- Marketing Campaigns (8) ----
  const marketingCampaigns: Campaign[] = CAMPAIGN_NAMES.map((c, i) => {
    const leadsGen = rint(40, 300);
    const budget = rint(2, 20) * 1000;
    return {
      id: `mcamp_${i + 1}`, tenant_id: T1, campaign_name: c, source: pick(SOURCES),
      medium: pick(MEDIUMS), campaign_type: pick(['Paid Ads', 'Webinar', 'Email', 'Retargeting', 'ABM']),
      budget, spend: Math.floor(budget * (0.4 + rng() * 0.5)),
      start_date: daysAgo(rint(30, 120)), end_date: daysFromNow(rint(5, 40)),
      status: pick(['Active', 'Paused', 'Completed', 'Draft'] as const),
      leads_generated: leadsGen, bookings: Math.floor(leadsGen * 0.18),
      revenue: rint(10, 120) * 1000,
      created_at: daysAgo(rint(30, 120)), updated_at: hoursAgo(rint(1, 100)),
    };
  });

  // ---- Tracking Events (80) ----
  const eventTypes: TrackingEventType[] = ['Page View', 'Form Submitted', 'WhatsApp Click', 'WhatsApp Inbound Message', 'WhatsApp Outbound Message', 'Lead Created', 'AI Qualified', 'Booking Created', 'Call Completed', 'Proposal Sent', 'Payment Created', 'Payment Completed', 'Deal Won', 'Deal Lost', 'Nurture Step Sent', 'Pipeline Stage Changed', 'Campaign Sent', 'Broadcast Sent'];
  const trackingEvents: TrackingEvent[] = [];
  for (let i = 0; i < 80; i++) {
    const lead = pick(leads.filter((l) => l.tenant_id === T1));
    trackingEvents.push({
      id: `evt_${i + 1}`, tenant_id: T1, event_type: pick(eventTypes), lead_id: lead.id,
      source: lead.source, medium: lead.medium, campaign: lead.campaign,
      utm_source: lead.utm_source, utm_medium: lead.utm_medium, utm_campaign: lead.utm_campaign,
      utm_content: lead.utm_content, utm_term: lead.utm_term, provider_name: 'Native Meta Cloud API',
      lifecycle_stage: lead.status, metadata_json: { score: lead.qualification_score },
      created_at: daysAgo(rint(0, 90)), updated_at: daysAgo(rint(0, 90)),
    });
  }

  // ---- Payments (6) ----
  const payStatuses = ['Paid', 'Paid', 'Pending', 'Sent', 'Failed', 'Refunded'] as const;
  const payments: Payment[] = [];
  for (let i = 0; i < 6; i++) {
    const lead = leads[i];
    const status = payStatuses[i];
    payments.push({
      id: `pay_${i + 1}`, tenant_id: T1, lead_id: lead.id, deal_id: deals[i]?.id ?? null,
      amount: lead.value, currency: 'USD', status,
      payment_method: pick(['Card', 'Bank Transfer', 'Stripe', 'PayPal']),
      payment_link: `https://pay.innovatex.com/inv_${1000 + i}`,
      payment_date: status === 'Paid' ? daysAgo(rint(1, 20)) : null,
      source: lead.source, campaign: lead.campaign,
      created_at: daysAgo(rint(1, 30)), updated_at: hoursAgo(rint(1, 40)),
    });
  }

  // ---- Automations (6) ----
  const automations: Automation[] = [
    auto('Instant Hot Lead Alert', 'Lead score above 7', 'temperature = Hot', 'Send WhatsApp template + notify owner'),
    auto('New Lead Auto-Assign', 'New lead created', 'source = Meta Ads', 'Assign to round-robin sales rep'),
    auto('Booking Confirmation', 'Booking created', 'always', 'Send booking_confirmation template'),
    auto('Ghosted Re-Engagement', 'Lead ghosted for 14 days', 'consent = granted', 'Enroll in Ghosted Re-Engagement Sequence'),
    auto('Payment Won Sync', 'Payment completed', 'always', 'Move deal to Won + create notification'),
    auto('Proposal Follow-Up', 'Deal moved to proposal sent', 'value > 5000', 'Create follow-up task in 2 days'),
  ];

  // ---- Generic Templates (12) ----
  const genericTemplates: GenericTemplate[] = [
    gtpl('Cold Outreach Email', 'Email', 'Hi {{lead_name}}, I noticed {{company_name}} is scaling fast...'),
    gtpl('Discovery Call Script', 'Qualification script', '1. Current bottleneck? 2. Lead volume? 3. Budget?'),
    gtpl('Post-Call Follow-Up', 'Follow-up message', 'Great speaking with you, {{lead_name}}! As discussed...'),
    gtpl('Standard Proposal Outline', 'Proposal outline', 'Problem → Solution → Pricing → ROI → Next Steps'),
    gtpl('Call Summary Format', 'Call summary format', 'Attendees / Pain points / Objections / Next steps'),
    gtpl('Weekly Revenue Report', 'Weekly report format', 'Leads / Pipeline / Closed / Forecast'),
    gtpl('Re-Engagement Email', 'Email', 'Still interested in solving {{lead_problem}}?'),
    gtpl('Demo Invite', 'Email', 'Book your personalized demo here: {{booking_link}}'),
    gtpl('Payment Receipt', 'Email', 'Thank you for your payment, {{lead_name}}!'),
    gtpl('Objection: Price', 'Follow-up message', 'I hear you on budget. Most clients see ROI in 60 days...'),
    gtpl('Webinar Reminder', 'Email', 'Your webinar starts in 1 hour!'),
    gtpl('NPS Survey', 'Email', 'How likely are you to recommend us, {{lead_name}}?'),
  ];

  // ---- Notifications (12) ----
  const notifDefs: [string, string, string, string][] = [
    ['New lead', 'New hot lead captured', 'Olivia Bennett from Meta Ads (score 9)', 'flame'],
    ['Hot lead qualified', 'AI qualified a hot lead', 'Liam Carter scored 8/10 — book a call', 'sparkles'],
    ['WhatsApp reply pending', '3 conversations awaiting reply', 'Riley Quinn assigned', 'message-circle'],
    ['Template approved', 'Template approved by provider', 'welcome_hot_lead is now Active', 'check-circle'],
    ['Template rejected', 'Provider rejected a template', 'objection_pricing needs changes', 'x-circle'],
    ['Campaign approved', 'WhatsApp campaign approved', 'Q2 Hot Lead Blast is scheduled', 'megaphone'],
    ['Booking created', 'New call booked', 'Emma Hughes — Strategy Session tomorrow 2pm', 'calendar'],
    ['Call completed', 'Call logged with AI summary', 'Noah Foster — Proposal Requested', 'phone'],
    ['Payment received', 'Payment marked paid', '$18,000 from ShopWave — Deal won 🎉', 'dollar-sign'],
    ['Automation failed', 'Automation error', 'Ghosted Re-Engagement skipped (opt-out)', 'alert-triangle'],
    ['Task due', 'Follow-up task due today', 'Send proposal to GrowthLab Agency', 'clock'],
    ['Weekly summary', 'Weekly AI briefing ready', 'Pipeline up 12% — 3 deals to watch', 'bar-chart'],
  ];
  const notifications: Notification[] = notifDefs.map((n, i) => ({
    id: `notif_${i + 1}`, tenant_id: T1, type: n[0], title: n[1], message: n[2], icon: n[3],
    read: i > 6, link: '/dashboard',
    created_at: hoursAgo(i * 3 + 1), updated_at: hoursAgo(i * 3 + 1),
  }));

  // ---- Integrations ----
  const integrationDefs: [string, string, string, Integration['status'], string][] = [
    ['WhatsApp Native Panel', 'Messaging', '#25D366', 'connected', 'InnovateX native WhatsApp inbox & sending'],
    ['Meta WhatsApp Cloud API', 'Messaging', '#1877F2', 'connected', 'Official Meta Cloud API integration'],
    ['WATI', 'Messaging', '#00B86B', 'simulation', 'WATI WhatsApp Business API'],
    ['Interakt', 'Messaging', '#5B3FF9', 'disconnected', 'Interakt WhatsApp engagement'],
    ['AiSensy', 'Messaging', '#F26B3A', 'disconnected', 'AiSensy WhatsApp marketing'],
    ['Gallabox', 'Messaging', '#0EA5E9', 'disconnected', 'Gallabox conversational commerce'],
    ['Twilio WhatsApp', 'Messaging', '#F22F46', 'simulation', 'Twilio WhatsApp messaging'],
    ['360dialog', 'Messaging', '#00C4B3', 'disconnected', '360dialog WhatsApp BSP'],
    ['Meta Lead Ads', 'Lead Capture', '#1877F2', 'connected', 'Sync Meta lead ad forms'],
    ['Calendly', 'Scheduling', '#006BFF', 'connected', 'Calendly booking sync'],
    ['Cal.com', 'Scheduling', '#111827', 'disconnected', 'Open scheduling infrastructure'],
    ['Cashfree', 'Payments', '#3395FF', 'simulation', 'Cashfree subscriptions & payment gateway'],
    ['Razorpay', 'Payments', '#0C2451', 'disconnected', 'Razorpay payment links (legacy, replaced by Cashfree)'],
    ['OpenAI', 'AI', '#10A37F', 'connected', 'GPT models for AI features'],
    ['Claude', 'AI', '#D97757', 'connected', 'Anthropic Claude for qualification & summaries'],
    ['SendGrid', 'Email', '#1A82E2', 'disconnected', 'Transactional & marketing email'],
    ['Postmark', 'Email', '#FFDE00', 'disconnected', 'Reliable transactional email'],
    ['Zoom', 'Calls', '#2D8CFF', 'connected', 'Video call recordings'],
    ['Fathom', 'Calls', '#9D4EDD', 'simulation', 'AI call recording & notes'],
    ['HubSpot', 'CRM', '#FF7A59', 'disconnected', 'Two-way CRM sync (coming soon)'],
    ['Google Ads', 'Ads', '#4285F4', 'disconnected', 'Ad spend attribution (coming soon)'],
    ['Shopify', 'Ecommerce', '#95BF47', 'disconnected', 'Store & order sync (coming soon)'],
  ];
  const integrations: Integration[] = integrationDefs.map((d, i) => ({
    id: `intg_${i + 1}`, tenant_id: T1, name: d[0], category: d[1], logo_color: d[2],
    status: d[3], description: d[4],
    last_sync: d[3] === 'disconnected' ? null : hoursAgo(rint(1, 48)),
    config: {}, error_logs: d[3] === 'simulation' ? ['Running in simulation mode — no live traffic.'] : [],
    created_at: daysAgo(rint(30, 200)), updated_at: hoursAgo(rint(1, 100)),
  }));

  // ---- Tasks ----
  const tasks: Task[] = [];
  for (let i = 0; i < 8; i++) {
    tasks.push({
      id: `task_${i + 1}`, tenant_id: T1, title: pick(['Send proposal', 'Follow up on payment', 'Confirm demo time', 'Call back hot lead', 'Review contract']) + ` — ${leads[i].name}`,
      lead_id: leads[i].id, assigned_user_id: pick(salesUsers),
      due_date: i % 2 ? daysFromNow(rint(1, 5)) : daysAgo(rint(0, 3)),
      status: i % 3 === 0 ? 'done' : 'open', priority: pick(['low', 'medium', 'high'] as const),
      created_at: daysAgo(rint(1, 10)), updated_at: hoursAgo(rint(1, 40)),
    });
  }

  // ---- Audit Logs ----
  const auditLogs: AuditLog[] = [];
  for (let i = 0; i < 14; i++) {
    auditLogs.push({
      id: `audit_${i + 1}`, tenant_id: T1, actor_id: pick(users.map((u) => u.id)),
      action: pick(['login', 'created lead', 'updated deal', 'sent campaign', 'approved template', 'marked payment paid', 'changed settings']),
      entity_type: pick(['lead', 'deal', 'template', 'campaign', 'payment']), entity_id: `ent_${i}`,
      detail: 'Action performed via dashboard',
      created_at: hoursAgo(i * 4 + 1), updated_at: hoursAgo(i * 4 + 1),
    });
  }

  const settings: Record<string, TenantSettings> = {
    [T1]: makeSettings('Innovate Coaching Co', 'innovatecoaching.com', '#6366f1'),
    [T2]: makeSettings('NexaLearn EdTech', 'nexalearn.io', '#14b8a6'),
  };

  return {
    tenants, users, leads, deals, bookings, calls, conversations, messages, templates,
    campaigns, deliveryLogs, nurtureSequences, nurtureEnrollments, marketingCampaigns,
    trackingEvents, payments, automations, genericTemplates, notifications, integrations,
    tasks, auditLogs, settings,
  };

  // ---- builders ----
  function tpl(name: string, category: WhatsAppTemplate['category'], status: WhatsAppTemplate['status'], footer: string, body: string, buttons: WhatsAppTemplate['buttons']): WhatsAppTemplate {
    const vars = Array.from(new Set((body.match(/\{\{(\w+)\}\}/g) || []).map((v) => v.replace(/[{}]/g, ''))));
    return {
      id: `tpl_${name}`, tenant_id: T1, template_name: name, category, language: 'en_US',
      header_type: 'none', header_content: '', body_message: body, footer, buttons,
      variables: vars, sample_variable_values: Object.fromEntries(vars.map((v) => [v, `[${v}]`])),
      status, rejection_reason: status.includes('Rejected') ? 'Promotional content in Utility category.' : '',
      version: 1, created_by: 'u_admin',
      approval_comments: status === 'Changes Requested' ? [{ author_id: 'u_owner', text: 'Soften the pricing language.', at: daysAgo(2), action: 'Requested Changes' }] : [],
      status_history: [{ status: 'Draft', at: daysAgo(10) }, { status, at: daysAgo(rint(1, 5)) }],
      created_at: daysAgo(rint(5, 30)), updated_at: hoursAgo(rint(1, 60)),
    };
  }
  function auto(name: string, trigger: string, condition: string, action: string): Automation {
    return {
      id: `auto_${name.toLowerCase().replace(/[^a-z]/g, '_')}`, tenant_id: T1, name, trigger, condition, action,
      status: rng() > 0.25 ? 'active' : 'inactive', last_run: hoursAgo(rint(1, 72)), created_by: 'u_admin',
      run_count: rint(12, 340), logs: [{ at: hoursAgo(rint(1, 24)), result: 'Executed successfully' }, { at: hoursAgo(rint(25, 72)), result: 'Executed successfully' }],
      created_at: daysAgo(rint(10, 90)), updated_at: hoursAgo(rint(1, 50)),
    };
  }
  function gtpl(name: string, type: string, content: string): GenericTemplate {
    return { id: `gtpl_${name.toLowerCase().replace(/[^a-z]/g, '_')}`, tenant_id: T1, name, type, content, scope: rng() > 0.7 ? 'global' : 'tenant', version: 1, created_at: daysAgo(rint(10, 90)), updated_at: hoursAgo(rint(1, 100)) };
  }
}