/* ============================================================================
   CISA  ::  contentData.js
   Exam facts, per-domain metadata + objectives, PBQ format definitions,
   curated external resources, the Exam-Mechanics and Career-Guidance readers,
   and the target objects the textbook-dense domain reading modules populate
   (CISA.reading[1..5], appended from the lazy-loaded content modules).

   This file loads first and establishes the global CISA namespace consumed
   by quizEngine.js, flashEngine.js, and app.js.

   Authored by Professor Rizwan Virani.
   ========================================================================== */
window.CISA = window.CISA || {};

/* SINGLE SOURCE OF TRUTH for every exam figure. The dashboard cards, mock-exam
   engine, scoring, analytics, readiness projection, and history readouts all
   READ from this object — no exam figure is duplicated as a literal elsewhere.

   Unlike the ISC2 CAT exams, the CISA is a FIXED-FORM, linear exam: 150
   multiple-choice questions in a single 4-hour appointment, scored on ISACA's
   200–800 scale with 450 to pass. `itemsMin`/`itemsMax` are therefore equal,
   and `maxQuestions` (the full-length mock) matches the real exam length. */
CISA.exam = {
  code: "CISA",
  name: "CISA",
  fullName: "Certified Information Systems Auditor",
  vendor: "ISACA",
  format: "Fixed form",          // 150 linear multiple-choice items (not adaptive)
  minutes: 240,                  // 4 hours
  itemsMin: 150, itemsMax: 150,
  itemsLabel: "150",
  maxQuestions: 150,             // full-length mock length = the real fixed length
  scaleLow: 200, scaleHigh: 800, passing: 450,
  domains: 5,
  launched: "1978",
  body: "ISACA"
};

/* Per-domain metadata. `objectives` mirror the official ISACA CISA Exam Content
   Outline (effective August 2024) at the subtopic level. `weight` is the
   official domain weight; `sectionCount` is the number of dense reading
   sections this platform authors for the domain (one per subtopic). */
