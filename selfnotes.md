1) WORKING ON LEAD

Create Lead ✅
Get All Leads ✅
Get Lead By Id ✅
Update Lead
Archive Lead
Validation
Duplicate Detection







## B3. Leads
- Fields: name, email, phone, whatsapp_number, company, source, medium, campaign, utm_source/medium/
  campaign/content/term, status, qualification_score, lead_temperature, assigned_user_id, segment,
  notes, consent_status, opt_out_status, value, created_at, last_contacted_at.

- List + search + filters (status, temperature, source); add/edit modal; archive; CSV export.

- **Duplicate detection** by email/phone.

- **Lead detail drawer:** profile, score, temperature, source/UTM, owner, **recommended next
  action (AI)**, 

  * quick actions (WhatsApp/Qualify/Book/Payment),

  * linked counts (deals/bookings/calls/payments),

  * WhatsApp message preview, notes (add), **full activity timeline**.

- **Public capture form** with UTM capture from URL + `Lead Created` tracking event.

- **Statuses:** New, Contacted, Qualified, Booked, Call Completed, Proposal Sent, Won, Lost, Nurture, Ghosted.


✅ Health Check
✅ Get Constants
✅ Create Lead
✅ Get All Leads
✅ Get Lead By ID

✅ Create Lead Validation
✅ Update Lead Validation
✅ Email Validation
✅ Status Validation
✅ Temperature Validation
✅ Qualification Score Validation
✅ Unknown Field Validation

✅ Lead Details API

✅ POST /api/leads/:id/notes

✅ GET /api/leads/:id/notes

✅ Lead Created
✅ Lead Updated
✅ Lead Archived
✅ Note Added




**CORE LEAD CRUD**

✅ Create Lead
✅ Get All Leads
✅ Get Lead By ID
✅ Update Lead
✅ Archive Lead (Soft Delete)

**VALIDATION**

✅ Create Lead Validation
✅ Update Lead Validation
✅ Email Validation
✅ Status Validation
✅ Temperature Validation
✅ Qualification Score Validation
✅ Unknown Field Validation

**LEAD LISTING**

✅ Pagination
✅ Status Filter
✅ Temperature Filter
✅ Source Filter

**SEARCH & QUERY ENGINE**

✅ Search Architecture
✅ Filter Architecture
✅ Sort Architecture

**NEED TESTING**

🟡 Search API
🟡 Sorting API

**LEAD DETAIL DRAWER**

✅ Lead Details API
✅ Notes Count
✅ Activities Count
✅ Timeline Data

**NOTES MODULE**

✅ Add Note
✅ Get Notes

**ACTIVITIES MODULE**

✅ Lead Created Activity
✅ Lead Updated Activity
✅ Lead Archived Activity
✅ Note Added Activity
✅ Get Activity Timeline

**DUPLICATE DETECTION**

✅ Duplicate Detection Service
✅ Duplicate Check During Create
✅ Duplicate Skip During Import

**IMPORT MODULE**

✅ JSON Import
✅ CSV Text Import
✅ CSV File Upload Import
✅ Duplicate Skip Logic

**SCORING MODULE**

✅ Auto Qualification Score
✅ Auto Temperature Calculation

**ASSIGNMENT MODULE**



















## B4. WhatsApp Operating Panel (native + 3rd-party mode) — **flagship**
Supports **Native InnovateX panel** and **third-party provider mode**. Providers (🟡 simulated via
adapter layer): Native Meta Cloud API, WATI, Interakt, AiSensy, Gallabox, Twilio WhatsApp, 360dialog,
Custom Webhook, Simulation Mode.

**13 tabs:**

1. **Inbox** ✅ — conversation list (search/filter),
   thread (bubbles, status, simulate inbound, assign, tags, internal notes),
   lead context panel (score, source/UTM, pipeline stage, payment status, response timer).
   Conversation statuses: New, Open, Pending, Qualified, Booked, Won, Lost, Ghosted.

2. **Contacts / Leads** ✅ — WA contacts with consent/opt-out/score.

3. **Templates** ✅ — create/edit/duplicate; status-aware actions.


