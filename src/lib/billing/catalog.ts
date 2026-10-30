// @ts-nocheck
/* Ported from zikriyon-catalog.js (UMD) to an ES module. Logic unchanged. */
function build() {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. CORE CURRENCY
   * ------------------------------------------------------------------ */
  const CREDIT_INR = 0.01;                    // 1 ZIK Credit = ₹0.01
  const MIN_RECHARGE_INR = 1;
  const MAX_RECHARGE_INR = 100000;            // ₹1,00,000
  const MAX_BALANCE_CREDITS = 10000000;       // ₹1,00,000 wallet cap
  const inrToCredits = (inr) => Math.round(inr / CREDIT_INR);

  /* ------------------------------------------------------------------ *
   * 2. MODELS (ZIT family) + mapping from the existing model picker
   * ------------------------------------------------------------------ */
  const T = 'zit-tiny', S = 'zit-small', B = 'zit-base', X = 'zit-1b';
  const ALL = [T, S, B, X];
  const MODELS = {
    [T]: { id: T, label: 'ZIT-Tiny',  rank: 1, blurb: 'Fastest · everyday quick answers' },
    [S]: { id: S, label: 'ZIT-Small', rank: 2, blurb: 'Fast & balanced' },
    [B]: { id: B, label: 'ZIT-Base',  rank: 3, blurb: 'Standard — rozmarra ke kaam' },
    [X]: { id: X, label: 'ZIT-1B',    rank: 4, blurb: 'Advanced reasoning — mushkil sawal' }
  };
  // existing <div class="model-item" data-model="…"> values → ZIT tier
  const PICKER_MAP = {
    'zikos-tiny': T, 'zikos-lite': S, 'zikos-base': B, 'zikos-delta': X, 'image': null
  };

  /* ------------------------------------------------------------------ *
   * 3. ENTITLEMENT LEVELS
   *    research: 0 chat only · 1 basic · 2 normal · 3 deep · 4 maximum
   *    files:    0 no · 1 limited · 2 yes
   *    prio:     0 slow queue · 1 low · 2 normal · 3 high · 4 highest
   *    api:      0 none · 1 limited · 2 full
   * ------------------------------------------------------------------ */
  const RESEARCH_LABEL = ['Chat only', 'Basic', 'Normal', 'Deep', 'Maximum'];
  const FILES_LABEL = ['No', 'Limited', 'Yes'];
  const PRIO_LABEL = ['Slow', 'Low', 'Normal', 'High', 'Highest'];
  const API_LABEL = ['No', 'Limited', 'Full'];

  // pay-as-you-go request pricing (credits). Ranges are from §5 of the plan doc.
  const PRICING = {
    chat: {                       // per message: [min, max] credits
      fast:     [5, 20],          // ₹0.05–0.20
      normal:   [20, 50],         // ₹0.20–0.50
      research: [50, 200]         // ₹0.50–2
    },
    modelBase: { [T]: 3, [S]: 5, [B]: 16, [X]: 30 },
    inPer1kChars: 1,              // input  cost
    outPer1kChars: 3,             // output cost (higher, as per doc §5.5)
    retrievalPerChunk: 4,
    depth: [0, 50, 200, 700, 1500],   // basic ₹0.50 · normal ₹1–3 · deep ₹5–10 · max ₹10–25
    priority: [0, 0, 0, 2, 5],
    document: { small: 200, medium: 500, large: 1000, largeMax: 2500, smallChars: 20000, mediumChars: 100000, largeChars: 500000 },
    apiCall: { basic: 5, research: 50, deep: 500 }
  };
  const LIMITED_DEEP_PER_DAY = 3;       // ASSUMPTION: "limited deep research" = 3 deep tasks / day
  const LIMITED_FILES_PER_DAY = 3;      // ASSUMPTION: "limited file upload" = 3 documents / day

  // platform safety limits per priority level (soft-enforced in-app, hard-enforced in chatProxy)
  const RATE_LIMITS = [
    { perMin: 3,  perDay: 30   },   // 0 slow / community
    { perMin: 5,  perDay: 80   },   // 1 low
    { perMin: 10, perDay: 300  },   // 2 normal
    { perMin: 20, perDay: 800  },   // 3 high
    { perMin: 40, perDay: 2000 }    // 4 highest
  ];
  const MAX_OUTPUT_TOKENS_BY_CTX = (ctxK) => Math.min(8192, Math.max(512, Math.round(ctxK * 256)));

  /* ------------------------------------------------------------------ *
   * 4. ENTITLEMENT BUILDERS
   * ------------------------------------------------------------------ */
  const E = (models, ctx, research, files, prio, more) =>
    Object.assign({ models, ctx, research, files, prio, api: 0 }, more || {});

  // Reusable entitlement sets (names mirror the plan document)
  const ENT = {
    free:      E([T, S], 4, 1, 0, 1),
    trial:     E(ALL, 16, 2, 1, 2, { deepQuota: LIMITED_DEEP_PER_DAY }),
    pro:       E(ALL, 32, 3, 2, 4, { api: 1, verify: true }),
    community: E([T], 2, 1, 0, 0, { community: true }),

    r1:    E([T, S], 2, 1, 0, 2),
    r2:    E([T, S], 4, 1, 0, 2),
    r5:    E([T, S, B], 8, 2, 0, 2),
    r10:   E([S, B], 8, 2, 0, 2, { deepQuota: LIMITED_DEEP_PER_DAY }),
    r20:   E([S, B, X], 16, 3, 0, 2),
    r50:   E(ALL, 32, 3, 2, 2),
    r100:  E(ALL, 32, 3, 2, 3),
    r500:  E(ALL, 64, 4, 2, 3),
    r1000: E(ALL, 128, 3, 2, 3, { api: 2 }),

    basic:    E([T, S], 4, 1, 0, 2),
    standard: E([S, B], 8, 2, 1, 2),
    plus:     E([S, B, X], 16, 3, 2, 3),
    ultra:    E(ALL, 128, 4, 2, 4, { api: 2, verify: true }),

    studentFree:  E([S], 4, 1, 0, 1),
    studentMonth: E([S, B], 8, 2, 0, 2),
    studentYear:  E([S, B], 8, 2, 0, 2, { deepQuota: LIMITED_DEEP_PER_DAY }),
    examCrash:    E([S, B], 8, 2, 2, 2, { summarize: true }),

    resBasic: E([S, B, X], 16, 2, 0, 2, { citations: true, trusted: true, verify: true }),
    resPro:   E(ALL, 32, 3, 2, 3, { citations: true, trusted: true, verify: true, contradiction: true }),
    resUltra: E(ALL, 128, 4, 2, 4, { citations: true, trusted: true, verify: true, contradiction: true, api: 2 }),

    famBasic: E([S, B], 8, 2, 1, 2),
    famPlus:  E([S, B, X], 16, 3, 2, 3),
    famPro:   E(ALL, 32, 3, 2, 3),

    apiFree: E([S], 4, 1, 0, 1, { api: 1, apiCallsPerDay: 100 }),
    apiAny:  E(ALL, 32, 3, 0, 2, { api: 2 }),
    apiPro:  E(ALL, 32, 3, 0, 3, { api: 2 })
  };

  /* ------------------------------------------------------------------ *
   * 5. THE CATALOG
   *    kind:  free | bucket | sub | addon | pass | trial | contact | custom
   *    type:  (Google Play product type) inapp-consumable | inapp-nonconsumable | subs | none
   *    phase: launch phase 1–5 (remote-config flag per phase)
   * ------------------------------------------------------------------ */
  const GROUPS = [
    { id: 'free',       label: 'Free',            icon: 'redeem' },
    { id: 'recharge',   label: 'Recharge',        icon: 'bolt' },
    { id: 'sub',        label: 'Subscriptions',   icon: 'workspace_premium' },
    { id: 'pack',       label: 'Packs',           icon: 'inventory_2' },
    { id: 'pass',       label: 'Passes',          icon: 'confirmation_number' },
    { id: 'student',    label: 'Student',         icon: 'school' },
    { id: 'researcher', label: 'Researcher',      icon: 'biotech' },
    { id: 'family',     label: 'Family',          icon: 'family_restroom' },
    { id: 'business',   label: 'Business',        icon: 'business_center' },
    { id: 'api',        label: 'Developer API',   icon: 'terminal' },
    { id: 'addon',      label: 'Add-ons',         icon: 'extension' }
  ];

  const P = []; // plans
  const add = (p) => { P.push(Object.assign({ bonus: 0, validityDays: null, phase: 2, sku: 'zik_' + p.id }, p)); };

  /* ---- 2. FREE ---- */
  add({ id: 'free_forever', group: 'free', kind: 'free', type: 'none', phase: 1, name: 'Free Forever', price: 0, period: 'free',
        dailyCredits: 50, ent: ENT.free, ctxText: '2K–4K', modeText: 'Basic research', purpose: 'New user onboarding' });
  add({ id: 'free_trial', group: 'free', kind: 'trial', type: 'none', phase: 1, name: 'Free Trial', price: 0, period: 'free',
        credits: 1000, validityDays: 7, ent: ENT.trial, ctxText: 'Up to 16K', modeText: 'Normal + limited deep research', purpose: 'Try every ZIT model' });
  add({ id: 'reverse_trial', group: 'free', kind: 'trial', type: 'none', phase: 1, name: 'Reverse Trial', price: 0, period: 'free',
        credits: 1000 /* ASSUMPTION: same 1,000 credits so Pro features are actually usable */, validityDays: 7, ent: ENT.pro,
        ctxText: '32K', modeText: 'Pro features for 7 days → then Free Forever', purpose: 'Show premium value first' });
  add({ id: 'community', group: 'free', kind: 'free', type: 'none', phase: 1, name: 'Community Access', price: 0, period: 'free',
        ent: ENT.community, ctxText: '2K', modeText: 'Basic research · slow queue · public ZIT models only',
        purpose: 'Developers, testers, early adopters', communityDailyMsgs: 20 /* ASSUMPTION */ });

  /* ---- 3. MICRO RECHARGE ---- */
  const mr = (inr, credits, bonus, ent, ctxText, modeText, days, phase) => add({
    id: 'recharge_' + inr, group: 'recharge', kind: 'bucket', type: 'inapp-consumable', phase: phase || 1,
    name: '₹' + inr.toLocaleString('en-IN') + ' Recharge', price: inr, period: 'once',
    credits, bonus, validityDays: days, ent, ctxText, modeText
  });
  mr(1,    100,    0,     ENT.r1,    '2K',        'Fast Chat + Basic Research', 7);
  mr(2,    200,    0,     ENT.r2,    '4K',        'Fast Chat + Basic Research', 15, 2);
  mr(5,    500,    25,    ENT.r5,    '4K–8K',     'Normal Research', 30);
  mr(10,   1000,   100,   ENT.r10,   '8K',        'Normal Research + limited Deep Research', 30);
  mr(20,   2000,   300,   ENT.r20,   '8K–16K',    'Deep Research', 60, 2);
  mr(50,   5000,   1000,  ENT.r50,   '16K–32K',   'Deep Research + File Analysis', 90);
  mr(100,  10000,  2500,  ENT.r100,  '32K',       'Deep Research + Priority Queue', 180);
  mr(500,  50000,  15000, ENT.r500,  '32K–64K',   'Maximum Research + Priority', 365, 2);
  mr(1000, 100000, 40000, ENT.r1000, 'Maximum',   'Deep Research + API Access', 365, 2);
  add({ id: 'recharge_custom', group: 'recharge', kind: 'custom', type: 'inapp-consumable', phase: 1, name: 'Custom Recharge',
        price: null, period: 'once', ctxText: 'by amount', modeText: 'Flexible wallet · automatic amount-based bonus',
        minInr: MIN_RECHARGE_INR, maxInr: MAX_RECHARGE_INR });

  /* ---- 6. SUBSCRIPTIONS ---- */
  const sub = (id, name, price, period, credits, ent, ctxText, modeText, extra) => add(Object.assign({
    id, group: 'sub', kind: 'sub', type: 'subs', name, price, period, credits, ent, ctxText, modeText,
    validityDays: period === 'year' ? 365 : 30
  }, extra || {}));
  sub('sub_basic',    'Basic',    99,   'month', 5000,   ENT.basic,    '4K',  'Basic research');
  sub('sub_standard', 'Standard', 199,  'month', 12000,  ENT.standard, '8K',  'Normal research');
  sub('sub_plus',     'Plus',     499,  'month', 30000,  ENT.plus,     '16K', 'Deep research', { badge: 'Popular' });
  sub('sub_pro',      'Pro',      999,  'month', 70000,  ENT.pro,      '32K', 'Deep research + verification', { phase: 2 });
  sub('sub_ultra',    'Ultra',    1999, 'month', 200000, ENT.ultra,    'Maximum', 'Maximum deep research');
  sub('sub_basic_y',    'Yearly Basic',    999,  'year', 60000,   ENT.basic,    '4K',  'Basic research',  { badge: 'Best value', benefit: '2 months free' });
  sub('sub_standard_y', 'Yearly Standard', 1999, 'year', 150000,  ENT.standard, '8K',  'Normal research', { badge: 'Best value', benefit: '2 months free' });
  sub('sub_plus_y',     'Yearly Plus',     4999, 'year', 400000,  ENT.plus,     '16K', 'Deep research',   { badge: 'Best value', benefit: '2 months free + bonus credits' });
  sub('sub_pro_y',      'Yearly Pro',      9999, 'year', 1000000, ENT.pro,      '32K', 'Deep research + verification', { badge: 'Best value', benefit: '2 months free + priority + API' });
  add({ id: 'lifetime_supporter', group: 'sub', kind: 'bucket', type: 'inapp-nonconsumable', phase: 2, name: 'Lifetime Early Supporter',
        price: 4999, period: 'once', credits: 50000, validityDays: null, ent: ENT.pro /* ASSUMPTION: Pro-level access for life */,
        ctxText: '32K', modeText: 'After credits: pay-as-you-go', badge: 'Limited seats', seatsTotal: 500 /* ASSUMPTION */, lifetimeAccess: true,
        purpose: 'Early funding and loyal users' });

  /* ---- 7. CREDIT PACKS (access level follows the nearest recharge tier — ASSUMPTION) ---- */
  const pack = (id, name, price, credits, days, ent, ctxText, modeText, extra) => add(Object.assign({
    id, group: 'pack', kind: 'bucket', type: 'inapp-consumable', name, price, period: 'once', credits, validityDays: days, ent, ctxText, modeText
  }, extra || {}));
  pack('pack_starter',  'Starter Credit Pack',  49,   5500,    30,  ENT.r20,   '8K–16K',  'Deep Research');
  pack('pack_research', 'Research Credit Pack', 199,  25000,   60,  ENT.r100,  '32K',     'Deep Research + Priority Queue');
  pack('pack_pro',      'Pro Credit Pack',      499,  70000,   90,  ENT.r500,  '32K–64K', 'Maximum Research + Priority');
  pack('pack_business', 'Business Credit Pack', 1999, 300000,  180, ENT.r1000, 'Maximum',  'Deep Research + API Access', { seats: 5, phase: 4 });
  pack('pack_team',     'Team Credit Pack',     4999, 1000000, 365, ENT.r1000, 'Maximum',  'Deep Research + API Access', { seats: 20, phase: 4 });
  pack('pack_noexpiry', 'No-Expiry Credit Pack', 2999, 100000, null, ENT.r1000, 'Maximum', 'Credits never expire', { badge: 'Never expires' });

  /* ---- 8. TIME PASSES (no credits: access for a window, with fair-use caps — ASSUMPTION on caps) ---- */
  const pass = (id, name, price, durationMs, ent, ctxText, modeText, fair, extra) => add(Object.assign({
    id, group: 'pass', kind: 'pass', type: 'inapp-consumable', name, price, period: 'once', durationMs, ent, ctxText, modeText, fair
  }, extra || {}));
  const H = 3600e3, D = 24 * H;
  pass('pass_hourly',  'Hourly Pass',  19,  1 * H, E([S], 4, 1, 0, 2),     '4K',  'Unlimited basic chat (fair-use)', { chat: 60, research: 0, deep: 0, per: 'hour' });
  pass('pass_daily',   'Daily Pass',   49,  1 * D, E([S, B], 8, 2, 0, 2),  '8K',  'Normal research',                 { chat: 150, research: 10, deep: 0, per: 'day' });
  pass('pass_weekend', 'Weekend Pass', 99,  0,     E([S, B], 16, 2, 0, 2, { deepQuota: 3 }), '16K', 'Deep research (limited) · Sat–Sun',
       { chat: 200, research: 15, deep: 3, per: 'day' }, { window: 'weekend' });
  pass('pass_weekly',  'Weekly Pass',  149, 7 * D, E([S, B], 16, 2, 0, 2, { deepQuota: 2 }), '16K', 'Normal + limited deep research',
       { chat: 150, research: 10, deep: 2, per: 'day' });
  pass('pass_exam',    'Exam Season Pack', 99, 30 * D, E([S, B], 8, 2, 0, 2, { summarize: true }), '8K', 'Research + summarization · for students',
       { chat: 100, research: 10, deep: 0, per: 'day' }, { studentOnly: true });
  [99, 199, 299, 499].forEach((inr) => pass('pass_festival_' + inr, 'Festival Pass ₹' + inr, inr, 14 * D,
       E(ALL, 16, 2, 1, 2, { deepQuota: 2 }), '16K', 'Limited period + bonus credits', { chat: 200, research: 15, deep: 2, per: 'day' },
       { credits: inrToCredits(inr), bonus: Math.round(inrToCredits(inr) * 0.25) /* ASSUMPTION 25% */, validityDays: 14, phase: 5 }));

  /* ---- 9. STUDENT ---- */
  add({ id: 'student_free', group: 'student', kind: 'free', type: 'none', name: 'Student Free', price: 0, period: 'free', dailyCredits: 100,
        ent: ENT.studentFree, ctxText: '4K', modeText: 'Basic research · needs Student ID', studentOnly: true });
  add({ id: 'student_month', group: 'student', kind: 'sub', type: 'subs', name: 'Student Monthly', price: 49, period: 'month', credits: 10000,
        validityDays: 30, ent: ENT.studentMonth, ctxText: '8K', modeText: 'Normal research', studentOnly: true });
  add({ id: 'student_year', group: 'student', kind: 'sub', type: 'subs', name: 'Student Yearly', price: 499, period: 'year', credits: 120000,
        validityDays: 365, ent: ENT.studentYear, ctxText: '8K', modeText: 'Normal + limited deep research', studentOnly: true, badge: 'Best value' });
  add({ id: 'student_crash', group: 'student', kind: 'bucket', type: 'inapp-consumable', name: 'Exam Crash Pack', price: 99, period: 'once', credits: 15000,
        validityDays: 30, ent: ENT.examCrash, ctxText: '8K', modeText: 'Notes · summaries · previous questions · research', studentOnly: true });

  /* ---- 10. RESEARCHER ---- */
  add({ id: 'res_basic', group: 'researcher', kind: 'sub', type: 'subs', phase: 3, name: 'Researcher Basic', price: 199, period: 'month', credits: 20000,
        validityDays: 30, ent: ENT.resBasic, ctxText: '16K', modeText: 'Citations · trusted sources · basic verification' });
  add({ id: 'res_pro', group: 'researcher', kind: 'sub', type: 'subs', phase: 3, name: 'Researcher Pro', price: 499, period: 'month', credits: 60000,
        validityDays: 30, ent: ENT.resPro, ctxText: '32K', modeText: 'Deep research · citations · contradiction check · file analysis' });
  add({ id: 'res_ultra', group: 'researcher', kind: 'sub', type: 'subs', phase: 3, name: 'Researcher Ultra', price: 1499, period: 'month', credits: 200000,
        validityDays: 30, ent: ENT.resUltra, ctxText: 'Maximum', modeText: 'Maximum research · priority queue · API access' });
  add({ id: 'res_institution', group: 'researcher', kind: 'contact', type: 'none', phase: 4, name: 'PhD / Institution', price: null, period: 'custom',
        ent: ENT.resUltra, ctxText: 'Custom', modeText: 'Institutional access · shared credits · admin dashboard · audit logs · custom trusted knowledge base' });

  /* ---- 11. FAMILY ---- */
  add({ id: 'fam_basic', group: 'family', kind: 'sub', type: 'subs', phase: 5, name: 'Family Basic', price: 299, period: 'month', credits: 30000,
        validityDays: 30, seats: 3, ent: ENT.famBasic, ctxText: '8K', modeText: '3 members · shared credits' });
  add({ id: 'fam_plus', group: 'family', kind: 'sub', type: 'subs', phase: 5, name: 'Family Plus', price: 599, period: 'month', credits: 80000,
        validityDays: 30, seats: 5, ent: ENT.famPlus, ctxText: '16K', modeText: '5 members · shared credits' });
  add({ id: 'fam_pro', group: 'family', kind: 'sub', type: 'subs', phase: 5, name: 'Family Pro', price: 999, period: 'month', credits: 200000,
        validityDays: 30, seats: 6, ent: ENT.famPro, ctxText: '32K', modeText: '6 members · shared credits · high priority' });

  /* ---- 12. BUSINESS / TEAM ---- */
  add({ id: 'biz_starter', group: 'business', kind: 'sub', type: 'subs', phase: 4, name: 'Starter Business', price: 999, period: 'month', credits: 100000,
        validityDays: 30, seats: 3, ent: E(ALL, 32, 3, 2, 3), ctxText: '32K', modeText: 'Admin panel · usage reports' });
  add({ id: 'biz_growth', group: 'business', kind: 'sub', type: 'subs', phase: 4, name: 'Growth Business', price: 2999, period: 'month', credits: 400000,
        validityDays: 30, seats: 10, ent: E(ALL, 64, 3, 2, 3, { api: 2 }), ctxText: '64K', modeText: 'Admin panel · API access · audit logs' });
  add({ id: 'biz_scale', group: 'business', kind: 'sub', type: 'subs', phase: 4, name: 'Scale Business', price: 9999, period: 'month', credits: 1500000,
        validityDays: 30, seats: 25, ent: E(ALL, 128, 4, 2, 4, { api: 2 }), ctxText: 'Maximum', modeText: 'Priority support · custom limits · SSO' });
  add({ id: 'biz_enterprise', group: 'business', kind: 'contact', type: 'none', phase: 4, name: 'Enterprise', price: null, period: 'custom',
        ent: E(ALL, 128, 4, 2, 4, { api: 2 }), ctxText: 'Custom',
        modeText: 'Custom seats & credit pool · private deployment · SLA · security review · SSO/SAML · audit logs · dedicated support · custom model adapters' });

  /* ---- 13. DEVELOPER / API ---- */
  add({ id: 'api_free', group: 'api', kind: 'free', type: 'none', phase: 3, name: 'API Free Tier', price: 0, period: 'free',
        ent: ENT.apiFree, ctxText: '4K', modeText: '100 calls/day · ZIT-Small · for testing' });
  add({ id: 'api_payg', group: 'api', kind: 'free', type: 'none', phase: 3, name: 'API Pay-as-you-go', price: null, period: 'free',
        ent: ENT.apiAny, ctxText: '32K', modeText: 'Per call / per token · all models · minimum balance required', minBalanceCredits: 500 });
  add({ id: 'api_starter', group: 'api', kind: 'sub', type: 'subs', phase: 3, name: 'API Starter', price: 499, period: 'month', credits: 50000,
        validityDays: 30, ent: ENT.apiAny, ctxText: '32K', modeText: 'Standard rate limit', rateLimitPerMin: 30 });
  add({ id: 'api_pro', group: 'api', kind: 'sub', type: 'subs', phase: 3, name: 'API Pro', price: 1999, period: 'month', credits: 300000,
        validityDays: 30, ent: ENT.apiPro, ctxText: '32K', modeText: 'High rate limit · all models', rateLimitPerMin: 120 });
  add({ id: 'api_enterprise', group: 'api', kind: 'contact', type: 'none', phase: 4, name: 'API Enterprise', price: null, period: 'custom',
        ent: ENT.apiPro, ctxText: 'Custom', modeText: 'Dedicated capacity · custom rate limits · private endpoints · SLA · invoices · usage analytics' });

  /* ---- 14. ADD-ONS (monthly subscriptions). `grants` is merged into the entitlement. ---- */
  const addon = (id, name, price, benefit, grants, icon, extra) => add(Object.assign({
    id: 'addon_' + id, group: 'addon', kind: 'addon', type: 'subs', phase: 3, name, price, period: 'month', validityDays: 30,
    modeText: benefit, grants, icon, ent: null
  }, extra || {}));
  addon('deep',     'Deep Research Add-on',   99,  'More deep research requests (+10 / day)', { deepQuota: 10 }, 'travel_explore');
  addon('context',  'Long Context Add-on',    199, '32K–128K context access',                  { ctx: 128 }, 'subject');
  addon('priority', 'Priority Queue Add-on',  99,  'Faster response queue',                    { prio: 3 }, 'speed');
  addon('files',    'File Analysis Add-on',   149, 'PDF, DOCX, CSV, TXT analysis',             { files: 2 }, 'description');
  addon('voice',    'Voice Add-on',           149, 'Voice input / output',                     { voice: true }, 'mic', { phase: 3 });
  addon('image',    'Image Add-on',           199, 'Future multimodal image features',         { image: true }, 'image', { phase: 5 });
  addon('noads',    'No-Ads Add-on',          49,  'Clean interface',                          { noAds: true }, 'block');
  addon('export',   'Data Export Add-on',     99,  'Export all chats & research reports',      { dataExport: true }, 'ios_share');
  add({ id: 'addon_custom_model', group: 'addon', kind: 'contact', type: 'none', phase: 4, name: 'Custom Model Add-on', price: null, period: 'custom',
        modeText: 'Private LoRA adapter / custom model', icon: 'model_training', ent: null });

  /* ------------------------------------------------------------------ *
   * 15. AI LOANS (credit advance — NOT cash)
   * ------------------------------------------------------------------ */
  const LOANS = [
    { id: 'loan_emergency', name: 'Emergency AI Loan', credits: 100,  models: [T, S],    ctx: 4, rule: 'verified',   limit: { count: 1, perDays: 7 },
      text: 'Verified account · 1 loan per 7 days' },
    { id: 'loan_small',     name: 'Small AI Loan',     credits: 500,  models: [S],       ctx: 4, rule: 'age7',       limit: { count: 2, perDays: 30 },
      text: 'Account 7+ days old · 2 loans per month' },
    { id: 'loan_student',   name: 'Student Loan Credits', credits: 1000, models: [S, B], ctx: 8, rule: 'student',    limit: { count: 1, perDays: 30 },
      text: 'Verified student · 1 loan per month' },
    { id: 'loan_business',  name: 'Business Credit Line', credits: null, models: ALL,   ctx: 32, rule: 'business',  limit: null,
      text: 'Verified business · invoice-based recovery · credit-score based limit' }
  ];
  const LOAN_VALID_DAYS = 30;             // loan credits expire if unused (ASSUMPTION)

  /* ------------------------------------------------------------------ *
   * 16. REWARDS
   * ------------------------------------------------------------------ */
  const REWARDS = {
    referral: { inviter: 100, invitee: 100, maxReferrals: 50 },
    // day 1 / 2 / 3 / 7 are from the doc; days 4–6 are ASSUMPTION (= day 3 value)
    daily: [5, 10, 15, 15, 15, 15, 50],
    streak: { 7: 100, 30: 500, 100: 2000 },
    feedback: { detailed: 20, bugAccepted: 100, evalMin: 50, evalMax: 500, detailedMinChars: 40, perDay: 1 },
    cashback: [ { minInr: 1000, pct: 15 }, { minInr: 500, pct: 10 }, { minInr: 100, pct: 5 } ]
  };

  // automatic amount-based bonus for CUSTOM recharge (derived from the micro-recharge table)
  const CUSTOM_BONUS_TIERS = [
    { minInr: 1000, pct: 40, days: 365 }, { minInr: 500, pct: 30, days: 365 }, { minInr: 100, pct: 25, days: 180 },
    { minInr: 50, pct: 20, days: 90 },    { minInr: 20, pct: 15, days: 60 },   { minInr: 10, pct: 10, days: 30 },
    { minInr: 5, pct: 5, days: 30 },      { minInr: 2, pct: 0, days: 15 },     { minInr: 1, pct: 0, days: 7 }
  ];
  const customRecharge = (inr) => {
    inr = Math.floor(Number(inr));
    if (!isFinite(inr) || inr < MIN_RECHARGE_INR || inr > MAX_RECHARGE_INR) return null;
    const t = CUSTOM_BONUS_TIERS.find((x) => inr >= x.minInr);
    const credits = inrToCredits(inr);
    const tierEnt = [ENT.r1000, ENT.r500, ENT.r100, ENT.r50, ENT.r20, ENT.r10, ENT.r5, ENT.r2, ENT.r1];
    const idx = CUSTOM_BONUS_TIERS.indexOf(t);
    return { inr, credits, bonus: Math.round(credits * t.pct / 100), bonusPct: t.pct, validityDays: t.days, ent: tierEnt[idx] };
  };
  const cashbackPct = (inr) => { const r = REWARDS.cashback.find((x) => inr >= x.minInr); return r ? r.pct : 0; };

  /* Festival campaigns — dates are CONFIG (edit yearly / serve from Remote Config) */
  const FESTIVALS = [
    { id: 'newyear-2027',      name: 'New Year',         start: '2026-12-28', end: '2027-01-03', credits: 200, validityDays: 14 },
    { id: 'diwali-2026',       name: 'Diwali',           start: '2026-11-05', end: '2026-11-12', credits: 500, validityDays: 30 },
    { id: 'eid-2027',          name: 'Eid',              start: '2027-03-08', end: '2027-03-12', credits: 300, validityDays: 14 },
    { id: 'independence-2027', name: 'Independence Day', start: '2027-08-13', end: '2027-08-16', credits: 150, validityDays: 7 }
  ];

  /* Remote-config launch phases (all on by default: the app ships every feature) */
  const PHASES = { 1: true, 2: true, 3: true, 4: true, 5: true };

  /* Enforcement flags. voice/image stay OFF so existing free features are not removed silently. */
  const ENFORCE = { models: true, context: true, research: true, files: true, voice: false, image: false, dataExport: true };

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */
  const byId = {}; P.forEach((p) => { byId[p.id] = p; });
  const bySku = {}; P.forEach((p) => { bySku[p.sku] = p; });
  const fmtInr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fmtCredits = (n) => Math.floor(n).toLocaleString('en-IN');

  return {
    CREDIT_INR, MIN_RECHARGE_INR, MAX_RECHARGE_INR, MAX_BALANCE_CREDITS, inrToCredits,
    MODELS, PICKER_MAP, ALL_MODELS: ALL, ENT, PRICING, RATE_LIMITS, MAX_OUTPUT_TOKENS_BY_CTX,
    RESEARCH_LABEL, FILES_LABEL, PRIO_LABEL, API_LABEL,
    LIMITED_DEEP_PER_DAY, LIMITED_FILES_PER_DAY,
    GROUPS, PLANS: P, byId, bySku, LOANS, LOAN_VALID_DAYS, REWARDS, FESTIVALS, PHASES, ENFORCE,
    CUSTOM_BONUS_TIERS, customRecharge, cashbackPct, fmtInr, fmtCredits,
    plan: (id) => byId[id] || null
  };
}

export const CATALOG: any = build();
export default CATALOG;
