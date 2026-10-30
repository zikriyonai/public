// @ts-nocheck
/* Ported from zikriyon-engine.js (UMD) to an ES module. Logic unchanged (pure, no DOM, no network). */
import { CATALOG } from './catalog';
function build(C) {
  'use strict';

  const DAY = 864e5, HOUR = 36e5;
  const SUB_GRACE_MS = 3 * DAY;           // keep access this long after a missed renewal (Play "grace period")
  const LEDGER_CAP = 400, USAGE_CAP = 1000, PAYMENT_CAP = 200;
  const CLOCK_TOLERANCE_MS = 5 * 60e3;

  /* ------------------------------------------------------------------ *
   * tiny utils
   * ------------------------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const hourKey = (ts) => dayKey(ts) + ' ' + pad(new Date(ts).getHours());
  const monthKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const endOfDay = (ts) => { const d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); };
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  let seq = 0;
  const uid = (p) => p + '_' + Date.now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const rank = (m) => (C.MODELS[m] ? C.MODELS[m].rank : 0);

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */
  function newState(now) {
    now = now || Date.now();
    return {
      v: 1, rev: 0, createdAt: now, lastSeen: now,
      buckets: [], ledger: [], payments: [], processed: {},
      sub: null, addons: {}, passes: [], trial: null, trialUsed: false, lifetime: null, team: null,
      loans: [],
      usage: [],
      counters: { day: { key: '', spent: 0, msgs: 0, research: 0, deep: 0, files: 0 }, month: { key: '', spent: 0 }, recent: [] },
      rewards: { lastLoginDay: null, streak: 0, streakStart: null, milestones: {}, festivals: [], feedbackDay: { key: '', count: 0 },
                 referral: { code: null, redeemed: false, count: 0 }, pending: [] },
      settings: {
        smartBalance: true, lowAlert: true,
        dailyLimit: null, monthlyLimit: null, perRequestLimit: null,
        autoRecharge: { on: false, triggerInr: 10, amountInr: 50 },
        modelPref: 'auto', contextPref: 'auto', depthPref: 0
      },
      free: { lastRefillDay: null },
      balanceRef: 0, alertsFired: {},
      student: { status: 'none' }, businessVerified: false, community: false
    };
  }

  function migrate(s, now) {
    const base = newState(now);
    if (!s || typeof s !== 'object') return base;
    const out = Object.assign({}, base, s);
    out.counters = Object.assign({}, base.counters, s.counters || {});
    out.rewards = Object.assign({}, base.rewards, s.rewards || {});
    out.rewards.referral = Object.assign({}, base.rewards.referral, (s.rewards || {}).referral || {});
    out.settings = Object.assign({}, base.settings, s.settings || {});
    out.settings.autoRecharge = Object.assign({}, base.settings.autoRecharge, (s.settings || {}).autoRecharge || {});
    out.free = Object.assign({}, base.free, s.free || {});
    out.student = Object.assign({}, base.student, s.student || {});
    ['buckets', 'ledger', 'payments', 'passes', 'loans', 'usage'].forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
    if (!out.addons || typeof out.addons !== 'object') out.addons = {};
    if (!out.processed || typeof out.processed !== 'object') out.processed = {};
    return out;
  }

  /* ------------------------------------------------------------------ *
   * ledger
   * ------------------------------------------------------------------ */
  function log(state, now, e) {
    const entry = Object.assign({ id: uid('tx'), ts: now, type: 'info', credits: 0, planId: null, ref: null, note: '' }, e);
    entry.balanceAfter = totalCredits(state, now);
    state.ledger.unshift(entry);
    if (state.ledger.length > LEDGER_CAP) state.ledger.length = LEDGER_CAP;
    return entry;
  }

  /* ------------------------------------------------------------------ *
   * balance
   * ------------------------------------------------------------------ */
  const live = (b, now) => b.remaining > 0 && (b.expiresAt == null || b.expiresAt > now);
  function totalCredits(state, now) {
    let t = 0; for (const b of state.buckets) if (live(b, now)) t += b.remaining; return t;
  }
  // "wallet" balance used for alerts / smart mode: everything except the free daily allowance
  function paidCredits(state, now) {
    let t = 0; for (const b of state.buckets) if (live(b, now) && b.source !== 'free_daily') t += b.remaining; return t;
  }
  function balance(state, now) {
    const list = state.buckets.filter((b) => live(b, now))
      .sort((a, b) => (a.expiresAt == null ? Infinity : a.expiresAt) - (b.expiresAt == null ? Infinity : b.expiresAt) || a.createdAt - b.createdAt);
    const total = list.reduce((n, b) => n + b.remaining, 0);
    const soon = list.filter((b) => b.expiresAt != null && b.expiresAt - now <= 3 * DAY && b.source !== 'free_daily');
    return {
      total, paid: paidCredits(state, now), inr: total * C.CREDIT_INR, buckets: list,
      expiringSoon: soon, expiringSoonCredits: soon.reduce((n, b) => n + b.remaining, 0)
    };
  }
  function spendOrder(state, now) {
    return state.buckets.filter((b) => live(b, now)).sort((a, b) => {
      const ea = a.expiresAt == null ? Infinity : a.expiresAt, eb = b.expiresAt == null ? Infinity : b.expiresAt;
      return ea - eb || a.createdAt - b.createdAt;
    });
  }
  function spend(state, credits, now) {
    let left = Math.max(0, Math.ceil(credits)), taken = 0;
    for (const b of spendOrder(state, now)) {
      if (left <= 0) break;
      const t = Math.min(b.remaining, left);
      b.remaining -= t; left -= t; taken += t;
    }
    state.buckets = state.buckets.filter((b) => b.remaining > 0);
    return taken;
  }

  /* ------------------------------------------------------------------ *
   * grant
   * ------------------------------------------------------------------ */
  function grantBucket(state, o, now) {
    const credits = Math.max(0, Math.round(o.credits));
    if (!credits) return null;
    const b = {
      id: uid('bk'), source: o.source || 'grant', planId: o.planId || null, ref: o.ref || null,
      credits, remaining: credits, createdAt: now,
      expiresAt: o.expiresAt != null ? o.expiresAt : (o.validityDays != null ? now + o.validityDays * DAY : null),
      ent: o.ent || null
    };
    state.buckets.push(b);
    return b;
  }

  // Recover outstanding AI-loan credits. Unused loan credits are reclaimed first; the rest is taken from `incoming`.
  function recoverLoans(state, incomingCredits, now, ref) {
    let takeFromIncoming = 0;
    for (const loan of state.loans) {
      if (loan.status !== 'outstanding') continue;
      let owed = loan.owed;
      for (const b of state.buckets) {
        if (b.source === 'loan' && b.ref === loan.id && b.remaining > 0 && owed > 0) {
          const r = Math.min(b.remaining, owed); b.remaining -= r; owed -= r;
          log(state, now, { type: 'loan_return', credits: -r, planId: loan.type, ref: loan.id, note: 'Unused loan credits returned' });
        }
      }
      const pay = Math.min(owed, Math.max(0, incomingCredits - takeFromIncoming));
      takeFromIncoming += pay; owed -= pay;
      loan.owed = owed;
      if (owed <= 0) { loan.status = 'recovered'; loan.recoveredAt = now; }
      if (pay > 0) log(state, now, { type: 'loan_recovery', credits: -pay, planId: loan.type, ref: loan.id, note: 'Auto-deducted from recharge' });
    }
    state.buckets = state.buckets.filter((b) => b.remaining > 0);
    return takeFromIncoming;
  }

  /* ------------------------------------------------------------------ *
   * entitlement
   * ------------------------------------------------------------------ */
  const BOOLS = ['voice', 'image', 'noAds', 'dataExport', 'verify', 'citations', 'trusted', 'contradiction', 'summarize'];
  function merge(a, b) {
    if (!a) a = { models: [], ctx: 0, research: 0, files: 0, prio: 0, api: 0, deepQuota: 0 };
    const o = Object.assign({}, a);
    o.models = Array.from(new Set((a.models || []).concat(b.models || [])));
    ['ctx', 'research', 'files', 'prio', 'api', 'deepQuota', 'apiCallsPerDay'].forEach((k) => { if (b[k] != null) o[k] = Math.max(a[k] || 0, b[k]); });
    BOOLS.forEach((k) => { if (b[k]) o[k] = true; });
    return o;
  }
  const subActive = (sub, now) => !!sub && (sub.status === 'active' ? now <= sub.renewsAt + SUB_GRACE_MS : sub.status === 'canceled' && now <= sub.renewsAt);
  const passWindowActive = (p, now) => now >= p.startAt && now <= p.endAt;
  const trialActive = (t, now) => !!t && t.status === 'active' && now <= t.endsAt;

  function entitlement(state, now) {
    let ent = merge(null, C.ENT.free);
    const sources = [{ type: 'free', id: 'free_forever', name: 'Free Forever' }];
    const use = (e, src) => { if (!e) return; ent = merge(ent, e); sources.push(src); };

    if (state.student.status === 'verified') use(C.ENT.studentFree, { type: 'student', id: 'student_free', name: 'Student Free' });
    if (state.community) use(C.ENT.community, { type: 'community', id: 'community', name: 'Community Access' });
    for (const b of state.buckets) if (b.ent && live(b, now)) use(b.ent, { type: 'bucket', id: b.planId, name: (C.byId[b.planId] || {}).name || 'Credits' });
    if (state.lifetime) { const p = C.byId[state.lifetime.planId]; if (p) use(p.ent, { type: 'lifetime', id: p.id, name: p.name }); }
    if (subActive(state.sub, now)) { const p = C.byId[state.sub.planId]; if (p) use(p.ent, { type: 'sub', id: p.id, name: p.name }); }
    if (trialActive(state.trial, now)) { const p = C.byId[state.trial.planId]; if (p) use(p.ent, { type: 'trial', id: p.id, name: p.name }); }
    for (const ps of state.passes) if (passWindowActive(ps, now)) { const p = C.byId[ps.planId]; if (p) use(p.ent, { type: 'pass', id: p.id, name: p.name }); }
    let addonDeep = 0;
    for (const id of Object.keys(state.addons)) {
      const a = state.addons[id];
      if (!(a.status === 'active' ? now <= a.renewsAt + SUB_GRACE_MS : a.status === 'canceled' && now <= a.renewsAt)) continue;
      const p = C.byId[id]; if (!p) continue;
      const g = Object.assign({}, p.grants); addonDeep += g.deepQuota || 0; delete g.deepQuota;
      use(g, { type: 'addon', id: p.id, name: p.name });
    }
    ent.deepQuota = (ent.deepQuota || 0) + addonDeep;
    ent.models.sort((x, y) => rank(x) - rank(y));
    ent.maxOut = C.MAX_OUTPUT_TOKENS_BY_CTX(ent.ctx);
    ent.sources = sources;
    return ent;
  }

  /* ------------------------------------------------------------------ *
   * sweep: expiry, rollovers, free daily refill  (call before reading state)
   * ------------------------------------------------------------------ */
  const clockTampered = (state, now) => now < (state.lastSeen || 0) - CLOCK_TOLERANCE_MS;

  function sweep(state, now) {
    const events = [];
    if (clockTampered(state, now)) { events.push({ type: 'clock_skew' }); }
    else if (now > state.lastSeen) state.lastSeen = now;

    const dk = dayKey(now), mk = monthKey(now);
    if (state.counters.day.key !== dk) state.counters.day = { key: dk, spent: 0, msgs: 0, research: 0, deep: 0, files: 0 };
    if (state.counters.month.key !== mk) state.counters.month = { key: mk, spent: 0 };
    state.counters.recent = state.counters.recent.filter((t) => now - t < 60e3);

    // expire buckets (log what the user lost, except the silent free allowance)
    const expired = state.buckets.filter((b) => b.expiresAt != null && b.expiresAt <= now);
    if (expired.length) {
      state.buckets = state.buckets.filter((b) => !(b.expiresAt != null && b.expiresAt <= now));
      expired.forEach((b) => {
        if (b.remaining > 0 && b.source !== 'free_daily') {
          log(state, now, { type: 'expiry', credits: -b.remaining, planId: b.planId, ref: b.id, note: 'Credits expired' });
          events.push({ type: 'expired', credits: b.remaining, planId: b.planId });
        }
      });
    }
    state.buckets = state.buckets.filter((b) => b.remaining > 0);

    if (state.sub && state.sub.status !== 'expired' && !subActive(state.sub, now)) { state.sub.status = 'expired'; events.push({ type: 'sub_expired', planId: state.sub.planId }); }
    Object.keys(state.addons).forEach((id) => {
      const a = state.addons[id];
      if (a.status !== 'expired' && !(a.status === 'active' ? now <= a.renewsAt + SUB_GRACE_MS : now <= a.renewsAt)) { a.status = 'expired'; events.push({ type: 'addon_expired', planId: id }); }
    });
    state.passes = state.passes.filter((p) => p.endAt > now - 30 * DAY);
    if (state.trial && state.trial.status === 'active' && now > state.trial.endsAt) { state.trial.status = 'ended'; events.push({ type: 'trial_ended', planId: state.trial.planId }); }

    // free daily allowance (non-accumulating: the old one expires at midnight)
    if (state.free.lastRefillDay !== dk && !clockTampered(state, now)) {
      state.free.lastRefillDay = dk;
      const amount = state.student.status === 'verified' ? C.byId.student_free.dailyCredits : C.byId.free_forever.dailyCredits;
      state.buckets = state.buckets.filter((b) => b.source !== 'free_daily');
      grantBucket(state, { source: 'free_daily', planId: 'free_forever', credits: amount, expiresAt: endOfDay(now) }, now);
      events.push({ type: 'free_refill', credits: amount });
    }
    return events;
  }

  /* ------------------------------------------------------------------ *
   * pricing
   * ------------------------------------------------------------------ */
  function estimateCost(r) {
    const PR = C.PRICING;
    const inCost = (r.inChars || 0) / 1000 * PR.inPer1kChars;
    const outCost = (r.outChars || 0) / 1000 * PR.outPer1kChars;
    const retr = (r.chunks || 0) * PR.retrievalPerChunk;
    const prio = PR.priority[clamp(r.prio == null ? 2 : r.prio, 0, 4)];
    const depth = clamp(r.depth || 0, 0, 4);
    let total;
    if (depth === 0) {
      const mode = rank(r.model) >= 3 ? 'normal' : 'fast';
      const raw = (PR.modelBase[r.model] || PR.modelBase['zit-small']) + inCost + outCost + retr;
      const [lo, hi] = PR.chat[mode];
      total = clamp(raw, lo, hi) + prio;
    } else {
      // research task price already includes the model effort
      total = Math.max(PR.depth[depth] + inCost + outCost + retr + prio, PR.chat.research[0]);
    }
    return Math.max(1, Math.ceil(total));
  }
  const modeOf = (depth, model) => (depth > 0 ? 'research' : rank(model) >= 3 ? 'normal' : 'fast');

  function documentFee(chars) {
    const D = C.PRICING.document;
    if (chars <= D.smallChars) return D.small;
    if (chars <= D.mediumChars) return D.medium;
    if (chars <= D.largeChars) return Math.round(D.large + (chars - D.mediumChars) / (D.largeChars - D.mediumChars) * (D.largeMax - D.large));
    return null;                       // book / large corpus → custom quote
  }

  /* ------------------------------------------------------------------ *
   * low balance / smart mode / alerts
   * ------------------------------------------------------------------ */
  function balancePct(state, now) {
    const paid = paidCredits(state, now);
    if (state.balanceRef > 0) return paid / state.balanceRef;
    return paid >= 100 ? 1 : paid / 100;
  }
  function isLow(state, now) {
    const paid = paidCredits(state, now);
    if (paid <= 0) return false;                                // nothing paid to protect; free tier already minimal
    return balancePct(state, now) <= 0.20;
  }
  // returns the thresholds (20/10/5) newly crossed
  function checkAlerts(state, now) {
    const fired = [];
    if (!state.settings.lowAlert) return fired;
    const paid = paidCredits(state, now);
    if (paid <= 0 || state.balanceRef <= 0) return fired;
    const pct = paid / state.balanceRef * 100;
    [20, 10, 5].forEach((t) => { if (pct <= t && !state.alertsFired[t]) { state.alertsFired[t] = now; fired.push(t); } });
    return fired;
  }
  function autoRechargeDue(state, now) {
    const a = state.settings.autoRecharge;
    return !!a.on && paidCredits(state, now) < C.inrToCredits(a.triggerInr) ? a : null;
  }

  /* ------------------------------------------------------------------ *
   * request planning (pre-flight) and charging
   * ------------------------------------------------------------------ */
  const passPeriodKey = (pass, plan, now) => (plan.fair && plan.fair.per === 'hour' ? hourKey(now) : dayKey(now));
  function passCovers(state, entPlan, now) {
    for (const ps of state.passes) {
      if (!passWindowActive(ps, now)) continue;
      const pp = C.byId[ps.planId]; if (!pp) continue;
      if (!pp.ent.models.includes(entPlan.model)) continue;
      const key = passPeriodKey(ps, pp, now);
      const u = (ps.usage && ps.usage.key === key) ? ps.usage : { key, chat: 0, research: 0, deep: 0 };
      const f = pp.fair;
      if (entPlan.depth === 0) { if (u.chat < f.chat) return { pass: ps, plan: pp, bucket: 'chat' }; }
      else if (entPlan.depth <= pp.ent.research) { if (u.research < f.research) return { pass: ps, plan: pp, bucket: 'research' }; }
      else if (entPlan.depth === 3 && u.deep < f.deep) return { pass: ps, plan: pp, bucket: 'deep' };
    }
    return null;
  }

  function blocked(code, message, cta, extra) { return Object.assign({ ok: false, code, message, cta: cta || 'plans' }, extra || {}); }

  /**
   * req: { model (ZIT id or null), inChars, files, chunks }
   * Returns { ok:true, model, ctxK, depth, covered, est, minCost, smart, notes[] } or { ok:false, code, message, cta }
   */
  function planRequest(state, req, now) {
    const events = sweep(state, now);
    if (clockTampered(state, now)) return blocked('clock', 'Device clock looks wrong. Please correct date & time to continue.', 'none');
    const ent = entitlement(state, now);
    const notes = [];
    const S = state.settings;

    // 1. model
    const allowed = ent.models;
    let model = req.model && allowed.includes(req.model) ? req.model : null;
    if (!model) {
      const want = rank(req.model || 'zit-small');
      const below = allowed.filter((m) => rank(m) <= want);
      model = (below.length ? below : allowed).slice(-1)[0];
      if (req.model && req.model !== model) notes.push({ type: 'model_fallback', from: req.model, to: model });
    }
    if (S.modelPref !== 'auto' && allowed.includes(S.modelPref) && !req.model) model = S.modelPref;

    // 2. depth
    let depth = clamp(S.depthPref || 0, 0, 4);
    let usesDeepQuota = false;
    if (depth > ent.research) {
      if (depth === 3 && ent.deepQuota > state.counters.day.deep) usesDeepQuota = true;
      else { notes.push({ type: 'depth_clamped', from: depth, to: ent.research }); depth = ent.research; }
    }
    if (depth === 3 && ent.research < 3 && !usesDeepQuota) depth = ent.research;

    // 3. context
    let ctxK = ent.ctx;
    if (typeof S.contextPref === 'number') ctxK = Math.min(ctxK, S.contextPref);

    // 4. smart balance mode
    let smart = false;
    if (S.smartBalance && isLow(state, now)) {
      smart = true;
      model = allowed[0];                    // smallest allowed ZIT model
      ctxK = Math.min(ctxK, 2);
      if (depth > 0) { depth = 0; usesDeepQuota = false; }
      notes.push({ type: 'smart_balance' });
    }

    // 5. files
    if (req.files > 0) {
      if (ent.files === 0 && C.ENFORCE.files) return blocked('files_locked', 'File upload needs a plan with file support.', 'plans');
    }

    // 6. context fit (chars ≈ tokens × 4; keep 25 % for the answer)
    const budgetChars = ctxK * 3000;
    if ((req.inChars || 0) > budgetChars) {
      return blocked('too_long', 'This message is longer than your current plan can read at once (' + ctxK + 'K). Shorten it or upgrade.', 'plans', { ctxK });
    }

    // 7. rate limits (platform safety)
    const RL = C.RATE_LIMITS[clamp(ent.prio, 0, 4)];
    if (state.counters.recent.length >= RL.perMin) return blocked('rate_minute', 'You are going a bit fast — please wait a few seconds.', 'none', { retryMs: 15000 });
    if (state.counters.day.msgs >= RL.perDay) return blocked('rate_day', 'Daily fair-use limit reached for your plan. Upgrade priority for higher limits.', 'plans');

    // 8. cost
    const estIn = { model, inChars: req.inChars || 0, depth, chunks: req.chunks || 0, prio: ent.prio };
    const minCost = estimateCost(Object.assign({ outChars: 0 }, estIn));
    const est = estimateCost(Object.assign({ outChars: depth > 0 ? 3000 : 700 }, estIn));

    // 9. covered by a time pass? (no wallet credits needed)
    const covered = passCovers(state, { model, depth }, now);
    let community = null;
    if (!covered) {
      const bal = totalCredits(state, now);
      if (bal < minCost) {
        // community plan: free tiny-model chat, no credits, tiny daily cap
        const cp = C.byId.community;
        if (state.community && model === 'zit-tiny' && depth === 0 && (state.counters.day.community || 0) < cp.communityDailyMsgs) community = true;
        else return blocked(bal === 0 ? 'no_credits' : 'low_credits',
          bal === 0 ? 'You are out of ZIK Credits. Recharge as little as ₹1 to continue.' : 'Not enough credits for this request.', 'recharge', { need: minCost, have: bal });
      }
      if (S.perRequestLimit != null && est > S.perRequestLimit) return blocked('per_request_limit', 'This request may cost more than your per-request limit.', 'billing', { est });
      if (S.dailyLimit != null && state.counters.day.spent + minCost > S.dailyLimit) return blocked('daily_limit', 'Daily spending limit reached. Change it in Billing Account.', 'billing');
      if (S.monthlyLimit != null && state.counters.month.spent + minCost > S.monthlyLimit) return blocked('monthly_limit', 'Monthly spending limit reached. Change it in Billing Account.', 'billing');
    }

    return {
      ok: true, model, ctxK, depth, usesDeepQuota, est, minCost, smart, notes, events, prio: ent.prio, maxOut: ent.maxOut,
      covered: covered ? { passId: covered.pass.id, planId: covered.plan.id, bucket: covered.bucket } : (community ? { community: true } : null)
    };
  }

  /** Settle a finished request. `actual`: { inChars, outChars, chunks, aborted } */
  function charge(state, plan, actual, now) {
    const res = { credits: 0, covered: plan.covered, alerts: [] };
    const full = estimateCost({ model: plan.model, inChars: actual.inChars, outChars: actual.outChars, depth: plan.depth, chunks: actual.chunks || 0, prio: plan.prio });
    let cost = full;
    if (plan.covered && plan.covered.passId) {
      const ps = state.passes.find((p) => p.id === plan.covered.passId);
      if (ps) {
        const pp = C.byId[ps.planId], key = passPeriodKey(ps, pp, now);
        if (!ps.usage || ps.usage.key !== key) ps.usage = { key, chat: 0, research: 0, deep: 0 };
        ps.usage[plan.covered.bucket] += 1;
      }
      cost = 0;
    } else if (plan.covered && plan.covered.community) {
      state.counters.day.community = (state.counters.day.community || 0) + 1;
      cost = 0;
    } else {
      cost = spend(state, cost, now);
    }
    res.credits = cost;
    state.counters.day.spent += cost; state.counters.month.spent += cost;
    state.counters.day.msgs += 1; state.counters.recent.push(now);
    if (plan.depth > 0) state.counters.day.research += 1;
    if (plan.depth === 3) state.counters.day.deep += 1;
    state.usage.unshift({ ts: now, model: plan.model, mode: modeOf(plan.depth, plan.model), feature: plan.depth > 0 ? 'research' : 'chat',
      credits: cost, covered: plan.covered ? (plan.covered.passId ? 'pass' : 'community') : null, inChars: actual.inChars, outChars: actual.outChars, aborted: !!actual.aborted });
    if (state.usage.length > USAGE_CAP) state.usage.length = USAGE_CAP;
    if (cost > 0) log(state, now, { type: 'usage', credits: -cost, planId: plan.model, note: modeOf(plan.depth, plan.model) });
    res.alerts = checkAlerts(state, now);
    return res;
  }

  /** Charge a document (project knowledge file etc.). */
  function chargeDocument(state, chars, now) {
    sweep(state, now);
    const ent = entitlement(state, now);
    if (ent.files === 0 && C.ENFORCE.files) return blocked('files_locked', 'File analysis needs a plan with file support.', 'plans');
    const fee = documentFee(chars);
    if (fee == null) return blocked('too_large', 'Books / large corpora need a custom quote. Contact sales.', 'contact');
    let pay = fee;
    if (ent.files === 2) pay = 0;
    else if (state.counters.day.files < C.LIMITED_FILES_PER_DAY) pay = 0;
    if (pay > totalCredits(state, now)) return blocked('low_credits', 'Not enough credits to analyse this document (' + C.fmtInr(pay * C.CREDIT_INR) + ').', 'recharge', { need: pay });
    const taken = pay ? spend(state, pay, now) : 0;
    state.counters.day.files += 1;
    state.usage.unshift({ ts: now, model: null, mode: 'document', feature: 'files', credits: taken, inChars: chars, outChars: 0 });
    if (taken) log(state, now, { type: 'usage', credits: -taken, note: 'document' });
    return { ok: true, credits: taken, free: pay === 0 };
  }

  /* ------------------------------------------------------------------ *
   * purchases / subscriptions / refunds (idempotent)
   * ------------------------------------------------------------------ */
  const weekendWindow = (now) => {
    const d = new Date(now), dow = d.getDay();               // 0 Sun … 6 Sat
    if (dow === 6) return { startAt: now, endAt: endOfDay(now + DAY) };
    if (dow === 0) return { startAt: now, endAt: endOfDay(now) };
    const sat = startOfDay(now + (6 - dow) * DAY);
    return { startAt: sat, endAt: endOfDay(sat + DAY) };
  };

  function recordPayment(state, plan, o, now) {
    state.payments.unshift({ id: uid('pay'), orderId: o.orderId, planId: plan.id, name: plan.name, amountInr: o.inr != null ? o.inr : plan.price,
      currency: 'INR', gateway: o.gateway || 'google_play', status: 'paid', ts: now, token: o.token || null });
    if (state.payments.length > PAYMENT_CAP) state.payments.length = PAYMENT_CAP;
  }

  function applyPurchase(state, planId, o, now) {
    o = o || {};
    const plan = C.byId[planId];
    if (!plan) return { ok: false, code: 'unknown_plan', message: 'Unknown plan.' };
    if (!o.orderId) return { ok: false, code: 'no_order', message: 'Missing order id.' };
    if (state.processed[o.orderId]) return { ok: true, duplicate: true };
    if (plan.kind === 'contact' || plan.kind === 'free' || plan.kind === 'trial') return { ok: false, code: 'not_purchasable', message: 'This plan is not a direct purchase.' };
    if (C.PHASES[plan.phase] === false) return { ok: false, code: 'phase_off', message: 'This plan is not available yet.' };
    if (plan.studentOnly && state.student.status !== 'verified') return { ok: false, code: 'student_only', message: 'Verify your Student ID to buy this plan.' };
    sweep(state, now);

    const res = { ok: true, planId, granted: 0, bonus: 0, cashback: 0, recovered: 0, events: [] };
    const orderId = o.orderId;
    const paidBefore = paidCredits(state, now);

    // ---- figure out what is granted
    let credits = 0, bonus = 0, validityDays = plan.validityDays, ent = plan.ent, inr = plan.price;
    if (plan.kind === 'custom') {
      const cr = C.customRecharge(o.inr);
      if (!cr) return { ok: false, code: 'bad_amount', message: 'Enter an amount between ₹1 and ₹1,00,000.' };
      credits = cr.credits; bonus = cr.bonus; validityDays = cr.validityDays; ent = cr.ent; inr = cr.inr;
    } else if (plan.kind === 'bucket') { credits = plan.credits; bonus = plan.bonus || 0; }
    else if (plan.kind === 'sub') { credits = plan.credits; }
    else if (plan.kind === 'pass' && plan.credits) { credits = plan.credits; bonus = plan.bonus || 0; }
    if (totalCredits(state, now) + credits + bonus > C.MAX_BALANCE_CREDITS) {
      return { ok: false, code: 'wallet_cap', message: 'Wallet limit is ₹1,00,000. Use some credits before recharging.' };
    }

    // ---- by kind
    if (plan.kind === 'bucket' || plan.kind === 'custom') {
      const cashPct = (C.PHASES[5] !== false && plan.group === 'recharge') ? C.cashbackPct(inr) : 0;
      const cash = Math.round(credits * cashPct / 100);
      const rec = recoverLoans(state, credits + bonus, now, orderId);
      const net = credits + bonus - rec;
      // keep bonus/credit split for the ledger, but a single bucket (same expiry & entitlement)
      grantBucket(state, { source: 'purchase', planId: plan.id, ref: orderId, credits: net, validityDays, ent }, now);
      log(state, now, { type: 'recharge', credits: credits, planId: plan.id, ref: orderId, note: plan.name });
      if (bonus) log(state, now, { type: 'bonus', credits: bonus, planId: plan.id, ref: orderId, note: 'Recharge bonus' });
      if (cash) { grantBucket(state, { source: 'cashback', planId: plan.id, ref: orderId, credits: cash, validityDays }, now); log(state, now, { type: 'cashback', credits: cash, planId: plan.id, ref: orderId, note: cashPct + '% cashback' }); }
      if (plan.lifetimeAccess) state.lifetime = { planId: plan.id, since: now, orderId };
      Object.assign(res, { granted: credits, bonus, cashback: cash, recovered: rec });
    } else if (plan.kind === 'sub') {
      const period = (plan.validityDays || 30) * DAY;
      state.sub = { planId: plan.id, status: 'active', startedAt: now, renewsAt: now + period, autoRenew: true, orderId, token: o.token || null };
      if (plan.seats) state.team = { planId: plan.id, seats: plan.seats, members: (state.team && state.team.members) || [] };
      const rec = recoverLoans(state, credits, now, orderId);
      grantBucket(state, { source: 'subscription', planId: plan.id, ref: orderId, credits: credits - rec, expiresAt: now + period }, now);
      log(state, now, { type: 'subscription', credits, planId: plan.id, ref: orderId, note: plan.name });
      Object.assign(res, { granted: credits, recovered: rec });
    } else if (plan.kind === 'addon') {
      state.addons[plan.id] = { status: 'active', startedAt: now, renewsAt: now + plan.validityDays * DAY, orderId, token: o.token || null };
      log(state, now, { type: 'addon', credits: 0, planId: plan.id, ref: orderId, note: plan.name });
    } else if (plan.kind === 'pass') {
      let startAt = now, endAt = now + plan.durationMs;
      if (plan.window === 'weekend') ({ startAt, endAt } = weekendWindow(now));
      state.passes.push({ id: uid('ps'), planId: plan.id, startAt, endAt, orderId, usage: null });
      if (credits + bonus) {
        const rec = recoverLoans(state, credits + bonus, now, orderId);
        grantBucket(state, { source: 'purchase', planId: plan.id, ref: orderId, credits: credits + bonus - rec, validityDays: plan.validityDays }, now);
        log(state, now, { type: 'recharge', credits, planId: plan.id, ref: orderId, note: plan.name });
        if (bonus) log(state, now, { type: 'bonus', credits: bonus, planId: plan.id, ref: orderId, note: 'Festival bonus' });
        Object.assign(res, { granted: credits, bonus, recovered: rec });
      } else log(state, now, { type: 'pass', credits: 0, planId: plan.id, ref: orderId, note: plan.name });
      res.startAt = startAt; res.endAt = endAt;
    }

    state.processed[orderId] = now;
    recordPayment(state, plan, { orderId, inr, token: o.token, gateway: o.gateway }, now);
    // alert baseline resets after every real top-up
    if (credits + bonus > 0) { state.balanceRef = Math.max(paidCredits(state, now), 0); state.alertsFired = {}; }
    else if (paidBefore === 0) state.balanceRef = paidCredits(state, now);
    return res;
  }

  /** Largest custom recharge (₹) that still fits under the ₹1,00,000 wallet cap, bonus included. */
  function maxCustomInr(state, now) {
    const room = C.MAX_BALANCE_CREDITS - totalCredits(state, now);
    let lo = 0, hi = C.MAX_RECHARGE_INR;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2), c = C.customRecharge(mid);
      if (c && c.credits + c.bonus <= room) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Subscription renewal notification (Play RTDN / restore). Idempotent on orderId. */
  function applyRenewal(state, planId, o, now) {
    const plan = C.byId[planId];
    if (!plan || (plan.kind !== 'sub' && plan.kind !== 'addon')) return { ok: false, code: 'unknown_plan' };
    if (state.processed[o.orderId]) return { ok: true, duplicate: true };
    const period = (plan.validityDays || 30) * DAY;
    if (plan.kind === 'addon') {
      const a = state.addons[plan.id] || { startedAt: now };
      state.addons[plan.id] = Object.assign(a, { status: 'active', renewsAt: Math.max(now, a.renewsAt || 0) + period, orderId: o.orderId });
    } else {
      const s = state.sub && state.sub.planId === plan.id ? state.sub : { planId: plan.id, startedAt: now };
      state.sub = Object.assign(s, { status: 'active', renewsAt: Math.max(now, s.renewsAt || 0) + period, autoRenew: true, orderId: o.orderId });
      const rec = recoverLoans(state, plan.credits, now, o.orderId);
      grantBucket(state, { source: 'subscription', planId: plan.id, ref: o.orderId, credits: plan.credits - rec, expiresAt: state.sub.renewsAt }, now);
      log(state, now, { type: 'subscription', credits: plan.credits, planId: plan.id, ref: o.orderId, note: plan.name + ' renewed' });
    }
    state.processed[o.orderId] = now;
    recordPayment(state, plan, { orderId: o.orderId, gateway: o.gateway }, now);
    return { ok: true };
  }

  function cancelSubscription(state, kind, id, now) {
    if (kind === 'addon') { const a = state.addons[id]; if (!a) return false; a.status = 'canceled'; return true; }
    if (!state.sub) return false;
    state.sub.status = 'canceled'; state.sub.autoRenew = false; return true;
  }

  /** Refund / chargeback: take back remaining credits of that order and end the entitlement. Idempotent. */
  function applyRefund(state, orderId, now) {
    const key = 'refund:' + orderId;
    if (state.processed[key]) return { ok: true, duplicate: true };
    const pay = state.payments.find((p) => p.orderId === orderId);
    if (!pay) return { ok: false, code: 'unknown_order' };
    let clawed = 0;
    state.buckets.forEach((b) => { if (b.ref === orderId) { clawed += b.remaining; b.remaining = 0; } });
    state.buckets = state.buckets.filter((b) => b.remaining > 0);
    if (state.sub && state.sub.orderId === orderId) state.sub.status = 'expired';
    Object.keys(state.addons).forEach((id) => { if (state.addons[id].orderId === orderId) state.addons[id].status = 'expired'; });
    state.passes = state.passes.filter((p) => p.orderId !== orderId);
    if (state.lifetime && state.lifetime.orderId === orderId) state.lifetime = null;
    pay.status = 'refunded';
    log(state, now, { type: 'refund', credits: -clawed, planId: pay.planId, ref: orderId, note: 'Refund processed' });
    state.processed[key] = now;
    return { ok: true, clawed };
  }

  /* ------------------------------------------------------------------ *
   * trials
   * ------------------------------------------------------------------ */
  function startTrial(state, planId, now) {
    const plan = C.byId[planId];
    if (!plan || plan.kind !== 'trial') return { ok: false, code: 'unknown_plan' };
    if (state.trialUsed) return { ok: false, code: 'trial_used', message: 'You have already used your free trial.' };
    sweep(state, now);
    state.trialUsed = true;
    state.trial = { planId, status: 'active', startedAt: now, endsAt: now + plan.validityDays * DAY };
    grantBucket(state, { source: 'trial', planId, credits: plan.credits, expiresAt: state.trial.endsAt }, now);
    log(state, now, { type: 'reward', credits: plan.credits, planId, note: plan.name + ' started' });
    if (state.balanceRef < plan.credits) state.balanceRef = plan.credits;
    return { ok: true, endsAt: state.trial.endsAt };
  }

  /* ------------------------------------------------------------------ *
   * AI loans
   * ------------------------------------------------------------------ */
  function loanEligibility(state, ctx, now) {
    const age = (now - state.createdAt) / DAY;
    const outstanding = state.loans.some((l) => l.status === 'outstanding');
    return C.LOANS.map((L) => {
      let ok = true, reason = '';
      if (outstanding) { ok = false; reason = 'Repay your current loan first (auto-deducted on next recharge).'; }
      else if (L.rule === 'verified' && !ctx.verified) { ok = false; reason = 'Verify your account (sign in with a verified email).'; }
      else if (L.rule === 'age7' && age < 7) { ok = false; reason = 'Account must be 7+ days old (' + Math.ceil(7 - age) + ' to go).'; }
      else if (L.rule === 'student' && state.student.status !== 'verified') { ok = false; reason = 'Student verification required.'; }
      else if (L.rule === 'business' && !state.businessVerified) { ok = false; reason = 'Business verification required — contact sales.'; }
      if (ok && L.limit) {
        const since = now - L.limit.perDays * DAY;
        const n = state.loans.filter((l) => l.type === L.id && l.takenAt >= since).length;
        if (n >= L.limit.count) {
          const first = state.loans.filter((l) => l.type === L.id && l.takenAt >= since).map((l) => l.takenAt).sort((a, b) => a - b)[0];
          ok = false; reason = 'Limit reached — next loan on ' + new Date(first + L.limit.perDays * DAY).toLocaleDateString();
        }
      }
      return { loan: L, ok, reason };
    });
  }
  function takeLoan(state, loanId, ctx, now) {
    sweep(state, now);
    const el = loanEligibility(state, ctx, now).find((e) => e.loan.id === loanId);
    if (!el) return { ok: false, code: 'unknown_loan' };
    if (!el.ok) return { ok: false, code: 'not_eligible', message: el.reason };
    const L = el.loan;
    if (L.credits == null) return { ok: false, code: 'contact', message: 'Business credit line is arranged with sales.' };
    const loan = { id: uid('ln'), type: L.id, given: L.credits, owed: L.credits, takenAt: now, status: 'outstanding' };
    state.loans.unshift(loan);
    grantBucket(state, { source: 'loan', planId: L.id, ref: loan.id, credits: L.credits, validityDays: C.LOAN_VALID_DAYS,
      ent: { models: L.models, ctx: L.ctx, research: 1, files: 0, prio: 1 } }, now);
    log(state, now, { type: 'loan', credits: L.credits, planId: L.id, ref: loan.id, note: L.name });
    return { ok: true, loan };
  }
  const outstandingLoan = (state) => state.loans.filter((l) => l.status === 'outstanding').reduce((n, l) => n + l.owed, 0);

  /* ------------------------------------------------------------------ *
   * rewards
   * ------------------------------------------------------------------ */
  function dailyRewardStatus(state, now) {
    const R = state.rewards, today = dayKey(now), yesterday = dayKey(now - DAY);
    const claimedToday = R.lastLoginDay === today;
    const nextStreak = claimedToday ? R.streak : (R.lastLoginDay === yesterday ? R.streak + 1 : 1);
    const idx = (nextStreak - 1) % 7;
    return { claimedToday, streak: claimedToday ? R.streak : R.streak, nextStreak, nextAmount: C.REWARDS.daily[idx], cycleDay: idx + 1, table: C.REWARDS.daily,
      nextMilestone: [7, 30, 100].find((m) => m > (claimedToday ? R.streak : nextStreak - 1)) || null };
  }
  function claimDaily(state, now) {
    sweep(state, now);
    if (clockTampered(state, now)) return { ok: false, code: 'clock', message: 'Device clock looks wrong.' };
    const R = state.rewards, today = dayKey(now), yesterday = dayKey(now - DAY);
    if (R.lastLoginDay === today) return { ok: false, code: 'already', message: 'Already claimed today. Come back tomorrow!' };
    if (R.lastLoginDay === yesterday) R.streak += 1; else { R.streak = 1; R.streakStart = today; }
    if (!R.streakStart) R.streakStart = today;
    R.lastLoginDay = today;
    const amount = C.REWARDS.daily[(R.streak - 1) % 7];
    grantBucket(state, { source: 'reward', planId: 'daily', credits: amount, validityDays: 30 }, now);
    log(state, now, { type: 'reward', credits: amount, planId: 'daily', note: 'Daily login · day ' + R.streak });
    let streakBonus = 0;
    const m = C.REWARDS.streak[R.streak];
    const mk = R.streakStart + ':' + R.streak;
    if (m && !R.milestones[mk]) {
      R.milestones[mk] = now; streakBonus = m;
      grantBucket(state, { source: 'reward', planId: 'streak', credits: m, validityDays: 60 }, now);
      log(state, now, { type: 'reward', credits: m, planId: 'streak', note: R.streak + '-day streak' });
    }
    return { ok: true, amount, streak: R.streak, streakBonus };
  }

  const festivalsActive = (state, now) => C.FESTIVALS.filter((f) => {
    const s = new Date(f.start + 'T00:00:00').getTime(), e = endOfDay(new Date(f.end + 'T00:00:00').getTime());
    return now >= s && now <= e && !state.rewards.festivals.includes(f.id);
  });
  function claimFestival(state, id, now) {
    sweep(state, now);
    if (C.PHASES[5] === false) return { ok: false, code: 'phase_off' };
    const f = festivalsActive(state, now).find((x) => x.id === id);
    if (!f) return { ok: false, code: 'unavailable', message: 'This offer is not active or already claimed.' };
    state.rewards.festivals.push(f.id);
    grantBucket(state, { source: 'reward', planId: 'festival', ref: f.id, credits: f.credits, validityDays: f.validityDays }, now);
    log(state, now, { type: 'reward', credits: f.credits, planId: 'festival', ref: f.id, note: f.name + ' gift' });
    return { ok: true, credits: f.credits, name: f.name };
  }

  function submitFeedback(state, text, now) {
    sweep(state, now);
    const F = C.REWARDS.feedback, R = state.rewards, dk = dayKey(now);
    text = String(text || '').trim();
    if (text.length < F.detailedMinChars) return { ok: false, code: 'short', message: 'Please write at least ' + F.detailedMinChars + ' characters so we can act on it.' };
    if (R.feedbackDay.key !== dk) R.feedbackDay = { key: dk, count: 0 };
    if (R.feedbackDay.count >= F.perDay) return { ok: true, credits: 0, message: 'Thanks! Feedback reward is limited to ' + F.perDay + ' per day.' };
    R.feedbackDay.count += 1;
    grantBucket(state, { source: 'reward', planId: 'feedback', credits: F.detailed, validityDays: 30 }, now);
    log(state, now, { type: 'reward', credits: F.detailed, planId: 'feedback', note: 'Detailed feedback' });
    return { ok: true, credits: F.detailed };
  }

  function referralCode(seed) {
    let h = 2166136261; const s = String(seed || 'guest');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 'ZIK' + h.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  }
  /** role: 'inviter' | 'invitee' — called only after the server confirmed a referral. */
  function applyReferralReward(state, role, ref, now) {
    const RR = C.REWARDS.referral, R = state.rewards.referral;
    if (state.processed['ref:' + role + ':' + ref]) return { ok: true, duplicate: true };
    if (role === 'inviter' && R.count >= RR.maxReferrals) return { ok: false, code: 'cap', message: 'Referral limit reached (' + RR.maxReferrals + ').' };
    if (role === 'invitee' && R.redeemed) return { ok: false, code: 'already', message: 'You already used a referral code.' };
    const credits = role === 'inviter' ? RR.inviter : RR.invitee;
    if (role === 'inviter') R.count += 1; else R.redeemed = true;
    grantBucket(state, { source: 'reward', planId: 'referral', ref, credits, validityDays: 90 }, now);
    log(state, now, { type: 'referral', credits, planId: 'referral', ref, note: role === 'inviter' ? 'Friend joined' : 'Welcome gift' });
    state.processed['ref:' + role + ':' + ref] = now;
    return { ok: true, credits };
  }

  /* ------------------------------------------------------------------ *
   * usage statistics (for the dashboard)
   * ------------------------------------------------------------------ */
  function usageStats(state, now) {
    const t0 = startOfDay(now), week0 = t0 - 6 * DAY;
    const nd = new Date(now), month0 = new Date(nd.getFullYear(), nd.getMonth(), 1).getTime();
    const out = { today: 0, week: 0, month: 0, total: 0, requests: state.usage.length, byModel: {}, byFeature: {}, daily: [], recent: state.usage.slice(0, 20), covered: 0 };
    for (let i = 6; i >= 0; i--) out.daily.push({ day: dayKey(t0 - i * DAY), credits: 0, msgs: 0, ts: t0 - i * DAY });
    state.usage.forEach((u) => {
      out.total += u.credits;
      if (u.ts >= t0) out.today += u.credits;
      if (u.ts >= week0) out.week += u.credits;
      if (u.ts >= month0) out.month += u.credits;
      if (u.ts >= month0) {
        const mk = u.model ? (C.MODELS[u.model] || {}).label || u.model : 'Documents';
        out.byModel[mk] = (out.byModel[mk] || 0) + u.credits;
        out.byFeature[u.feature] = (out.byFeature[u.feature] || 0) + u.credits;
      }
      if (u.covered) out.covered += 1;
      const d = out.daily.find((x) => x.day === dayKey(u.ts)); if (d) { d.credits += u.credits; d.msgs += 1; }
    });
    return out;
  }


  /* ------------------------------------------------------------------ *
   * merge two states (guest wallet + cloud wallet after sign-in; two devices)
   * Never loses a purchase, never double-counts one.
   * ------------------------------------------------------------------ */
  function mergeStates(a, b, now) {
    a = migrate(a, now); b = migrate(b, now);
    const out = migrate(JSON.parse(JSON.stringify(a)), now);
    const byId = (arr) => { const m = new Map(); arr.forEach((x) => m.set(x.id, x)); return m; };
    // buckets: union; if both know a bucket the one with less remaining wins (spending is monotonic)
    const bm = byId(a.buckets);
    b.buckets.forEach((x) => { const y = bm.get(x.id); if (!y) bm.set(x.id, x); else if (x.remaining < y.remaining) bm.set(x.id, x); });
    out.buckets = Array.from(bm.values());
    // free daily allowance: one per day across devices
    const fa = out.buckets.filter((x) => x.source === 'free_daily');
    if (fa.length > 1) { const keep = fa.reduce((m, x) => (x.remaining < m.remaining ? x : m)); out.buckets = out.buckets.filter((x) => x.source !== 'free_daily' || x === keep); }
    const union = (k, key, cap) => { const m = new Map(); a[k].concat(b[k]).forEach((x) => { const id = x[key]; if (!m.has(id)) m.set(id, x); else if (x.status && m.get(id).status !== 'paid' && x.status === 'refunded') m.set(id, x); }); return Array.from(m.values()).sort((p, q) => q.ts - p.ts).slice(0, cap); };
    out.ledger = union('ledger', 'id', LEDGER_CAP);
    out.payments = union('payments', 'orderId', PAYMENT_CAP);
    out.usage = a.usage.concat(b.usage).sort((p, q) => q.ts - p.ts).filter((u, i, arr) => !i || u.ts !== arr[i - 1].ts || u.credits !== arr[i - 1].credits).slice(0, USAGE_CAP);
    out.processed = Object.assign({}, b.processed, a.processed);
    const lm = byId(a.loans); b.loans.forEach((x) => { const y = lm.get(x.id); if (!y || (y.status === 'outstanding' && x.status !== 'outstanding') || x.owed < y.owed) lm.set(x.id, x); });
    out.loans = Array.from(lm.values()).sort((p, q) => q.takenAt - p.takenAt);
    const pm = byId(a.passes); b.passes.forEach((x) => { if (!pm.has(x.id)) pm.set(x.id, x); });
    out.passes = Array.from(pm.values());
    const later = (x, y, k) => ((y && (!x || (y[k] || 0) > (x[k] || 0))) ? y : x);
    out.sub = later(a.sub, b.sub, 'renewsAt');
    out.addons = Object.assign({}, b.addons); Object.keys(a.addons).forEach((k) => { out.addons[k] = later(a.addons[k], b.addons[k], 'renewsAt'); });
    out.lifetime = a.lifetime || b.lifetime;
    out.team = a.team || b.team;
    out.trialUsed = !!(a.trialUsed || b.trialUsed);
    out.trial = later(a.trial, b.trial, 'endsAt');
    out.createdAt = Math.min(a.createdAt || now, b.createdAt || now);
    out.lastSeen = Math.max(a.lastSeen || 0, b.lastSeen || 0);
    out.balanceRef = Math.max(a.balanceRef || 0, b.balanceRef || 0);
    out.alertsFired = Object.assign({}, b.alertsFired, a.alertsFired);
    const ra = a.rewards, rb = b.rewards, rw = ra.lastLoginDay >= rb.lastLoginDay ? ra : rb;
    out.rewards = Object.assign({}, rw, {
      festivals: Array.from(new Set(ra.festivals.concat(rb.festivals))),
      milestones: Object.assign({}, rb.milestones, ra.milestones),
      pending: (ra.pending || []).concat(rb.pending || []).slice(0, 50),
      referral: { code: ra.referral.code || rb.referral.code, redeemed: !!(ra.referral.redeemed || rb.referral.redeemed), count: Math.max(ra.referral.count, rb.referral.count) },
      feedbackDay: ra.feedbackDay.key >= rb.feedbackDay.key ? ra.feedbackDay : rb.feedbackDay
    });
    out.free = { lastRefillDay: (a.free.lastRefillDay || '') >= (b.free.lastRefillDay || '') ? a.free.lastRefillDay : b.free.lastRefillDay };
    out.student = (a.student.status === 'verified' || b.student.status !== 'verified') ? a.student : b.student;
    out.businessVerified = !!(a.businessVerified || b.businessVerified);
    out.community = !!(a.community || b.community);
    out.settings = b.rev > a.rev ? b.settings : a.settings;
    out.counters = (a.lastSeen || 0) >= (b.lastSeen || 0) ? a.counters : b.counters;
    out.rev = Math.max(a.rev, b.rev) + 1;
    return out;
  }

  /* fit chat history into the plan's context window (newest pairs win) */
  function fitHistory(pairs, ctxK, reservedChars) {
    const budget = Math.max(0, ctxK * 3000 - (reservedChars || 0));
    const out = []; let used = 0;
    for (let i = pairs.length - 1; i >= 0; i--) {
      const n = (pairs[i].user || '').length + (pairs[i].bot || '').length;
      if (used + n > budget) break;
      used += n; out.unshift(pairs[i]);
    }
    return out;
  }

  return {
    DAY, HOUR, dayKey, monthKey, hourKey, endOfDay, startOfDay,
    newState, migrate, mergeStates, sweep, balance, totalCredits, paidCredits, entitlement, estimateCost, modeOf, documentFee,
    planRequest, charge, chargeDocument, grantBucket, spend, log,
    applyPurchase, maxCustomInr, applyRenewal, cancelSubscription, applyRefund, startTrial,
    loanEligibility, takeLoan, outstandingLoan,
    dailyRewardStatus, claimDaily, festivalsActive, claimFestival, submitFeedback, referralCode, applyReferralReward,
    isLow, balancePct, checkAlerts, autoRechargeDue, usageStats, fitHistory, clockTampered,
    weekendWindow, subActive, trialActive, passWindowActive
  };
}

export const ENGINE: any = build(CATALOG);
export default ENGINE;