CISA.domainMeta = [
  { id: 1, weight: 18, color: "d1", icon: "🔍", title: "Information Systems Auditing Process", sectionCount: 10,
    short: "Planning and performing IS audits: audit standards and ethics, risk-based planning, evidence and sampling, data analytics, and reporting findings to management.",
    objectives: [
      { id: "1A1", t: "IS Audit Standards, Guidelines, Functions & Codes of Ethics" },
      { id: "1A2", t: "Types of Audits, Assessments & Reviews" },
      { id: "1A3", t: "Risk-Based Audit Planning" },
      { id: "1A4", t: "Types of Controls & Considerations" },
      { id: "1B1", t: "Audit Project Management" },
      { id: "1B2", t: "Audit Testing & Sampling Methodology" },
      { id: "1B3", t: "Audit Evidence Collection Techniques" },
      { id: "1B4", t: "Audit Data Analytics" },
      { id: "1B5", t: "Reporting & Communication Techniques" },
      { id: "1B6", t: "Quality Assurance & Improvement of the Audit Process" }
    ] },
  { id: 2, weight: 18, color: "d2", icon: "🏛", title: "Governance & Management of IT", sectionCount: 11,
    short: "How IT is governed and managed — strategy, policies, enterprise architecture, risk, resource and vendor management, performance monitoring — and how the auditor evaluates it.",
    objectives: [
      { id: "2A1", t: "Laws, Regulations & Industry Standards" },
      { id: "2A2", t: "Organizational Structure, IT Governance & IT Strategy" },
      { id: "2A3", t: "IT Policies, Standards, Procedures & Practices" },
      { id: "2A4", t: "Enterprise Architecture (EA) & Considerations" },
      { id: "2A5", t: "Enterprise Risk Management (ERM)" },
      { id: "2A6", t: "Privacy Program & Principles" },
      { id: "2A7", t: "Data Governance & Classification" },
      { id: "2B1", t: "IT Resource Management" },
      { id: "2B2", t: "IT Vendor Management" },
      { id: "2B3", t: "IT Performance Monitoring & Reporting" },
      { id: "2B4", t: "Quality Assurance & Quality Management of IT" }
    ] },
  { id: 3, weight: 12, color: "d3", icon: "🧱", title: "IS Acquisition, Development & Implementation", sectionCount: 8,
    short: "Auditing how systems are acquired and built: project governance, the SDLC, control design, testing, migration, and post-implementation review.",
    objectives: [
      { id: "3A1", t: "Project Governance & Management" },
      { id: "3A2", t: "Business Case & Feasibility Analysis" },
      { id: "3A3", t: "System Development Methodologies" },
      { id: "3A4", t: "Control Identification & Design" },
      { id: "3B1", t: "System Readiness & Implementation Testing" },
      { id: "3B2", t: "Implementation Configuration & Release Management" },
      { id: "3B3", t: "System Migration, Infrastructure Deployment & Data Conversion" },
      { id: "3B4", t: "Post-Implementation Review" }
    ] },
  { id: 4, weight: 26, color: "d4", icon: "⚙", title: "IS Operations & Business Resilience", sectionCount: 16,
    short: "Auditing IT operations and resilience: asset and change management, incident and problem handling, backups, business impact analysis, continuity, and disaster recovery.",
    objectives: [
      { id: "4A1", t: "IT Components" },
      { id: "4A2", t: "IT Asset Management" },
      { id: "4A3", t: "Job Scheduling & Production Process Automation" },
      { id: "4A4", t: "System Interfaces" },
      { id: "4A5", t: "Shadow IT & End-User Computing (EUC)" },
      { id: "4A6", t: "Systems Availability & Capacity Management" },
      { id: "4A7", t: "Problem & Incident Management" },
      { id: "4A8", t: "IT Change, Configuration & Patch Management" },
      { id: "4A9", t: "Operational Log Management" },
      { id: "4A10", t: "IT Service Level Management" },
      { id: "4A11", t: "Database Management" },
      { id: "4B1", t: "Business Impact Analysis (BIA)" },
      { id: "4B2", t: "System & Operational Resilience" },
      { id: "4B3", t: "Data Backup, Storage & Restoration" },
      { id: "4B4", t: "Business Continuity Plan (BCP)" },
      { id: "4B5", t: "Disaster Recovery Plans (DRP)" }
    ] },
  { id: 5, weight: 26, color: "d5", icon: "🛡", title: "Protection of Information Assets", sectionCount: 15,
    short: "Auditing security controls: identity and access management, network and endpoint security, encryption and PKI, physical security, monitoring, and incident response.",
    objectives: [
      { id: "5A1", t: "Info Asset Security Policies, Frameworks, Standards & Guidelines" },
      { id: "5A2", t: "Physical & Environmental Controls" },
      { id: "5A3", t: "Identity & Access Management" },
      { id: "5A4", t: "Network & End-Point Security" },
      { id: "5A5", t: "Data Loss Prevention (DLP)" },
      { id: "5A6", t: "Data Encryption" },
      { id: "5A7", t: "Public Key Infrastructure (PKI)" },
      { id: "5A8", t: "Cloud & Virtualized Environments" },
      { id: "5A9", t: "Mobile, Wireless & Internet-of-Things (IoT) Devices" },
      { id: "5B1", t: "Security Awareness Training & Programs" },
      { id: "5B2", t: "Information System Attack Methods & Techniques" },
      { id: "5B3", t: "Security Testing Tools & Techniques" },
      { id: "5B4", t: "Security Monitoring Logs, Tools & Techniques" },
      { id: "5B5", t: "Security Incident Response Management" },
      { id: "5B6", t: "Evidence Collection & Forensics" }
    ] }
];

/* The five PBQ formats — one per domain. CISA has no simulations, so these are
   audit-decision scenarios (authentic to the exam's scenario items): each poses
   a described situation and asks for the BEST audit, control, or governance
   action, field by field. `domainColor` just drives the badge tint. */