4. **Template Approval** ✅ — full state machine (11 statuses), status timeline, approval comments.

          Approve
          Request Changes
          Reject

    
         Internally Approved
                ↓
         Submit To Provider  -> PROVIDER_APPROVED         
                                      or
                                PROVIDER_REJECTED 

                                Spam
                                Policy Violations
                                Misleading Claims
                                Variable Usage
                                Formatting
   WHO CAN CREATE TEMPALTE?
     sales_user
     sales_manager
     marketing_user
     marketing_manager
     tenant_owner     
  
  who can submit FOR REVIEW?
     sales_manager
     marketing_manager
     tenant_owner

  WHO CAN INTERNALLY APOPROVE? AND REJECT?
     sales_manager
     marketing_manager
     tenant_owner

  WHO CAN SUBMIT TO THE PROVIDER?
     tenant_owner
     sales_manager
     marketing_manager



            DRAFT
    ↓
    SUBMITTED_FOR_INTERNAL_REVIEW
    ↓
    INTERNALLY_APPROVED
    ↓
    SUBMITTED_TO_PROVIDER
    ↓
    PROVIDER_APPROVED
    ↓
    ACTIVE



5. **Campaigns** ✅ — audience filter + approved template + recipient count; approve/schedule/send
   (🟡 simulated metrics); metrics (sent/delivered/read/replied/failed/bookings/payments/revenue).

6. **Nurture Messages** ✅ — WA steps across sequences.

7. **AI Reply Assistant** ✅ — generate reply/booking/payment/objection/follow-up; rewrite shorter/
   professional/persuasive; copy.

8. **Broadcasts** ✅ — broadcast-flagged campaigns; exclude opted-out.

9. **Automation Rules** ✅ — WA trigger→action toggles.

10. **Opt-Out / Consent** ✅ — consent KPIs, suppression list, manual opt-out; keywords STOP/
    UNSUBSCRIBE/CANCEL/NO/REMOVE; **sending to opted-out is blocked + logged**.

11. **Delivery Logs** ✅ — per-message log (provider, recipient, status, retries, timestamps).

12. **WhatsApp Analytics** ✅ — KPIs + charts (conversations over time, reply rate by campaign,
    template performance, delivery funnel).

13. **WhatsApp Settings** ✅ — mode/provider/token/IDs/webhook/verify token/sender; sync toggles;
    "Sync now" (🟡).

**Composer** ✅: AI replies, rewrite tools, template insert, variable insert
(`{{lead_name}}`, `{{company_name}}`, `{{offer_name}}`, `{{booking_link}}`, `{{payment_link}}`,
`{{sales_rep_name}}`, `{{call_date}}`, `{{lead_problem}}`, `{{campaign_name}}`), schedule, send.
On send: append message + update conversation + lead.last_contacted_at + delivery log + tracking event + toast.

**Template Builder** ✅: name, category (10), language, header type, body (auto-detect `{{vars}}`),
footer, buttons (6 types), **live WhatsApp phone preview**.

**Template approval workflow (state machine):**
`Draft → Submitted for Internal Review → {Internally Approved | Changes Requested | Rejected Internally}
→ Submitted to Provider → {Provider Approved | Provider Rejected} → Active ↔ Paused → Archived`.
Active/Provider-Approved templates are usable in campaigns/nurture/manual/automation.












## B6. Pipeline
- ✅ 9-stage Kanban (New Lead, Qualified, Booked Call, Call Completed, Proposal Sent, Negotiation, Won, Lost, Nurture).

**Drag-and-drop** (+ arrow fallback). Deal value, probability, owner, source.

- ✅ Add/delete deal, owner filter, per-stage totals, win-rate KPI. Each move → lead status + tracking event.



Auth
↓
Tenant
↓
User
↓
Lead
↓
Booking
↓
Pipeline






Inbox ✅
↓
Contacts ✅
↓
Templates 
↓
Template Approval
↓
Campaigns
↓
Broadcasts
↓
Nurture
↓
Automations
↓
Analytics



Inbox                       ✅
Contacts                    ✅

Templates                   ⏭️
Template Approval           ⏭️

Campaigns                   ⏭️
Broadcasts                  ⏭️
Nurture                     ⏭️

AI Reply Assistant          ⏭️
Automation Rules            ⏭️

Analytics                   ⏭️
Settings                    ⏭️

Meta Cloud API              ⏭️
Webhooks                    ⏭️
Socket.IO                   ⏭️