// Generates self-storage demo data SQL split across 4 files.
// Run: node scripts/generate_demo_seed.mjs
// Output: migrations/021a_demo_setup.sql, 021b_demo_active_tasks.sql,
//         021c_demo_completed_tasks_p1.sql, 021d_demo_completed_tasks_p2.sql
// Run them in order in Supabase SQL editor.

import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

let _seed = 42;
const rand = () => { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const range = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const uuid = (prefix, n) => `${prefix}-${String(n).padStart(12, "0")}`;
const sqlStr = (s) => s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'";
const sqlDate = (d) => d ? `'${d}'` : "NULL";

const TODAY = new Date("2026-04-30");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmt = (d) => d.toISOString().slice(0, 10);

// CSMs
const CSMS = [
  { id: uuid("c1000000-0000-0000-0000", 1), name: "Sarah Mitchell",  email: "sarah.mitchell@monument.io",  role: "Senior CSM" },
  { id: uuid("c1000000-0000-0000-0000", 2), name: "Jordan Hayes",    email: "jordan.hayes@monument.io",    role: "CSM" },
  { id: uuid("c1000000-0000-0000-0000", 3), name: "Marcus Thompson", email: "marcus.thompson@monument.io", role: "Lead CSM" },
  { id: uuid("c1000000-0000-0000-0000", 4), name: "Priya Patel",     email: "priya.patel@monument.io",     role: "CSM" },
  { id: uuid("c1000000-0000-0000-0000", 5), name: "Derek Callahan",  email: "derek.callahan@monument.io",  role: "CSM Manager" },
];

// Template
const TEMPLATE_ID = "a1b2c3d4-0000-0000-0000-000000000001";
const TEMPLATE_TASKS = [];
const addTask = (phase, name, priority, hrs, dayOffset, notes) =>
  TEMPLATE_TASKS.push({ phase, name, priority, hrs, dayOffset, notes });

// ── ANALYSIS (35) ─────────────────────────────────────────────────────────
[
  ["Internal kickoff: review signed SOW and scope", "high", 2, 0, "Internal CSM team aligns on customer goals, contract scope, and key contacts before customer kickoff."],
  ["External kickoff call with customer leadership", "critical", 2, 1, "Live video kickoff with customer's owners, ops director, and IT lead. Confirm timeline and roles."],
  ["Send welcome packet and project charter", "high", 1, 1, "Includes implementation roadmap, RACI matrix, and Monument support contact info."],
  ["Schedule recurring weekly status meetings", "medium", 0.5, 1, "30-minute weekly cadence with customer's project lead."],
  ["Set up customer Slack channel for daily comms", "low", 0.5, 1, "Shared channel between Monument CSM team and customer ops team."],
  ["Inventory all customer storage facility locations", "high", 4, 2, "Document every facility: address, square footage, climate-controlled %, gate type, office hours."],
  ["Document current management software in use", "high", 3, 3, "Identify legacy ERP (storEDGE, SiteLink, SpareFoot) and version."],
  ["Audit current data quality in legacy system", "critical", 6, 4, "Sample tenant records, payment history, and unit roster for completeness and accuracy."],
  ["Map current org chart and decision makers", "medium", 2, 4, "Identify who approves pricing changes, who manages tenants, who handles billing escalations."],
  ["Review last 12 months of financial statements", "high", 4, 5, "Understand revenue mix, occupancy trends, and seasonality. Establishes ARR baseline."],
  ["Document current pricing strategy by location", "high", 4, 6, "Capture base rates, climate-control premiums, promotional discounts, and rate increase cadence."],
  ["Document current invoicing workflow", "high", 3, 6, "Billing cycles, late fee policy, auto-pay enrollment %, NSF handling."],
  ["Document current gate/access control vendor", "critical", 3, 7, "Identify hardware (PTI, Sentinel, DoorKing) and any cloud integration."],
  ["Inventory all unit types and sizes across portfolio", "high", 5, 8, "5x5 through 20x40, climate vs non-climate, parking spaces, RV storage."],
  ["Document tenant communication channels currently used", "medium", 2, 9, "Email, SMS, postal mail. Open rates, opt-in compliance status."],
  ["Review existing tenant portal usage analytics", "medium", 2, 9, "Adoption %, online payment %, online reservation %."],
  ["Audit move-in/move-out workflows", "high", 3, 10, "Lease signing process, deposit handling, prorated billing, vacate inspections."],
  ["Document current promotional/coupon strategy", "medium", 2, 10, "First month free, military discount, prepay discounts."],
  ["Review tax setup by jurisdiction", "high", 3, 11, "Sales tax on rent, occupancy tax."],
  ["Document insurance/protection plan offering", "medium", 2, 11, "Tenant protection plan vendor, opt-in vs opt-out, monthly fee tiers."],
  ["Audit current reporting and KPI dashboards", "medium", 3, 12, "What does ops actually use daily?"],
  ["Document compliance and audit requirements", "high", 2, 12, "Lien sale process by state, retention periods, PCI scope."],
  ["Review accounts receivable aging detail", "high", 3, 13, "Bucket delinquency: 30/60/90/120+ days. Identify accounts pending lien sale."],
  ["Map current third-party integrations in use", "high", 3, 14, "Payment processor, marketing platforms, accounting (QuickBooks/NetSuite), call center."],
  ["Identify all staff users and their permissions", "medium", 2, 15, "Site managers, district managers, accounting, executive — current role definitions."],
  ["Review current call center / phone system setup", "medium", 2, 15, "Centralized call center vs onsite phones, call recording, lead capture."],
  ["Document current website + reservation flow", "high", 3, 16, "Website CMS, online reservation funnel, lead-to-rental conversion rates."],
  ["Review historical occupancy and churn trends", "medium", 4, 17, "24-month occupancy curves by location. Average tenant length of stay."],
  ["Identify edge-case scenarios to handle", "medium", 2, 18, "Long-term vacancies, abandoned units, court-ordered holds, business tenants."],
  ["Conduct site visit to flagship facility", "high", 6, 20, "In-person walkthrough: gate, office, units."],
  ["Conduct site visit to lowest-performing facility", "medium", 6, 21, "Understand operational challenges Monument should help address."],
  ["Run stakeholder interviews with site managers", "high", 4, 22, "1-on-1 calls with 5+ site managers to capture daily pain points."],
  ["Prioritize must-have vs nice-to-have features", "critical", 3, 23, "MoSCoW prioritization to lock scope before design phase."],
  ["Confirm hardware compatibility for gate integration", "critical", 2, 24, "Verify Monument supports each customer's gate hardware version."],
  ["Sign off on Analysis Phase deliverables", "critical", 2, 25, "Customer signs Phase 1 acceptance doc."],
].forEach(([n, p, h, d, nt]) => addTask("Analysis", n, p, h, d, nt));

// ── DESIGN (40) ───────────────────────────────────────────────────────────
[
  ["Design future-state location hierarchy in Monument", "critical", 4, 26, "Group locations by region/district. Plan rollup reporting structure."],
  ["Design unit type catalog mapping", "high", 5, 27, "Map customer's existing unit types to Monument's standard taxonomy."],
  ["Design pricing rule architecture", "critical", 6, 28, "Base rate + climate premium + size tier + promo layer + auto-rate-increase cadence."],
  ["Design rate change automation rules", "high", 4, 30, "Existing tenant rate increase: trigger month, % cap, notice period, exemptions."],
  ["Design promotional code structure", "medium", 3, 31, "Code formats, eligibility rules, expiration logic, stacking rules."],
  ["Design tax configuration matrix", "high", 4, 32, "Per-jurisdiction tax setup. Includes occupancy tax, fees, and exemptions."],
  ["Design invoice template — standard tenant", "high", 3, 33, "Layout, branding, line items, payment instructions, late fee disclosure."],
  ["Design invoice template — commercial/business tenant", "medium", 2, 34, "Net-30 terms, PO references, separate billing contact."],
  ["Design payment plan / arrears template", "medium", 2, 34, "For tenants on catch-up plans before lien sale."],
  ["Design email notification templates (15 events)", "high", 6, 36, "Welcome, invoice, payment received, late notice, lien notice, rate change."],
  ["Design SMS notification templates (8 events)", "medium", 3, 37, "Short-form versions of high-priority email notifications. TCPA compliance review."],
  ["Design postal mail template — pre-lien notice", "high", 2, 38, "Statutory required notice with state-specific language."],
  ["Design tenant portal user flows", "high", 5, 39, "Account creation, payment, autopay enrollment, move-out request, document upload."],
  ["Design tenant portal branding guidelines", "medium", 3, 40, "Logo, color palette, typography. Customer provides brand kit."],
  ["Design online reservation/rental flow", "critical", 6, 42, "Search → select unit → reserve → ID upload → e-sign → autopay → gate code."],
  ["Design lease agreement template", "high", 4, 43, "Per-state lease template. Required clauses, signature blocks, addenda for vehicle storage."],
  ["Design auto-pay enrollment flow", "high", 3, 44, "Default-on at move-in vs opt-in. ACH vs card. Failure handling."],
  ["Design refund/credit handling rules", "medium", 2, 45, "Move-out prorations, overpayment refunds, courtesy credits."],
  ["Design gate access integration approach", "critical", 6, 46, "API-based code provisioning, real-time sync, fallback procedures."],
  ["Design gate code generation rules", "high", 3, 47, "Code length, uniqueness across locations, expiration on move-out, dual-code for households."],
  ["Design facility office hours and access window rules", "medium", 2, 48, "24-hour vs gate-hours-only access. After-hours access fees if applicable."],
  ["Design staff role/permission matrix", "high", 4, 50, "Site manager, district manager, accounting, executive, owner — each role's allowed actions."],
  ["Design audit log retention and reporting policy", "medium", 2, 51, "What actions logged, who can view, how long retained."],
  ["Design lien sale workflow per state", "critical", 6, 52, "Notice timing, advertising requirements, auction platform integration, sale proceeds handling."],
  ["Design abandoned unit / cleanup workflow", "medium", 2, 53, "Disposal flow when no bidders at lien sale."],
  ["Design tenant protection plan / insurance integration", "medium", 3, 54, "Auto-enroll at move-in, monthly billing, claim filing process."],
  ["Design accounting export format for QuickBooks", "high", 4, 55, "Daily journal entry format, GL account mapping, deferred revenue handling."],
  ["Design accounting export format for NetSuite", "medium", 3, 55, "For larger operators using NetSuite. CSV import format."],
  ["Design KPI dashboard layout for site managers", "high", 4, 57, "Daily occupancy, move-ins/outs, AR aging, today's tasks."],
  ["Design KPI dashboard layout for executives", "high", 3, 58, "Portfolio occupancy, NOI, revenue per square foot, year-over-year trends."],
  ["Design data migration strategy and field mapping", "critical", 8, 60, "Tenant master, unit master, payment history, AR balance, lease docs. Field-level mapping."],
  ["Design data migration cutover plan", "critical", 4, 61, "Go-live weekend timeline, freeze window, validation checkpoints, rollback plan."],
  ["Design pre-go-live testing strategy", "high", 3, 62, "UAT scenarios, regression scope, performance test plan."],
  ["Design training plan for site managers", "high", 4, 63, "Self-paced LMS modules + 4-hour live virtual workshop per cohort."],
  ["Design training plan for executives and owners", "medium", 2, 64, "1-hour overview focused on reporting and KPIs."],
  ["Design hypercare support coverage plan", "high", 2, 64, "On-call rotation for 30 days post-go-live. Response SLA tiers."],
  ["Design success metrics and 90-day check-in plan", "medium", 2, 65, "Adoption KPIs, occupancy trend monitoring, customer health score."],
  ["Review designs with customer leadership", "critical", 4, 65, "Walk through every design doc. Capture feedback before development starts."],
  ["Iterate on designs based on customer feedback", "high", 4, 65, "Incorporate revisions. May require additional review cycle."],
  ["Sign off on Design Phase deliverables", "critical", 2, 65, "Customer signs Phase 2 acceptance doc."],
].forEach(([n, p, h, d, nt]) => addTask("Design", n, p, h, d, nt));

// ── DEVELOP (60) ──────────────────────────────────────────────────────────
[
  ["Provision Monument tenant for customer", "critical", 1, 66, "Create production environment. Assign dedicated subdomain."],
  ["Configure organization-level settings", "high", 2, 66, "Company name, logo, primary contact, default currency, timezone."],
  ["Create location hierarchy in Monument", "critical", 4, 67, "Build out region/district/facility tree per design."],
  ["Configure each facility — basic info", "high", 8, 70, "Address, hours, contact phone, manager assignment, square footage."],
  ["Configure each facility — gate hours", "high", 3, 71, "Standard access hours and exception schedules."],
  ["Configure each facility — office hours", "medium", 2, 71, "Lobby hours separate from gate access."],
  ["Build unit type catalog", "critical", 6, 72, "All unit types from design doc. Climate flags, dimensions, parking flag."],
  ["Build pricing rule sets per location", "critical", 10, 75, "Base rates, premiums, promotions per design pricing matrix."],
  ["Configure rate change automation per location", "high", 4, 77, "Existing tenant rate increase rules per location."],
  ["Build promotional codes catalog", "medium", 3, 78, "All promo codes, eligibility, expirations."],
  ["Configure tax rules per jurisdiction", "high", 6, 80, "Sales tax, occupancy tax, fee taxability per design matrix."],
  ["Build standard tenant invoice template", "high", 4, 82, "Per design. Branded layout."],
  ["Build commercial tenant invoice template", "medium", 2, 83, "Net-30 variant."],
  ["Build payment plan template", "low", 1, 83, "For tenants on arrears plans."],
  ["Configure email sender domain (DKIM/SPF)", "high", 2, 84, "Authenticate customer's domain so emails don't go to spam."],
  ["Build all 15 email notification templates", "high", 8, 86, "Per design. Test rendering in Outlook/Gmail/iOS Mail."],
  ["Build all 8 SMS notification templates", "medium", 4, 87, "Per design. Configure TCPA opt-in handling."],
  ["Configure postal mail vendor integration", "high", 4, 89, "Lob or PostGrid for automated lien notice mailings."],
  ["Build pre-lien notice mail template", "high", 3, 89, "Per state, with statutory required language."],
  ["Build tenant portal branding", "medium", 4, 91, "Apply customer logo, colors, fonts to portal."],
  ["Configure tenant portal authentication", "high", 3, 91, "Password rules, MFA option, social login if requested."],
  ["Build online reservation widget", "critical", 6, 93, "Embed code for customer's website. Test funnel end-to-end."],
  ["Configure customer's lease agreement", "high", 4, 95, "Upload per-state lease, configure signature blocks."],
  ["Configure auto-pay enrollment defaults", "high", 2, 96, "Per design. Default-on or opt-in based on customer choice."],
  ["Configure payment processor (Stripe/Authorize.net)", "critical", 4, 97, "Connect customer's merchant account. Test transactions."],
  ["Configure ACH processing", "high", 3, 98, "ACH-specific routing, NSF handling, return code mapping."],
  ["Configure refund and credit rules", "medium", 2, 99, "Per design. Approval thresholds for site managers."],
  ["Set up gate API integration — first facility", "critical", 6, 100, "Pilot integration with one facility's gate. Validate code provisioning."],
  ["Roll out gate integration to remaining facilities", "critical", 12, 105, "Replicate across all facilities. Coordinate with onsite IT."],
  ["Configure gate code generation rules", "high", 3, 106, "Per design. Test code uniqueness across locations."],
  ["Configure facility office and access hours", "medium", 4, 107, "Apply per-facility hour configurations."],
  ["Build staff user accounts", "high", 6, 109, "Create accounts for all staff. Assign roles per permission matrix."],
  ["Configure staff role permissions", "high", 4, 110, "Apply role permissions per design. Test least-privilege access."],
  ["Configure audit logging policies", "medium", 2, 111, "Per design retention and reporting rules."],
  ["Build per-state lien sale workflow", "critical", 8, 113, "Per design. Includes notice timing, ad placement, auction integration."],
  ["Configure lien auction platform integration", "high", 4, 114, "StorageTreasures or similar. API key setup."],
  ["Configure abandoned unit / cleanup workflow", "low", 2, 115, "Per design."],
  ["Configure tenant protection plan integration", "medium", 4, 116, "SBOA, MiniCo, or chosen vendor. API setup, billing flow."],
  ["Build QuickBooks accounting export", "high", 6, 118, "Daily journal entry export per design GL mapping."],
  ["Build NetSuite accounting export", "medium", 4, 119, "For NetSuite customers. CSV format."],
  ["Build site manager dashboard", "high", 4, 121, "Per design KPI layout."],
  ["Build executive dashboard", "high", 4, 122, "Per design KPI layout. Portfolio rollup."],
  ["Configure scheduled report subscriptions", "medium", 3, 123, "Email scheduled reports to executives weekly/monthly."],
  ["Set up data migration staging environment", "critical", 4, 100, "Sandbox tenant for trial migrations."],
  ["Run trial data migration #1 — small subset", "critical", 6, 102, "Migrate 1 facility's data as proof of concept."],
  ["Validate trial migration #1", "critical", 4, 103, "Spot-check tenant records, balances, payment history."],
  ["Run trial data migration #2 — full portfolio (sandbox)", "critical", 8, 110, "Full portfolio migration to sandbox. Capture timing."],
  ["Validate trial migration #2 — sample tenant audits", "critical", 6, 112, "100-tenant random sample. Verify every field."],
  ["Validate trial migration #2 — financial reconciliation", "critical", 6, 114, "Reconcile AR balance, deferred revenue, deposit liabilities."],
  ["Validate trial migration #2 — unit roster reconciliation", "critical", 4, 115, "Verify every unit migrated with correct type and rate."],
  ["Build data migration runbook for go-live", "high", 4, 117, "Step-by-step cutover script with timing estimates."],
  ["Configure tenant portal — autopay setup flow", "high", 3, 118, "Self-service autopay enrollment in portal."],
  ["Configure tenant portal — move-out request flow", "medium", 2, 119, "Self-service move-out request submission."],
  ["Configure tenant portal — document upload", "low", 1, 119, "ID and insurance upload capability."],
  ["Set up call center integration (if applicable)", "medium", 4, 120, "Five9, Talkdesk, or similar. Click-to-call from Monument."],
  ["Configure marketing platform integration", "low", 2, 121, "HubSpot or similar for lead nurturing post-reservation."],
  ["Configure SSO for staff (if requested)", "medium", 3, 122, "SAML or Okta integration for staff login."],
  ["Build custom reports requested by customer", "medium", 6, 124, "Any non-standard reports identified during design."],
  ["Configure backup and disaster recovery", "high", 2, 125, "Verify daily backup schedule. Document restore procedure."],
  ["Sign off on Develop Phase deliverables", "critical", 2, 125, "Customer signs Phase 3 acceptance. Triggers Evaluate phase."],
].forEach(([n, p, h, d, nt]) => addTask("Develop", n, p, h, d, nt));

// ── EVALUATE (30) ─────────────────────────────────────────────────────────
[
  ["Define UAT test scenarios — move-in flow", "critical", 3, 126, "Scenarios for online reservation, walk-in, phone reservation, transfer."],
  ["Define UAT test scenarios — billing", "critical", 4, 127, "First invoice, monthly invoice, prorated, late fee, NSF, refund."],
  ["Define UAT test scenarios — payment", "critical", 3, 128, "Card, ACH, autopay, manual, partial, overpayment."],
  ["Define UAT test scenarios — move-out", "critical", 3, 128, "Standard, lien sale, transfer, abandoned."],
  ["Define UAT test scenarios — gate access", "high", 2, 129, "Code provisioning at move-in, deactivation at move-out, dual-code households."],
  ["Define UAT test scenarios — staff workflows", "high", 3, 130, "Each role's daily tasks tested by an actual user in that role."],
  ["Define UAT test scenarios — reporting", "medium", 2, 131, "All standard reports run with realistic data; verify totals match."],
  ["Define UAT test scenarios — lien sale", "high", 3, 132, "Full simulation per state. Verify notice timing and language."],
  ["Conduct UAT — move-in flow with site managers", "critical", 6, 134, "Live UAT session. Capture issues."],
  ["Conduct UAT — billing scenarios with accounting", "critical", 6, 135, "Live UAT with accounting team."],
  ["Conduct UAT — payment processing", "critical", 4, 136, "Process real test transactions; verify settlement."],
  ["Conduct UAT — move-out flow", "high", 4, 137, "Includes refund processing edge cases."],
  ["Conduct UAT — gate access end-to-end", "critical", 6, 139, "On-site validation at flagship facility."],
  ["Conduct UAT — tenant portal walkthrough", "high", 3, 140, "Site manager poses as tenant; runs through full portal."],
  ["Conduct UAT — online reservation funnel", "critical", 4, 141, "End-to-end public reservation; complete a real reservation as a test."],
  ["Conduct UAT — staff role permissions", "high", 4, 142, "Verify each role has correct permissions; no over-privilege."],
  ["Conduct UAT — reporting accuracy", "high", 4, 143, "Reconcile every standard report against legacy system."],
  ["Conduct UAT — lien sale simulation", "medium", 4, 144, "Run a full lien cycle with test data."],
  ["Triage all UAT issues", "critical", 4, 145, "Categorize critical/high/medium/low. Assign fixes."],
  ["Resolve all critical UAT issues", "critical", 12, 148, "Block go-live until all critical issues fixed."],
  ["Resolve all high UAT issues", "high", 8, 150, "Most high issues resolved before go-live; remaining tracked for hypercare."],
  ["Run regression after fixes", "high", 6, 151, "Re-run all UAT scenarios after fixes applied."],
  ["Conduct performance/load test", "medium", 4, 152, "Simulate peak month-end billing run; verify timing under load."],
  ["Conduct security review", "high", 3, 152, "Authentication, authorization, PII handling, PCI scope review."],
  ["Validate accounting export against legacy", "high", 4, 153, "Run parallel exports; reconcile to the penny for one month."],
  ["Validate tax calculations against legacy", "high", 3, 153, "Sample 50 tenants per jurisdiction; verify tax matches."],
  ["Get formal customer sign-off on UAT", "critical", 2, 154, "Customer signs UAT acceptance doc."],
  ["Set go-live date and freeze window", "critical", 2, 154, "Lock weekend cutover date; communicate to all stakeholders."],
  ["Conduct go/no-go meeting", "critical", 2, 155, "Final readiness review with customer leadership."],
  ["Sign off on Evaluate Phase deliverables", "critical", 2, 155, "Customer signs Phase 4 acceptance."],
].forEach(([n, p, h, d, nt]) => addTask("Evaluate", n, p, h, d, nt));

// ── DEPLOY (25) ───────────────────────────────────────────────────────────
[
  ["Run training cohort 1 — site managers", "critical", 4, 156, "Live virtual workshop. Record for replay."],
  ["Run training cohort 2 — site managers", "critical", 4, 157, "Second cohort if needed."],
  ["Run training — accounting team", "high", 3, 158, "Focus on billing, payments, reconciliation, exports."],
  ["Run training — district managers", "high", 3, 159, "Focus on reporting, oversight, exception handling."],
  ["Run training — executives and owners", "medium", 2, 160, "1-hour overview; focus on KPI dashboards."],
  ["Distribute training recordings and quick-reference guides", "medium", 1, 161, "LMS access provided to all staff."],
  ["Pre-cutover communication to tenants", "high", 2, 162, "Email blast announcing portal change; provide new portal URL."],
  ["Pre-cutover communication to staff", "medium", 1, 162, "Internal memo with cutover timeline and support contacts."],
  ["Freeze legacy system for write operations", "critical", 1, 165, "Prevents new data entry during cutover. Read-only mode."],
  ["Run final data migration to production", "critical", 8, 166, "Full portfolio migration during cutover window."],
  ["Validate production migration — financial totals", "critical", 4, 167, "AR balance, deferred revenue, deposits all match legacy frozen state."],
  ["Validate production migration — tenant counts", "critical", 2, 167, "Tenant count and unit count match legacy."],
  ["Validate production migration — sample tenant audit", "critical", 4, 167, "100-record random audit; confirm field-level accuracy."],
  ["Activate gate integration in production", "critical", 4, 168, "Switch gate from legacy to Monument. Validate at every facility."],
  ["Activate tenant portal in production", "critical", 2, 168, "Make portal URL live. Update website redirects."],
  ["Activate online reservations in production", "critical", 2, 168, "Embed widget on customer's marketing site."],
  ["Run first month-end billing in production", "critical", 6, 175, "Closely monitor; resolve issues in real time."],
  ["Validate first month-end billing — sample 50 invoices", "critical", 4, 176, "Spot-check every line item against legacy."],
  ["Validate first month-end billing — financial reconciliation", "critical", 6, 177, "Reconcile new system totals against legacy parallel run."],
  ["Process first batch of payments in production", "critical", 4, 178, "Process autopay run; verify settlement."],
  ["Hypercare daily check-ins (week 1)", "critical", 5, 179, "Daily 30-min standup; resolve issues end of day."],
  ["Hypercare daily check-ins (week 2)", "high", 5, 180, "Continue daily check-ins."],
  ["Hypercare weekly check-ins (weeks 3-4)", "high", 4, 180, "Reduce cadence to weekly."],
  ["30-day post-go-live review", "high", 2, 180, "Review adoption metrics, escalations, and outstanding issues."],
  ["Sign off on Deploy Phase — formal project closure", "critical", 2, 180, "Customer signs project closure. Transition to ongoing CSM relationship."],
].forEach(([n, p, h, d, nt]) => addTask("Deploy", n, p, h, d, nt));

// ── Customers (150) ───────────────────────────────────────────────────────
const FIRST = ["Liam","Olivia","Noah","Emma","Ethan","Ava","James","Sophia","Lucas","Isabella","Mason","Mia","Logan","Charlotte","Aiden","Amelia","Henry","Harper","Sebastian","Evelyn","Jack","Abigail","Owen","Emily","Daniel","Elizabeth","Wyatt","Sofia","Carter","Madison","Julian","Avery","Jackson","Ella","Levi","Scarlett","Theo","Grace","Anthony","Chloe","Hudson","Victoria","David","Riley","Joseph","Aria","Samuel","Lily","Joshua","Hannah"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts"];
const PFX = ["StorSafe","SecureVault","IronGate","Pinnacle","Summit","Apex","Heritage","Liberty","Patriot","Sentinel","Fortress","Anchor","Compass","Beacon","Cornerstone","Foundation","Keystone","Cardinal","Centennial","Frontier","Harbor","Highland","Lakeside","Meridian","Northstar","Oakwood","Pacific","Premier","Prime","Riverside","Sterling","Sunset","Trident","United","Vanguard","Westpoint","Acadia","Allegheny","Cascade","Coastal","Cumberland","Delta","Empire","Evergreen","Gateway","Granite","Greater","Horizon","Independence","Lincoln","Madison","Mountain","Plains","Sequoia","Shelter","Skyline","Statewide","Trailblazer","Triumph","Yorkshire","Atlas","Blackstone","Bluegrass","Capitol","Carolina","Chesapeake","Citadel","Continental","Crescent","Cypress","Dakota","Diamond","Eagle","Elite","Emerald","Endeavor","Fairview","Federal","Forge","Galaxy","Grand","Greenleaf","Heartland","Hilltop","Ironclad","Jefferson","Lakeshore","Magnolia","Maple","Midwest","Monarch","National","Nautical","Navigator","Nexus","Northwest","Olympic","Pioneer","Plateau","Prairie","Prestige","Providence","Pure","Ranger","Redwood","Reliable","Rockford","Royal","Sandstone","Saratoga","Shepherd","Sierra","Silverlake","Southland","Spectrum","Springfield","Stagecoach","Stoneridge","Stronghold","Sunbelt","Tahoe","Thunder","Tidewater","Tower","Tristate","Tustin","Valley","Vermont","Vertex","Watershed","Westgate","Whitestone","Wildwood","Windward","Wolverine","Yellowstone","Zephyr","Atlantic","Cedar"];
const SFX = ["Self Storage","Storage","Storage Group","Storage Holdings","Self Storage LLC","Storage Partners","Storage Solutions","Mini Storage","Storage Centers","Storage Properties","Self Storage Inc","Storage Co","Storage Network","Storage Communities","Storage REIT","Storage Trust"];
const CITY = [["Phoenix","AZ"],["Denver","CO"],["Atlanta","GA"],["Charlotte","NC"],["Nashville","TN"],["Dallas","TX"],["Austin","TX"],["Houston","TX"],["Indianapolis","IN"],["Columbus","OH"],["Jacksonville","FL"],["Tampa","FL"],["Orlando","FL"],["Las Vegas","NV"],["Salt Lake City","UT"],["Portland","OR"],["Seattle","WA"],["Sacramento","CA"],["San Diego","CA"],["Riverside","CA"],["Kansas City","MO"],["St Louis","MO"],["Minneapolis","MN"],["Milwaukee","WI"],["Cincinnati","OH"],["Cleveland","OH"],["Pittsburgh","PA"],["Philadelphia","PA"],["Baltimore","MD"],["Richmond","VA"],["Raleigh","NC"],["Birmingham","AL"],["New Orleans","LA"],["Memphis","TN"],["Louisville","KY"],["Oklahoma City","OK"],["Tulsa","OK"],["Albuquerque","NM"],["Tucson","AZ"],["Reno","NV"]];
const STREET = ["Main St","Industrial Pkwy","Commerce Dr","Storage Way","Logistics Blvd","Warehouse Rd","Enterprise Ct"];
const NOTE_STYLES = (n) => pick([
  `${n}-facility regional operator focused on climate-controlled storage.`,
  `${n}-facility chain serving suburban markets across multiple states.`,
  `${n}-facility operator with strong online reservation funnel.`,
  `${n}-location portfolio recently acquired from a private equity rollup.`,
  `${n}-facility operator with onsite resident managers at flagship sites.`,
  `${n}-location chain transitioning from SiteLink to Monument.`,
  `${n}-facility operator transitioning from storEDGE.`,
  `${n}-facility operator transitioning from SpareFoot management tools.`,
  `${n}-location operator with significant RV and vehicle storage mix.`,
  `${n}-facility operator with 24/7 access and high autopay adoption.`,
]);

const used = new Set();
const CUSTOMERS = [];
let attempts = 0;
while (CUSTOMERS.length < 150 && attempts < 5000) {
  attempts++;
  const n = `${pick(PFX)} ${pick(SFX)}`;
  if (used.has(n)) continue;
  used.add(n);
  const i = CUSTOMERS.length + 1;
  const fn = pick(FIRST), ln = pick(LAST);
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const [city, state] = pick(CITY);
  const fc = range(3, 65);
  CUSTOMERS.push({
    id: uuid("c2000000-0000-0000-0000", i),
    name: n,
    contact_name: `${fn} ${ln}`,
    contact_email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${slug}.com`,
    contact_phone: `(${range(200, 999)}) ${range(200, 999)}-${range(1000, 9999)}`,
    address: `${range(100, 9999)} ${pick(STREET)}, ${city}, ${state} ${range(10000, 99999)}`,
    notes: NOTE_STYLES(fc),
    renewal_date: fmt(addDays(TODAY, range(30, 540))),
  });
}

// ── Projects (50 active + 100 completed) ──────────────────────────────────
const PHASES = ["Analysis","Design","Develop","Evaluate","Deploy"];
const HEALTH = ["green","green","green","yellow","yellow","red"];
const ACTIVE = [], COMPLETED = [];
let cIdx = 0;

for (let csmI = 0; csmI < 5; csmI++) {
  const csm = CSMS[csmI];
  for (let p = 0; p < 10; p++) {
    const cust = CUSTOMERS[cIdx++];
    const phase = PHASES[(csmI * 2 + p) % 5];
    const bias = csmI === 0 ? 1.3 : csmI === 2 ? 1.25 : csmI === 3 ? 0.7 : csmI === 4 ? 0.85 : 1.0;
    const start = addDays(TODAY, -range(10, 150));
    const target = addDays(TODAY, range(40, 200));
    ACTIVE.push({
      id: uuid("a0000000-0000-0000-0000", csmI * 10 + p + 1),
      csm, customer: cust, stage: phase, health: pick(HEALTH),
      arr: range(15000, 70000), start, target,
      completion: phase === "Analysis" ? range(5, 25) : phase === "Design" ? range(25, 45) : phase === "Develop" ? range(45, 70) : phase === "Evaluate" ? range(70, 88) : range(88, 98),
      loadBias: bias,
    });
  }
}
for (let i = 0; i < 100; i++) {
  const cust = CUSTOMERS[cIdx++];
  const csm = CSMS[i % 5];
  const finishedAgo = range(7, 360);
  const start = addDays(TODAY, -finishedAgo - range(120, 200));
  const target = addDays(TODAY, -finishedAgo);
  COMPLETED.push({
    id: uuid("d0000000-0000-0000-0000", i + 1),
    csm, customer: cust, stage: "Deploy", health: "green",
    arr: range(15000, 70000), start, target, completion: 100,
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────────
const phaseOrder = (p) => PHASES.indexOf(p);
const ACTIVE_TASKS = [];
let atc = 1;
ACTIVE.forEach((proj) => {
  const ci = phaseOrder(proj.stage);
  TEMPLATE_TASKS.forEach((t) => {
    const ti = phaseOrder(t.phase);
    let status, actualDate = null;
    if (ti < ci) { status = "complete"; actualDate = addDays(proj.start, t.dayOffset + range(-3, 3)); }
    else if (ti === ci) {
      const r = rand();
      if (r < proj.completion / 100) { status = "complete"; actualDate = addDays(proj.start, t.dayOffset + range(-2, 4)); }
      else { const pd = addDays(proj.start, t.dayOffset); status = pd < TODAY ? "late" : "upcoming"; }
    } else if (ti === ci + 1) { status = "upcoming"; }
    else return;
    ACTIVE_TASKS.push({
      id: uuid("ea000000-0000-0000-0000", atc++),
      project_id: proj.id, name: t.name, phase: t.phase, priority: t.priority, status,
      proj_date: fmt(addDays(proj.start, t.dayOffset)),
      actual_date: actualDate ? fmt(actualDate) : null,
      assignee_name: proj.csm.name,
      estimated_hours: Math.round(t.hrs * proj.loadBias * 10) / 10,
      notes: t.notes,
    });
  });
});

const COMPLETED_TASKS = [];
let ctc = 1;
COMPLETED.forEach((proj) => {
  TEMPLATE_TASKS.forEach((t) => {
    COMPLETED_TASKS.push({
      id: uuid("ec000000-0000-0000-0000", ctc++),
      project_id: proj.id, name: t.name, phase: t.phase, priority: t.priority, status: "complete",
      proj_date: fmt(addDays(proj.start, t.dayOffset)),
      actual_date: fmt(addDays(proj.start, t.dayOffset + range(-2, 4))),
      assignee_name: proj.csm.name,
      estimated_hours: t.hrs,
      notes: t.notes,
    });
  });
});

// ── Notes ─────────────────────────────────────────────────────────────────
const NOTE_BODIES = [
  "Customer happy with progress. No major blockers this week.",
  "Discovered legacy system has more data quality issues than expected; adding a cleanup task before migration.",
  "Customer's IT lead is on PTO next week; expect a slight slip in gate integration validation.",
  "Pricing rules took longer than estimated — customer has 14 distinct rate cards across portfolio.",
  "Trial migration ran clean. Financial reconciliation matched to the penny.",
  "Site managers gave great feedback during UAT — adoption looks strong.",
  "Customer asked to add a second QuickBooks export variant for their parent company.",
  "Gate vendor hardware is a slightly older firmware; coordinated with vendor on a minor patch.",
  "Customer leadership wants to push go-live by 2 weeks to avoid a marketing campaign overlap.",
  "Owner attended training session and was visibly impressed with the dashboard.",
  "Tenant portal load testing showed solid performance under simulated month-end load.",
  "Customer's accounting team is requesting an additional reconciliation report — added to scope.",
  "Discovered 3 abandoned units that were never tracked in legacy; surfaced for cleanup pre-migration.",
  "Lien sale workflow walkthrough went well; customer signed off on per-state language.",
  "Auto-pay enrollment defaults updated based on customer feedback — opt-in instead of default-on.",
];
const PROJECT_NOTES = [];
let nc = 1;
ACTIVE.forEach((proj) => {
  const n = range(2, 4);
  for (let i = 0; i < n; i++) {
    PROJECT_NOTES.push({
      id: uuid("bd000000-0000-0000-0000", nc++),
      project_id: proj.id, csm_id: proj.csm.id,
      author: proj.csm.name, body: pick(NOTE_BODIES),
    });
  }
});
COMPLETED.slice(0, 30).forEach((proj) => {
  PROJECT_NOTES.push({
    id: uuid("bd000000-0000-0000-0000", nc++),
    project_id: proj.id, csm_id: proj.csm.id,
    author: proj.csm.name,
    body: "Project closed successfully. Customer transitioned to ongoing CSM relationship.",
  });
});

// ── Assignments ───────────────────────────────────────────────────────────
const ASSIGNMENTS = [];
let ac = 1;
[...ACTIVE, ...COMPLETED].forEach((proj) => {
  ASSIGNMENTS.push({
    id: uuid("bc000000-0000-0000-0000", ac++),
    csm_id: proj.csm.id, project_id: proj.id,
    role: "primary", allocation_pct: 100,
    start_date: fmt(proj.start),
    end_date: proj.completion === 100 ? fmt(proj.target) : null,
  });
});

// ── Build SQL ─────────────────────────────────────────────────────────────
const batched = (table, columns, rows, valueRowFn, batchSize = 500) => {
  const out = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const values = slice.map(valueRowFn).join(",\n  ");
    out.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n  ${values};`);
  }
  return out;
};
const writeOut = (n, label, lines) => {
  const path = join(process.cwd(), "migrations", `021${n}_demo_${label}.sql`);
  writeFileSync(path, lines.join("\n"));
  return path;
};

// 021a — setup
const part1 = ["-- 021a_demo_setup.sql — Run FIRST.", "BEGIN;",
  "DELETE FROM project_notes WHERE id::text LIKE 'bd000000-%';",
  "DELETE FROM csm_assignments WHERE id::text LIKE 'bc000000-%';",
  "DELETE FROM tasks WHERE id::text LIKE 'ea000000-%' OR id::text LIKE 'ec000000-%';",
  "DELETE FROM projects WHERE id::text LIKE 'a0000000-%' OR id::text LIKE 'd0000000-%';",
  "DELETE FROM customers WHERE id::text LIKE 'c2000000-%';",
  "DELETE FROM task_template_items WHERE id::text LIKE 'b1000000-%';",
  "DELETE FROM task_templates WHERE id = 'a1b2c3d4-0000-0000-0000-000000000001';",
  "DELETE FROM csms WHERE id::text LIKE 'c1000000-%';",
];
part1.push(...batched("csms", ["id","name","email","role","is_active"], CSMS,
  (c) => `(${sqlStr(c.id)}, ${sqlStr(c.name)}, ${sqlStr(c.email)}, ${sqlStr(c.role)}, true)`));
part1.push(...batched("customers", ["id","name","contact_name","contact_email","contact_phone","address","notes","renewal_date","is_active"], CUSTOMERS,
  (c) => `(${sqlStr(c.id)}, ${sqlStr(c.name)}, ${sqlStr(c.contact_name)}, ${sqlStr(c.contact_email)}, ${sqlStr(c.contact_phone)}, ${sqlStr(c.address)}, ${sqlStr(c.notes)}, ${sqlDate(c.renewal_date)}, true)`));
part1.push("UPDATE task_templates SET is_default = false WHERE is_default = true;");
part1.push(`INSERT INTO task_templates (id, name, description, is_default, is_active) VALUES (${sqlStr(TEMPLATE_ID)}, 'Monument Self-Storage ERP Implementation', 'Full implementation template for self-storage operators onboarding to Monument ERP. 190 tasks across 5 phases.', true, true);`);
const tplRows = TEMPLATE_TASKS.map((t, i) => ({ ...t, id: uuid("b1000000-0000-0000-0000", i + 1), sort_order: i + 1 }));
part1.push(...batched("task_template_items", ["id","template_id","sort_order","name","phase","priority","estimated_hours","day_offset","notes"], tplRows,
  (t) => `(${sqlStr(t.id)}, ${sqlStr(TEMPLATE_ID)}, ${t.sort_order}, ${sqlStr(t.name)}, ${sqlStr(t.phase)}, ${sqlStr(t.priority)}, ${t.hrs}, ${t.dayOffset}, ${sqlStr(t.notes)})`));
part1.push(...batched("projects", ["id","name","customer","customer_id","csm_id","stage","health","arr","start_date","target_date","completion_pct"], ACTIVE,
  (p) => `(${sqlStr(p.id)}, ${sqlStr(p.customer.name + " Implementation")}, ${sqlStr(p.customer.name)}, ${sqlStr(p.customer.id)}, ${sqlStr(p.csm.id)}, ${sqlStr(p.stage)}, ${sqlStr(p.health)}, ${p.arr}, ${sqlStr(fmt(p.start))}, ${sqlStr(fmt(p.target))}, ${p.completion})`));
part1.push(...batched("projects", ["id","name","customer","customer_id","csm_id","stage","health","arr","start_date","target_date","completion_pct"], COMPLETED,
  (p) => `(${sqlStr(p.id)}, ${sqlStr(p.customer.name + " Implementation")}, ${sqlStr(p.customer.name)}, ${sqlStr(p.customer.id)}, ${sqlStr(p.csm.id)}, ${sqlStr(p.stage)}, ${sqlStr(p.health)}, ${p.arr}, ${sqlStr(fmt(p.start))}, ${sqlStr(fmt(p.target))}, ${p.completion})`));
part1.push(...batched("csm_assignments", ["id","csm_id","project_id","role","allocation_pct","start_date","end_date"], ASSIGNMENTS,
  (a) => `(${sqlStr(a.id)}, ${sqlStr(a.csm_id)}, ${sqlStr(a.project_id)}, ${sqlStr(a.role)}, ${a.allocation_pct}, ${sqlStr(a.start_date)}, ${sqlDate(a.end_date)})`));
part1.push(...batched("project_notes", ["id","project_id","csm_id","author","body"], PROJECT_NOTES,
  (n) => `(${sqlStr(n.id)}, ${sqlStr(n.project_id)}, ${sqlStr(n.csm_id)}, ${sqlStr(n.author)}, ${sqlStr(n.body)})`));
part1.push("COMMIT;");

// Task files — split into chunks of CHUNK_PER_FILE so each file fits the
// Supabase SQL editor (~1MB request limit). 3000 tasks ≈ 800KB/file.
const CHUNK_PER_FILE = 3000;
const taskRow = (t) => `(${sqlStr(t.id)}, ${sqlStr(t.project_id)}, ${sqlStr(t.name)}, ${sqlStr(t.phase)}, ${sqlStr(t.priority)}, ${sqlStr(t.status)}, ${sqlStr(t.proj_date)}, ${sqlDate(t.actual_date)}, 'csm', ${sqlStr(t.assignee_name)}, ${t.estimated_hours}, ${sqlStr(t.notes)})`;
const TASK_COLS = ["id","project_id","name","phase","priority","status","proj_date","actual_date","assignee_type","assignee_name","estimated_hours","notes"];

const buildTaskParts = (tasks, label) => {
  const parts = [];
  const total = Math.ceil(tasks.length / CHUNK_PER_FILE);
  for (let i = 0; i < total; i++) {
    const slice = tasks.slice(i * CHUNK_PER_FILE, (i + 1) * CHUNK_PER_FILE);
    const lines = [`-- ${label} part ${i + 1}/${total} — ${slice.length} tasks.`, "BEGIN;",
      ...batched("tasks", TASK_COLS, slice, taskRow), "COMMIT;"];
    parts.push({ idx: i + 1, total, lines });
  }
  return parts;
};

const activeParts = buildTaskParts(ACTIVE_TASKS, "active tasks");
const completedParts = buildTaskParts(COMPLETED_TASKS, "completed tasks");

// Clean up old / superseded files
for (const old of ["021_demo_seed.sql","021b_demo_active_tasks.sql","021c_demo_completed_tasks_p1.sql","021d_demo_completed_tasks_p2.sql"]) {
  const p = join(process.cwd(), "migrations", old);
  if (existsSync(p)) unlinkSync(p);
}

const written = [writeOut("a", "setup", part1)];
activeParts.forEach((p) => written.push(writeOut(`b${p.idx}`, "active_tasks", p.lines)));
completedParts.forEach((p) => written.push(writeOut(`c${p.idx}`, "completed_tasks", p.lines)));
console.log(`Wrote ${written.length} files:\n  ${written.join("\n  ")}`);
console.log(`  ${CSMS.length} CSMs / ${CUSTOMERS.length} customers / ${TEMPLATE_TASKS.length} template items`);
console.log(`  ${ACTIVE.length} active + ${COMPLETED.length} completed projects`);
console.log(`  ${ACTIVE_TASKS.length} active tasks + ${COMPLETED_TASKS.length} completed tasks`);
console.log(`  ${PROJECT_NOTES.length} notes / ${ASSIGNMENTS.length} assignments`);