CISA.pbqFormats = [
  { id: 1, icon: "🔍", domainColor: 1, obj: "1A3 / 1A4 / 1B2", badge: "AUDIT PROCESS", title: "Plan & Execute a Risk-Based Audit",
    desc: "Work an engagement field by field — choose the correct audit/review type, apply the risk-based scoping decision, classify the control in scope, and select the right testing or sampling technique.",
    long: "You are the IS auditor scoping and running an engagement. For each item, select the correct <b>audit or review type</b> (compliance, substantive, operational, integrated, forensic), apply the <b>risk-based planning</b> decision (where audit effort should concentrate given the risk), classify the <b>control</b> in scope (preventive, detective, corrective; general vs. application), and choose the correct <b>testing or sampling methodology</b> (attribute vs. variable sampling, compliance vs. substantive testing, appropriate evidence-gathering technique)." },
  { id: 2, icon: "🏛", domainColor: 2, obj: "2A2 / 2A5 / 2A7", badge: "GOVERNANCE", title: "Evaluate IT Governance & Controls",
    desc: "Assess a governance scenario: distinguish the governance artifact, place accountability, choose the enterprise-risk response, and apply the correct data-governance or classification action.",
    long: "Evaluate the enterprise's direction and control of IT. For each field, identify the correct <b>governance artifact</b> (policy vs. standard vs. procedure vs. guideline), assign <b>accountability</b> in the org/IT-governance structure (board, steering committee, IT management, data owner vs. custodian), select the <b>enterprise risk-management</b> response (avoid, mitigate, transfer, accept) the situation demands, and choose the right <b>data governance / classification</b> action for the information asset." },
  { id: 3, icon: "🧱", domainColor: 3, obj: "3A4 / 3B1 / 3B4", badge: "ACQ & DEV", title: "Assess Acquisition & Implementation Controls",
    desc: "Review a systems project: place the control in the SDLC, judge the feasibility or business-case decision, choose the correct implementation-testing type, and select the post-implementation review action.",
    long: "Audit how a system is acquired, built, and deployed. For each item, identify where a <b>control belongs in the SDLC</b> (requirements, design, development, testing, deployment), evaluate the <b>business case / feasibility</b> decision, choose the correct <b>implementation-testing</b> type (unit, integration, system, UAT, regression, parallel vs. cutover conversion), and select the right <b>post-implementation review</b> action to confirm deliverables, controls, and benefits were met." },
  { id: 4, icon: "⚙", domainColor: 4, obj: "4A7 / 4A8 / 4B1", badge: "OPS & RESILIENCE", title: "Operations & Business Resilience",
    desc: "Run an operations scenario: separate problem from incident, apply the change/configuration control, choose the correct resilience metric, and select the backup or recovery strategy the requirement demands.",
    long: "Evaluate operations and resilience. For each field, distinguish <b>problem vs. incident management</b> and the correct next step, apply the right <b>change, configuration, or patch-management</b> control, select the correct <b>resilience metric</b> — Recovery Time Objective (RTO), Recovery Point Objective (RPO), MTD/MTO — and choose the <b>backup or disaster-recovery strategy</b> (full/incremental/differential backup, hot/warm/cold site, replication) that satisfies the stated objective." },
  { id: 5, icon: "🛡", domainColor: 5, obj: "5A3 / 5A6 / 5B5", badge: "ASSET PROTECTION", title: "Protect Information Assets",
    desc: "Evaluate a protection scenario: choose the access-control model, select the correct cryptographic or PKI mechanism, apply the network or endpoint control, and pick the right incident-response step.",
    long: "Audit the controls that protect information assets. For each item, choose the correct <b>identity & access-management</b> decision (least privilege, segregation of duties, RBAC/MAC/DAC, MFA), select the right <b>cryptographic or PKI</b> mechanism (symmetric vs. asymmetric, hashing, digital signature, certificate/CA trust), apply the correct <b>network or endpoint control</b> (segmentation, firewall/IDS/IPS, DLP, hardening), and pick the correct <b>security incident-response</b> step (detection, containment, eradication, recovery, evidence preservation/forensics)." }
];

/* Curated free study resources. */
CISA.resources = [
  { icon: "📄", title: "Official ISACA CISA Exam Content Outline", host: "isaca.org",
    url: "https://www.isaca.org/credentialing/cisa",
    desc: "The authoritative blueprint — every domain, sub-area, and subtopic ISACA can test, with the official domain weightings (effective August 2024). Use it as your master checklist." },
  { icon: "📘", title: "CISA Review Manual (RM) & QAE Database", host: "isaca.org",
    url: "https://www.isaca.org/credentialing/cisa/cisa-exam-preparation",
    desc: "The ISACA CISA Review Manual is the canonical text, and the official Questions, Answers & Explanations (QAE) database is the standard practice-question companion, both mapped to the five domains." },
  { icon: "📗", title: "COBIT 2019 & the IT Assurance Framework (ITAF)", host: "isaca.org",
    url: "https://www.isaca.org/resources/cobit",
    desc: "COBIT 2019 is ISACA's governance-and-management framework and ITAF is its IS audit and assurance framework — the standards, guidelines, and codes of ethics that underpin Domain 1 and Domain 2." },
  { icon: "📚", title: "NIST, ISO/IEC 27001 & Relevant Standards", host: "csrc.nist.gov",
    url: "https://csrc.nist.gov/publications/sp",
    desc: "When a control definition must be exact, go to the source: the NIST SP 800 series, ISO/IEC 27001/27002 (ISMS and controls), and ISO 22301 (business continuity) inform the control, resilience, and asset-protection domains." },
  { icon: "🎥", title: "CISA Domain Walkthrough Videos (Hemang Doshi, others)", host: "youtube.com",
    url: "https://www.youtube.com/results?search_query=CISA+exam+domain+review",
    desc: "Free domain overviews and concept walkthroughs. Hemang Doshi's CISA material and community channels are widely used to reinforce the auditor's perspective the exam rewards." },
  { icon: "👥", title: "r/CISA — Community Study Plans & “I Passed” Threads", host: "reddit.com/r/CISA",
    url: "https://www.reddit.com/r/CISA/",
    desc: "Crowd-sourced study plans, exam-experience intel, and pass write-ups. Read recent posts for where candidates get stuck and how the CISA's independent-auditor mindset differs from hands-on security exams." }
];

/* ---- Reader: Exam Mechanics card ---- */
CISA.examMechanics = [
  { heading: "Format: a fixed-form, 150-question exam", body:
    "<p>The <strong>ISACA CISA</strong> exam is a <strong>fixed-form, linear</strong> examination: <strong>150 multiple-choice questions</strong> delivered in a single <strong>4-hour (240-minute)</strong> appointment. Unlike the adaptive ISC2 exams, the CISA is <em>not</em> computer-adaptive — every candidate answers the same number of items, and you may <strong>move freely: skip, flag, and return</strong> to any question before you submit. A number of the 150 items are <strong>unscored pretest questions</strong> ISACA is trialing for future forms; you cannot tell them apart from scored items, so treat every question as if it counts.</p>" +
    "<p>Because you can navigate the whole form, budget your time and <strong>answer every question</strong> — there is <strong>no penalty for a wrong answer</strong>, so a blank is strictly worse than a guess. With 150 items in 240 minutes you have roughly <strong>1.6 minutes per question</strong>, plus time for a review pass over your flagged items.</p>" +
    "<div class='callout exam'><div class='lbl'>Exam tip</div>Make a first pass answering everything you know, <strong>flagging</strong> the hard ones, then return. Never leave an item blank — an educated guess on a narrowed-down item is free expected value.</div>" },
  { heading: "Scoring: the 200–800 scale and the 450 line", body:
    "<p>CISA is reported as a <strong>scaled score from 200 to 800</strong>, and the passing standard is <strong>450</strong>. A scaled score is a conversion of your raw score (number of scored items correct) onto a common scale so that different exam forms are comparable and fair — it is <em>not</em> a percentage. A <strong>800</strong> is a perfect score; <strong>200</strong> is the lowest possible; <strong>450</strong> is the minimum standard of knowledge required to pass.</p>" +
    "<p>Your score is based on the <strong>total number of scored items answered correctly, regardless of domain</strong>. ISACA reports <strong>domain-level results for information only</strong> — the domain percentages tell you how much of the exam draws on each domain, but they are not scored separately, and you do not need to “pass” each domain individually. You receive a preliminary pass/fail on screen, with the official scaled score by email within about 10 working days.</p>" +
    "<blockquote>This platform's mock exam reports a scaled score using a transparent linear approximation of the 200–800 band against the 450 line. Use it as a <em>relative</em> readiness signal — “am I consistently clearing 450 on full-length practice?” — not as a literal prediction of your official result.</blockquote>" },
  { heading: "Question style and the CISA mindset", body:
    "<p>CISA items are <strong>“best answer”</strong> questions written from the perspective of an <strong>independent IS auditor</strong>, not a hands-on administrator. Frequently more than one option is technically defensible — your job is to choose the answer an auditor would consider <em>best</em> given the scenario. Watch the qualifiers: <strong>MOST</strong>, <strong>BEST</strong>, <strong>FIRST</strong>, and <strong>GREATEST</strong> change the correct answer entirely.</p>" +
    "<ul><li><strong>Think like an auditor, not an operator.</strong> The exam rewards evaluating, assessing, and recommending — independence and objectivity over hands-on remediation. When an option says “fix it” and another says “assess/report it,” the auditor's role usually favors evaluating and reporting.</li><li><strong>Follow the correct order.</strong> Risk assessment precedes audit planning; understanding the process precedes testing controls; a finding is communicated before you expect remediation.</li><li><strong>Controls first.</strong> Know the difference between preventive, detective, and corrective controls, and between general and application controls — many items hinge on classifying the control correctly.</li><li><strong>Governance and risk win ties.</strong> When two answers both “work,” prefer the one grounded in governance, risk, and the organization's objectives.</li></ul>" +
    "<div class='callout'><div class='lbl'>Strategy</div>For every scenario, ask: <em>“What would an independent auditor — whose job is to evaluate and provide assurance, not to run the system — do or recommend FIRST here?”</em> That framing resolves most “two answers look right” situations.</div>" },
  { heading: "Eligibility, experience, and maintenance", body:
    "<p>To become certified you need <strong>five (5) years of professional experience</strong> in information systems auditing, control, assurance, or security. <strong>Experience waivers of up to three (3) years</strong> are available for defined education and other certifications. You may <strong>take the exam first</strong> and then submit your experience — you have <strong>five years from passing</strong> to apply for certification, and the experience must have been earned within the ten years preceding the application.</p>" +
    "<p>The exam registration fee is <strong>US$575 for ISACA members</strong> and <strong>US$760 for non-members</strong>; certification then requires a <strong>US$50 application processing fee</strong>. Registration opens a <strong>six-month eligibility window</strong>, and you have <strong>four attempts within a rolling 12-month period</strong> to pass. Once certified, you maintain CISA with <strong>Continuing Professional Education (CPE)</strong> — a minimum of 20 hours annually and 120 over each three-year cycle — plus the annual maintenance fee, adherence to ISACA's <strong>Code of Professional Ethics</strong>, and compliance with the IS Auditing Standards.</p>" +
    "<div class='callout scenario'><div class='lbl'>Note</div>CISA is <strong>ANSI/ISO-IEC 17024:2012 accredited</strong>. It may be funded through your program — connect with the Program Director or your professor about voucher opportunities before you register.</div>" },
  { heading: "Exam-day logistics", body:
    "<p>The CISA is delivered at <strong>PSI test centers</strong> or as an <strong>online remotely proctored</strong> exam. For an in-person sitting, arrive at least <strong>30 minutes early</strong> with a current, valid, government-issued photo ID whose name matches your registration. For a remote sitting, complete the system compatibility check in advance and be ready for a <strong>360° room scan and desk/mirror check</strong> at check-in.</p>" +
    "<p>The exam is <strong>closed-book</strong>: no notes, phones, smartwatches, calculators, or reference materials, and your workspace must be clear. Two short breaks are permitted with proctor approval, but the <strong>timer does not stop</strong> during a break. You cannot take screenshots or photos of any part of the exam, including the results screen.</p>" +
    "<div class='callout exam'><div class='lbl'>Mindset</div>The CISA rewards <strong>breadth of audit judgment across the whole IT estate</strong> — governance, acquisition, operations, resilience, and asset protection — not deep trivia in any one tool. You are being certified as an <em>independent assurance professional</em>; answer every question from that altitude.</div>" }
];

/* ---- Reader: Career Guidance card ---- */
CISA.careerGuidance = [
  { heading: "Where CISA sits on the ladder", body:
    "<p><strong>CISA (Certified Information Systems Auditor) is the leading, globally recognized credential for IS audit, assurance, and control professionals.</strong> Administered by <strong>ISACA</strong> since 1978, it certifies that you can plan and execute risk-based audits of information systems; evaluate IT governance, acquisition, operations, and resilience; and provide assurance that IT is controlled and delivers value. It is an <em>advanced, experience-based</em> credential — not entry level — sitting alongside credentials like CISM and CRISC in the governance-and-audit space.</p>" +
    "<p>For hiring managers, CISA on a résumé is shorthand for “this person can independently assess IT risk and controls and speak the language of both auditors and IT.” It is one of the most frequently <em>required</em> certifications in IS-audit, assurance, and IT-GRC postings, and it is recognized for audit and oversight roles under the U.S. DoD <strong>8140</strong> framework.</p>" },
  { heading: "Why an independent-auditor credential matters", body:
    "<p>Organizations are accountable to regulators, boards, and customers for how they control information systems — and they need professionals who can <em>independently</em> evaluate that control and report on it objectively. That judgment is durable and transferable: tools and platforms change, but the discipline of scoping a risk-based audit, gathering sufficient and appropriate evidence, classifying controls, and communicating findings does not. CISA certifies exactly that layer, which is why it travels across industries, frameworks, and technologies.</p>" +
    "<p>The exam's deliberate <strong>auditor's perspective</strong> is the point: employers want someone who can stand apart from operations, assess whether controls actually work, and give assurance a board and an external regulator will accept — not simply someone who can configure a system.</p>" +
    "<div class='callout exam'><div class='lbl'>Why it matters</div>CISA names the exact skill set assurance and GRC roles hire for: <strong>independent, risk-based evaluation of IT controls</strong> that holds up to boards, regulators, and external auditors.</div>" },
  { heading: "Roles CISA opens", body:
    "<p>CISA aligns with a cluster of audit, assurance, and governance roles. Combined with experience it credibly qualifies you for:</p>" +
    "<ul>" +
    "<li><strong>IT Auditor / IS Auditor</strong> — planning and executing risk-based audits of applications, infrastructure, and processes. The whole exam maps to this job.</li>" +
    "<li><strong>IT Audit Manager / IS Audit Lead</strong> — owning the audit universe, methodology, and quality assurance of the audit function (Domain 1).</li>" +
    "<li><strong>IT Risk / GRC Analyst</strong> — evaluating governance, ERM, and control design across the enterprise (Domains 2, 4, 5).</li>" +
    "<li><strong>Compliance / Assurance Analyst</strong> — assessing controls against laws, regulations, and standards and reporting to stakeholders.</li>" +
    "<li><strong>Internal Auditor (IT focus)</strong> — the IT specialist on an internal audit team, bridging finance/operational audit and technology.</li>" +
    "</ul>" },
  { heading: "Building the path around CISA", body:
    "<p>CISA pairs naturally with a broader governance-and-risk career. A common trajectory: <em>a foundational security cert (Security+) → CISA (audit depth) → CISM or CRISC (management/risk) → audit or GRC leadership</em>. Because CISA proves independent assurance skill, many professionals add <strong>CRISC</strong> for enterprise risk, <strong>CISM</strong> for security management, or <strong>CGEIT</strong> for enterprise IT governance — all ISACA credentials that share vocabulary and CPE ecosystem with CISA. COBIT 2019 fluency strengthens the whole cluster.</p>" +
    "<div class='callout scenario'><div class='lbl'>Practical advice</div>CISA is as much an <strong>audit-and-governance mindset</strong> credential as a knowledge one. Pair it with demonstrable experience — leading an audit engagement, evaluating a control environment, presenting findings to management — because the experience requirement and most audit interviews probe for real assessment decisions you have made, not just facts you have memorized.</div>" }
];

/* Reading content is NOT bundled here. Each domain's dense reading sections live
   in their own module under assets/js/content/domainN.js and are fetched on
   demand by app.js the first time a Domain Study card is opened. This object is
   the shared target those modules populate: CISA.reading[N] = [ ...sections ]. */
CISA.reading = CISA.reading || {};

/* Flashcard decks are likewise lazy-loaded from assets/js/content/flashN.js
   (100 cards per domain) and populate this object: CISA.flash[N] = [ ...cards ]. */
CISA.flash = CISA.flash || {};
