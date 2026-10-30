// @ts-nocheck
/* Ported from the original zikriyon-features.js (wallet / plans / limit sheets). Checkout is the new UPI flow. */
import E from '../billing/engine';
import C from '../billing/catalog';
import { sendEmailVerification } from 'firebase/auth';
import { getFirebase } from '../firebase/client';
import { walletStore as S } from '../wallet-store';
import { CONFIG } from '../config';
import { bridge, registerPanel, panels, open, render, esc, ic, fmtC, inr, now, $, $$, T, user, fmtDate, fmtDateTime, until, modelLabel, modelShort, switchBtn, rowSwitch, empty } from './framework';
import { priceLabel } from './billing-adapter';

const st = () => S.get();
  /* ---------- plan helpers ---------- */
function planActive(p, s, t) {
    switch (p.kind) {
      case 'sub': return !!s.sub && s.sub.planId === p.id && E.subActive(s.sub, t);
      case 'addon': { const a = s.addons[p.id]; return !!a && (a.status === 'active' ? t <= a.renewsAt + 3 * 864e5 : a.status === 'canceled' && t <= a.renewsAt); }
      case 'trial': return !!s.trial && s.trial.planId === p.id && E.trialActive(s.trial, t);
      case 'pass': return s.passes.some((x) => x.planId === p.id && t <= x.endAt);
      case 'bucket': return (p.lifetimeAccess && s.lifetime && s.lifetime.planId === p.id) || s.buckets.some((b) => b.planId === p.id && b.remaining > 0 && (b.expiresAt == null || b.expiresAt > t));
      case 'free':
        if (p.id === 'free_forever') return !(s.sub && E.subActive(s.sub, t)) && !(s.trial && E.trialActive(s.trial, t));
        if (p.id === 'community') return !!s.community;
        if (p.id === 'student_free') return s.student.status === 'verified';
        return false;
      default: return false;
    }
  }
function currentPlanName(s, t) {
    if (s.sub && E.subActive(s.sub, t)) return (C.byId[s.sub.planId] || {}).name || 'Subscription';
    if (s.lifetime) return (C.byId[s.lifetime.planId] || {}).name || 'Lifetime';
    if (s.trial && E.trialActive(s.trial, t)) return (C.byId[s.trial.planId] || {}).name + ' (trial)';
    const live = s.buckets.filter((b) => b.source === 'purchase' && b.remaining > 0).sort((a, b) => ((C.byId[b.planId] || {}).price || 0) - ((C.byId[a.planId] || {}).price || 0))[0];
    if (live) return (C.byId[live.planId] || {}).name + ' credits';
    return 'Free Forever';
  }
function validityText(p) {
    if (p.kind === 'pass') {
      if (p.window === 'weekend') return 'Saturday – Sunday';
      const h = p.durationMs / 36e5; return h < 24 ? h + ' hour' : Math.round(h / 24) + ' day' + (h / 24 > 1 ? 's' : '') + (h === 24 ? ' (24 hours)' : '');
    }
    if (p.kind === 'sub') return p.period === 'year' ? 'Renews every year' : 'Renews every month';
    if (p.kind === 'addon') return 'Renews every month';
    if (p.kind === 'trial') return p.validityDays + ' days';
    if (p.kind === 'bucket' || p.kind === 'custom') return p.validityDays ? 'Valid ' + p.validityDays + ' days' : 'Never expires';
    return '';
  }
function planFeatures(p) {
    const L = [], e = p.ent;
    if (e) L.push([modelShort(e.models), 1]);
    if (p.ctxText) L.push(['Context ' + p.ctxText, 1]);
    if (p.modeText) L.push([p.modeText, 1]);
    if (e) {
      L.push(['File upload: ' + C.FILES_LABEL[e.files], e.files > 0]);
      L.push(['Priority: ' + C.PRIO_LABEL[e.prio], 1]);
      if (e.api) L.push(['API: ' + C.API_LABEL[e.api], 1]);
    }
    if (p.seats) L.push([p.seats + ' seats / members', 1]);
    if (p.benefit) L.push([p.benefit, 1]);
    const v = validityText(p); if (v) L.push([v, 1]);
    if (p.studentOnly) L.push(['Needs verified Student ID', 0]);
    return L;
  }
  const priceText = (p) => {
    if (p.kind === 'contact' || (p.price == null && p.kind !== 'custom' && p.id !== 'api_payg')) return '<span>Custom</span>';
    if (p.id === 'api_payg') return '<span>Usage-based</span>';
    if (p.kind === 'custom') return '<span>₹1 – ₹1,00,000</span>';
    if (p.price === 0) return 'Free';
    const per = p.period === 'month' ? '/month' : p.period === 'year' ? '/year' : p.kind === 'pass' || p.kind === 'bucket' ? ' one-time' : '';
    return `${esc(priceLabel(p))}<small>${per}</small>`;
  };

function planCard(p, i) {
    const s = st(), t = now(), act = planActive(p, s, t), off = C.PHASES[p.phase] === false;
    let credits = '';
    if (p.credits) credits = `<div class="credits">${ic('bolt')}${fmtC(p.credits + (p.bonus || 0))} credits${p.bonus ? `<em>+${fmtC(p.bonus)} bonus</em>` : ''}</div>`;
    else if (p.dailyCredits) credits = `<div class="credits">${ic('bolt')}${p.dailyCredits} credits / day</div>`;
    else if (p.kind === 'pass') credits = `<div class="credits">${ic('all_inclusive')}Unlimited basic chat · fair-use</div>`;
    else if (p.id === 'community') credits = `<div class="credits">${ic('volunteer_activism')}No credits needed</div>`;
    const feats = planFeatures(p).map(([tx, ok]) => `<li class="${ok ? '' : 'no'}">${ic(ok ? 'check' : 'close')}<span>${esc(tx)}</span></li>`).join('');
    let cta;
    if (off) cta = `<button class="btn btn-ghost" disabled>Coming soon</button>`;
    else if (p.kind === 'contact') cta = `<button class="btn btn-ghost" data-a="contact" data-id="${p.id}">${ic('support_agent')} Contact sales</button>`;
    else if (p.kind === 'trial') cta = s.trialUsed ? `<button class="btn btn-ghost" disabled>${act ? 'Active' : 'Used'}</button>` : `<button class="btn btn-primary" data-a="trial" data-id="${p.id}">Start free</button>`;
    else if (p.id === 'community') cta = `<button class="btn ${s.community ? 'btn-ghost' : 'btn-primary'}" data-a="community">${s.community ? 'Turn off' : 'Turn on'}</button>`;
    else if (p.id === 'student_free') cta = s.student.status === 'verified' ? `<button class="btn btn-ghost" disabled>Verified</button>` : `<button class="btn btn-primary" data-a="student">${ic('school')} Verify Student ID</button>`;
    else if (p.kind === 'free') cta = `<button class="btn btn-ghost" disabled>${act ? 'Included' : 'Free'}</button>`;
    else if (p.kind === 'custom') cta = `<button class="btn btn-primary" data-a="custom-focus">Choose amount</button>`;
    else if (p.studentOnly && s.student.status !== 'verified') cta = `<button class="btn btn-ghost" data-a="student">${ic('school')} Verify to buy</button>`;
    else if (act && p.kind === 'sub') cta = `<button class="btn btn-ghost" data-a="billing">Manage</button>`;
    else if (act && p.kind === 'addon') cta = `<button class="btn btn-ghost" data-a="billing">Manage</button>`;
    else cta = `<button class="btn btn-primary" data-a="buy" data-id="${p.id}">${p.kind === 'sub' ? 'Subscribe' : p.kind === 'addon' ? 'Add' : 'Buy'} · ${esc(priceLabel(p))}</button>`;
    const badge = act ? `<span class="zik-badge cur">${p.kind === 'sub' || p.kind === 'addon' ? 'Active' : 'Current'}</span>` : p.badge ? `<span class="zik-badge">${esc(p.badge)}</span>` : '';
    const seatLeft = p.seatsTotal ? `<div class="zik-note">Limited seats · ${p.seatsTotal} total</div>` : '';
    return `<div class="zik-plan${act ? ' active' : ''}${off ? ' off' : ''}" style="animation-delay:${Math.min(i * 30, 240)}ms">
      ${badge}<h4>${esc(p.name)}</h4><div class="price">${priceText(p)}</div>${credits}<ul>${feats}</ul>${seatLeft}${cta}</div>`;
  }
function quickBuy(amountInr) {
    const exact = C.PLANS.find((p) => p.group === 'recharge' && p.kind === 'bucket' && p.price === amountInr);
    if (exact) return open('checkout', { planId: exact.id });
    return open('checkout', { planId: 'recharge_custom', inr: amountInr });
  }
  const LIMIT_UI = {
    no_credits: { icon: 'battery_alert', cls: 'err', title: 'Out of credits', ctas: ['recharge', 'loan', 'plans'] },
    low_credits: { icon: 'battery_alert', cls: 'warn', title: 'Not enough credits', ctas: ['recharge', 'loan', 'plans'] },
    rate_minute: { icon: 'speed', cls: 'warn', title: 'Easy there!', ctas: ['ok'] },
    rate_day: { icon: 'event_busy', cls: 'warn', title: 'Daily limit reached', ctas: ['plans', 'ok'] },
    daily_limit: { icon: 'savings', cls: 'warn', title: 'Daily spending limit', ctas: ['billing', 'ok'] },
    monthly_limit: { icon: 'savings', cls: 'warn', title: 'Monthly spending limit', ctas: ['billing', 'ok'] },
    per_request_limit: { icon: 'price_check', cls: 'warn', title: 'Request cost limit', ctas: ['billing', 'ok'] },
    files_locked: { icon: 'lock', cls: '', title: 'Files need an upgrade', ctas: ['plans', 'ok'] },
    voice_locked: { icon: 'mic_off', cls: '', title: 'Voice is an add-on', ctas: ['addons', 'ok'] },
    too_long: { icon: 'notes', cls: 'warn', title: 'Message too long', ctas: ['plans', 'ok'] },
    model_locked: { icon: 'lock', cls: '', title: 'Model locked', ctas: ['plans', 'ok'] },
    clock: { icon: 'schedule', cls: 'err', title: 'Check your clock', ctas: ['ok'] }
  };
  registerPanel('limit', {
    title: 'Heads up', sheet: true,
    render(arg) {
      const a = arg || {}, u = LIMIT_UI[a.code] || { icon: 'info', cls: '', title: 'Notice', ctas: ['ok'] };
      const loanOk = C.PHASES[5] !== false && E.loanEligibility(st(), { verified: verifiedAccount() }, now()).some((x) => x.ok && x.loan.credits);
      const btn = {
        recharge: `<button class="btn btn-primary btn-block" data-a="go" data-to="plans:recharge">${ic('bolt')} Recharge from ₹1</button>`,
        loan: loanOk ? `<button class="btn btn-ghost btn-block" data-a="go" data-to="wallet">${ic('volunteer_activism')} Get an AI credit advance</button>` : '',
        plans: `<button class="btn btn-primary btn-block" data-a="go" data-to="plans:sub">${ic('workspace_premium')} See plans</button>`,
        addons: `<button class="btn btn-primary btn-block" data-a="go" data-to="plans:addon">${ic('extension')} See add-ons</button>`,
        billing: `<button class="btn btn-primary btn-block" data-a="go" data-to="billing">${ic('tune')} Billing controls</button>`,
        ok: `<button class="btn btn-ghost btn-block" data-zclose>OK</button>`
      };
      return `<div class="zik-center"><div class="zik-sheet-ico ${u.cls}">${ic(u.icon)}</div><h3>${esc(u.title)}</h3><p>${esc(a.message || '')}</p></div>
        ${a.need ? `<div class="zik-info">This request needs about <b>${fmtC(a.need)}</b> credits · you have <b>${fmtC(a.have || 0)}</b>.</div>` : ''}
        <div class="zik-stack">${u.ctas.map((c) => btn[c] || '').join('')}</div>`;
    },
    actions: {
      go(b) { const [id, arg] = b.dataset.to.split(':'); open(id, arg); }
    }
  });
function showLimit(plan) { open('limit', plan); }

  /* ---------- helpers shared with panels ---------- */
function verifiedAccount() {
    const u = user(); if (!u) return false;
    return !!(u.emailVerified || (u.providerData || []).some((p) => p.providerId === 'google.com' || p.providerId === 'phone'));
  }
  /* =====================================================================
     WALLET PANEL
     ===================================================================== */
  let ledgerFilter = 'all', ledgerMore = 25;
  const LEDGER_ICON = { recharge: 'add_card', bonus: 'redeem', usage: 'bolt', loan: 'volunteer_activism', loan_recovery: 'undo', loan_return: 'undo', referral: 'group_add', cashback: 'savings', refund: 'currency_exchange', reward: 'redeem', subscription: 'workspace_premium', addon: 'extension', pass: 'confirmation_number', expiry: 'hourglass_bottom' };
  const LEDGER_GROUP = { recharge: 'in', bonus: 'in', cashback: 'in', subscription: 'in', pass: 'in', addon: 'in', loan: 'in', refund: 'in', usage: 'use', expiry: 'use', loan_recovery: 'use', loan_return: 'use', reward: 'rew', referral: 'rew' };
  const srcName = (b) => ({ free_daily: 'Free daily credits', purchase: (C.byId[b.planId] || {}).name || 'Purchase', subscription: ((C.byId[b.planId] || {}).name || 'Plan') + ' (included)', reward: 'Reward', loan: 'AI credit advance', cashback: 'Cashback', trial: 'Trial credits' }[b.source] || 'Credits');

  registerPanel('wallet', {
    title: 'Wallet & Credits', cls: 'zik-mid',
    render() {
      const s = st(), t = now(), bal = E.balance(s, t), ent = E.entitlement(s, t), owed = E.outstandingLoan(s);
      const free = bal.total - bal.paid;
      const quick = [1, 5, 10, 50, 100].map((v) => { const p = C.byId['recharge_' + v]; return `<button class="zik-chip" data-a="quick" data-v="${v}"><b>₹${v}</b><small>+${fmtC((p.credits + p.bonus))}</small></button>`; }).join('');
      const entries = s.ledger.filter((l) => ledgerFilter === 'all' || LEDGER_GROUP[l.type] === ledgerFilter);
      const ledger = entries.slice(0, ledgerMore).map((l) => `<div class="zik-item"><div class="ic">${ic(LEDGER_ICON[l.type] || 'receipt')}</div>
        <div class="meta"><b>${esc(l.note || l.type)}</b><small>${fmtDateTime(l.ts)}</small></div>
        <div class="amt ${l.credits >= 0 ? 'pos' : 'neg'}">${l.credits >= 0 ? '+' : '−'}${fmtC(Math.abs(l.credits))}</div></div>`).join('');
      const buckets = bal.buckets.map((b) => `<div class="zik-item"><div class="ic">${ic(b.source === 'free_daily' ? 'wb_sunny' : 'inventory_2')}</div>
        <div class="meta"><b>${esc(srcName(b))}</b><small>${b.expiresAt ? 'Expires ' + fmtDate(b.expiresAt) + ' · ' + until(b.expiresAt) : 'Never expires'}</small></div>
        <div class="amt">${fmtC(b.remaining)}</div></div>`).join('');
      const loans = C.PHASES[5] === false ? '' : E.loanEligibility(s, { verified: verifiedAccount() }, t).map((x) => `<div class="zik-item"><div class="ic">${ic('volunteer_activism')}</div>
        <div class="meta"><b>${esc(x.loan.name)}${x.loan.credits ? ' · ' + fmtC(x.loan.credits) + ' credits' : ''}</b><small>${esc(x.ok ? x.loan.text : x.reason)}</small></div>
        <button class="btn ${x.ok ? 'btn-primary' : 'btn-ghost'}" style="padding:8px 12px;font-size:.74rem" data-a="loan" data-id="${x.loan.id}" ${x.ok ? '' : 'disabled'}>${x.loan.credits ? 'Get' : 'Contact'}</button></div>`).join('');
      const smartOn = s.settings.smartBalance;
      return `<div class="zik-hero"><small>ZIK Credits</small>
          <div class="big">${fmtC(bal.total)}<span>≈ ${inr(bal.inr)}</span></div>
          <div class="sub">${fmtC(free)} free today · ${fmtC(bal.paid)} in your wallet${bal.expiringSoonCredits ? ' · ' + fmtC(bal.expiringSoonCredits) + ' expiring soon' : ''}</div>
          <div class="acts"><button class="btn solid" data-a="plans">${ic('bolt')} Recharge</button><button class="btn" data-a="plansall">${ic('workspace_premium')} Plans</button><button class="btn" data-a="usage">${ic('monitoring')} Usage</button></div></div>
        <div class="zik-info">Current plan: <b>${esc(currentPlanName(s, t))}</b> · ${esc(modelShort(ent.models))} · Context ${ent.ctx}K · ${C.FILES_LABEL[ent.files] === 'No' ? 'No file upload' : 'Files: ' + C.FILES_LABEL[ent.files]}</div>
        ${owed ? `<div class="zik-warn">You have an AI credit advance of <b>${fmtC(owed)}</b> credits. It is auto-deducted from your next recharge.</div>` : ''}
        <div class="sec"><div class="sec-title">${ic('bolt')} Quick recharge</div>
          <div class="zik-quick">${quick}</div>
          <form class="zik-inline" data-form="custom" style="margin-top:12px"><input class="input" id="zik-w-custom" type="number" inputmode="numeric" min="1" max="100000" placeholder="Custom amount (₹1 – ₹1,00,000)"><button class="btn btn-primary" type="submit">Recharge</button></form>
          <div class="zik-note" style="margin-top:8px">Min ₹1 · wallet max ₹1,00,000 · bonus credits are added automatically.</div></div>
        <div class="sec"><div class="sec-title">${ic('shield')} Protection</div>
          ${rowSwitch('Smart Balance Mode', 'When credits run low: lighter ZIT model, shorter context, no deep research — chat keeps working.', 'smart', smartOn)}
          ${rowSwitch('Low-balance alerts', 'Notify me at 20%, 10% and 5% of my last top-up.', 'lowalert', s.settings.lowAlert)}
          ${rowSwitch('Auto-recharge reminder', s.settings.autoRecharge.on ? 'Below ' + inr(s.settings.autoRecharge.triggerInr) + ' → one-tap ' + inr(s.settings.autoRecharge.amountInr) + ' recharge' : 'Prompt a one-tap recharge when balance is low. Set amounts in Billing Account.', 'autorecharge', s.settings.autoRecharge.on)}</div>
        ${loans ? `<div class="sec"><div class="sec-title">${ic('volunteer_activism')} AI credit advance</div><div class="zik-note" style="margin:-6px 0 10px">Advance of AI credits (not cash). Repaid automatically from your next recharge.</div><div class="zik-list">${loans}</div>
          ${verifiedAccount() || !user() ? '' : `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-a="verify-email">${ic('mark_email_read')} Send verification email</button>`}
          ${!user() ? `<div class="zik-note" style="margin-top:8px">Sign in to unlock credit advances.</div>` : ''}</div>` : ''}
        <div class="sec"><div class="sec-title">${ic('inventory_2')} Credit balances</div><div class="zik-list">${buckets || empty('inventory_2', 'No credits right now.')}</div></div>
        <div class="sec"><div class="sec-title">${ic('receipt_long')} Transactions</div>
          <div class="zik-tabs" style="position:static;padding-top:0">${[['all', 'All'], ['in', 'Recharges'], ['use', 'Usage'], ['rew', 'Rewards']].map(([k, l]) => `<button class="zik-chip ${ledgerFilter === k ? 'active' : ''}" data-a="lf" data-v="${k}">${l}</button>`).join('')}</div>
          <div class="zik-list">${ledger || empty('receipt_long', 'No transactions yet.')}</div>
          ${entries.length > ledgerMore ? `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-a="more">Show more</button>` : ''}</div>`;
    },
    submit(form) {
      if (form.dataset.form !== 'custom') return;
      const v = Math.floor(Number($('#zik-w-custom').value));
      const max = E.maxCustomInr(st(), now());
      if (!v || v < 1) return T('Enter an amount of at least ₹1', 'warning');
      if (v > max) return T('You can add up to ' + inr(max) + ' right now (wallet limit ₹1,00,000).', 'warning');
      quickBuy(v);
    },
    actions: {
      quick(b) { quickBuy(Number(b.dataset.v)); },
      plans() { open('plans', 'recharge'); }, plansall() { open('plans', 'sub'); }, usage() { open('usage'); },
      smart() { S.mutate((s) => { s.settings.smartBalance = !s.settings.smartBalance; }, 'settings'); },
      lowalert() { S.mutate((s) => { s.settings.lowAlert = !s.settings.lowAlert; }, 'settings'); },
      autorecharge() { S.mutate((s) => { s.settings.autoRecharge.on = !s.settings.autoRecharge.on; }, 'settings'); },
      lf(b) { ledgerFilter = b.dataset.v; ledgerMore = 25; render('wallet'); },
      more() { ledgerMore += 25; render('wallet'); },
      loan(b) {
        const r = S.mutate((s) => E.takeLoan(s, b.dataset.id, { verified: verifiedAccount() }, now()), 'loan');
        r.ok ? T('+' + fmtC(r.loan.given) + ' credits advanced. Repaid from your next recharge.', 'success') : T(r.message || 'Not eligible', 'warning');
      },
      async 'verify-email'() {
        try { await sendEmailVerification(getFirebase().auth.currentUser); T('Verification email sent. Open the link, then come back.', 'success'); } catch (e) { T('Could not send verification email', 'error'); }
      }
    }
  });

  /* =====================================================================
     PLANS PANEL
     ===================================================================== */
  let planTab = 'recharge';
  registerPanel('plans', {
    title: 'Plans', cls: 'zik-wide',
    render(arg) {
      if (arg && C.GROUPS.some((g) => g.id === arg)) planTab = arg;
      const s = st(), t = now();
      const groups = C.GROUPS.filter((g) => C.PLANS.some((p) => p.group === g.id && C.PHASES[p.phase] !== false));
      if (!groups.some((g) => g.id === planTab)) planTab = groups[0].id;
      const list = C.PLANS.filter((p) => p.group === planTab && p.kind !== 'custom' && C.PHASES[p.phase] !== false);
      let top = '';
      if (planTab === 'recharge') {
        top = `<div class="sec"><div class="sec-title">${ic('tune')} Custom recharge</div>
          <form class="zik-inline" data-form="custom"><input class="input" id="zik-p-custom" type="number" inputmode="numeric" min="1" max="100000" placeholder="Any amount, ₹1 – ₹1,00,000" value=""><button class="btn btn-primary" type="submit">Recharge</button></form>
          <div id="zik-p-preview" class="zik-note" style="margin-top:8px">Bonus is added automatically — bigger recharge, bigger bonus.</div></div>`;
      } else if (planTab === 'student' && s.student.status !== 'verified') {
        top = `<div class="zik-info">${ic('school')} Student plans need a verified Student ID. ${s.student.status === 'pending' ? '<b>Your verification is under review.</b>' : ''}
          <button class="btn btn-primary" style="margin-top:10px;padding:9px 14px;font-size:.78rem" data-a="student">Verify Student ID</button></div>`;
      } else if (planTab === 'free') {
        top = `<div class="zik-info">Everyone starts on <b>Free Forever</b>. Your 7-day Pro trial ${s.trialUsed ? 'has been used' : 'is available below'}.</div>`;
      } else if (planTab === 'pass') {
        top = `<div class="zik-info">Passes give time-based access with fair-use limits — no credits are spent while a pass covers your request.</div>`;
      } else if (planTab === 'family' || planTab === 'business') {
        top = `<div class="zik-info">${ic('groups')} Shared credit pool for your members. Manage seats in <b>Billing Account</b>.</div>`;
      } else if (planTab === 'api') {
        top = `<div class="zik-info">${ic('terminal')} Developer plans include API keys. Calls are priced ₹0.05 basic · ₹0.50 research · ₹5 deep.</div>`;
      }
      return `<div class="zik-tabs">${groups.map((g) => `<button class="zik-chip ${g.id === planTab ? 'active' : ''}" data-a="tab" data-id="${g.id}">${ic(g.icon)}${g.label}</button>`).join('')}</div>
        ${top}<div class="zik-plans">${list.map(planCard).join('')}</div>
        <div class="zik-note">Pay securely by UPI — credits are added once your payment is confirmed. ${CONFIG.sandbox ? '<span class="zik-test">TEST MODE</span>' : ''} Credits are never shown as tokens — only ZIK Credits (1 credit = ₹0.01).</div>`;
    },
    input(el) {
      if (el.id !== 'zik-p-custom') return;
      const v = Math.floor(Number(el.value)), box = $('#zik-p-preview');
      const c = C.customRecharge(v);
      box.innerHTML = c ? `You get <b>${fmtC(c.credits)}</b> + <b>${fmtC(c.bonus)}</b> bonus = <b>${fmtC(c.credits + c.bonus)}</b> credits · valid ${c.validityDays} days${C.cashbackPct(v) && C.PHASES[5] !== false ? ' · +' + C.cashbackPct(v) + '% cashback' : ''}` : 'Bonus is added automatically — bigger recharge, bigger bonus.';
    },
    submit(form) {
      if (form.dataset.form !== 'custom') return;
      const v = Math.floor(Number($('#zik-p-custom').value));
      const max = E.maxCustomInr(st(), now());
      if (!v || v < 1) return T('Enter an amount of at least ₹1', 'warning');
      if (v > max) return T('You can add up to ' + inr(max) + ' right now (wallet limit ₹1,00,000).', 'warning');
      quickBuy(v);
    },
    actions: {
      tab(b) { planTab = b.dataset.id; render('plans'); },
      buy(b) { open('checkout', { planId: b.dataset.id }); },
      'custom-focus'() { const i = $('#zik-p-custom'); if (i) i.focus(); },
      trial(b) {
        const r = S.mutate((s) => E.startTrial(s, b.dataset.id, now()), 'trial');
        r.ok ? T('Trial started — enjoy Pro for 7 days!', 'success') : T(r.message || 'Not available', 'warning');
      },
      community() { S.mutate((s) => { s.community = !s.community; }, 'settings'); T(st().community ? 'Community Access on — free Tiny model, slow queue' : 'Community Access off', 'info'); },
      student() { open('student'); },
      billing() { open('billing'); },
      contact(b) { open('contact', { planId: b.dataset.id }); }
    }
  });

/* =====================================================================
   CHECKOUT — UPI (QR + deep link, UTR confirmation, admin approval)
   ===================================================================== */
import { doc, onSnapshot } from 'firebase/firestore';
import { apiPost } from './billing-adapter';
import { isValidUtr } from '../upi';

let unsubOrder = null;
function watchOrder(orderId) {
  if (unsubOrder) unsubOrder();
  const fb = getFirebase(); if (!fb) return;
  unsubOrder = onSnapshot(doc(fb.db, 'orders', orderId), (snap) => {
    const d = panels.checkout.arg; if (!d || !d.order || d.order.orderId !== orderId || !snap.exists()) return;
    const o = snap.data();
    if (o.status === 'approved' && d.mode !== 'approved') { d.mode = 'approved'; if (unsubOrder) unsubOrder(); }
    else if (o.status === 'rejected' && d.mode !== 'rejected') { d.mode = 'rejected'; d.reason = o.note || ''; if (unsubOrder) unsubOrder(); }
    else if (o.status === 'pending_verification' && d.mode === 'pay') d.mode = 'pending';
    render('checkout');
  }, () => {});
}

function dryRun(planId, inrAmount) {
  const copy = JSON.parse(JSON.stringify(st()));
  return E.applyPurchase(copy, planId, { orderId: 'dry-' + Math.random(), inr: inrAmount }, now());
}
function leftText(exp) { const s = Math.max(0, Math.floor((exp - now()) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

registerPanel('checkout', {
  title: 'Confirm purchase', sheet: true,
  render(arg) {
    const a = arg || {}, p = C.byId[a.planId]; if (!p) return empty('error', 'Unknown plan');
    const mode = a.mode || 'review';
    const amount = p.kind === 'custom' ? a.inr : p.price;
    const head = `<div class="zik-center"><div class="zik-sheet-ico">${ic(p.group === 'addon' ? 'extension' : p.kind === 'sub' ? 'workspace_premium' : 'bolt')}</div>
      <h3>${esc(p.name)}${p.kind === 'custom' ? ' · ' + inr(amount) : ''}</h3><p>${esc(p.modeText || '')}</p></div>`;

    if (mode === 'approved') {
      return `<div class="zik-center"><div class="zik-sheet-ico" style="background:rgba(16,185,129,.14);color:var(--ok)">${ic('check_circle')}</div>
        <h3>Payment confirmed</h3><p>${esc(p.name)} is now active in your wallet. Thank you for supporting Zikriyon AI!</p></div>
        <button class="btn btn-primary btn-block" data-zclose>Start chatting</button>`;
    }
    if (mode === 'rejected') {
      return `<div class="zik-center"><div class="zik-sheet-ico err">${ic('error')}</div><h3>Payment could not be matched</h3>
        <p>${esc(a.reason || 'We could not find this payment. If money was deducted, contact support with your UTR — it will be refunded or credited.')}</p></div>
        <button class="btn btn-primary btn-block" data-a="restart">Try again</button><button class="btn btn-ghost btn-block" data-a="support">Contact support</button>`;
    }
    if (mode === 'pending') {
      return `${head}<div class="zik-info">${ic('hourglass_top')} <b>UTR received.</b> We are verifying your payment${a.order ? ' (order <b>' + esc(a.order.orderId) + '</b>)' : ''}. Credits are added automatically once it is confirmed — usually within a few minutes. You can close this window.</div>
        <button class="btn btn-ghost btn-block" data-zclose>Close</button>`;
    }
    if (mode === 'pay' || mode === 'submitting') {
      const o = a.order, busy = mode === 'submitting';
      return `${head}
        <div class="sec"><div class="zik-center"><img alt="UPI QR" src="${a.qr || ''}" style="width:200px;height:200px;border-radius:14px;background:#fff;padding:8px"></div>
          <div class="zik-kv" style="margin-top:12px"><span>Pay to</span><b>${esc(o.vpa)}</b><span>Amount</span><b>${inr(o.payAmountInr)}</b><span>Order</span><b>${esc(o.orderId)}</b><span>Expires in</span><b id="zik-exp">${leftText(o.expiresAt)}</b></div>
          <div class="zik-grid2" style="margin-top:12px"><a class="btn btn-primary" style="text-decoration:none" href="${esc(o.upiUri)}">${ic('smartphone')} Open UPI app</a>
          <button class="btn btn-ghost" data-a="copyvpa">${ic('content_copy')} Copy UPI ID</button></div></div>
        <div class="sec"><div class="sec-title">${ic('pin')} After paying</div>
          <div class="zik-note" style="margin:-6px 0 10px">Enter the 12-digit UTR / reference number shown in your UPI app, so we can match your payment.</div>
          <form class="zik-inline" data-form="utr"><input class="input" id="zik-utr" inputmode="numeric" maxlength="12" placeholder="12-digit UTR" autocomplete="off"><button class="btn btn-primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? ic('progress_activity', 'zik-spin') : 'Submit'}</button></form></div>
        <div class="zik-note zik-center">Pay <b>exactly ${inr(o.payAmountInr)}</b> (the few extra paise identify your payment). Credits are added automatically within a minute; the UTR is only a backup.</div>`;
    }
    // review
    const dry = dryRun(p.id, amount), rows = [];
    if (dry.ok) {
      if (dry.granted) rows.push(['Credits', fmtC(dry.granted) + ' ZIK']);
      if (dry.bonus) rows.push(['Bonus', '+' + fmtC(dry.bonus)]);
      if (dry.cashback) rows.push(['Cashback', '+' + fmtC(dry.cashback)]);
      if (dry.recovered) rows.push(['AI loan auto-repaid', '−' + fmtC(dry.recovered)]);
      const v = p.kind === 'custom' ? C.customRecharge(amount) : null, days = v ? v.validityDays : p.validityDays;
      if (p.kind === 'pass') rows.push(['Active', fmtDateTime(dry.startAt) + ' → ' + fmtDateTime(dry.endAt)]);
      else if (p.kind === 'sub' || p.kind === 'addon') rows.push(['Renews', 'every ' + (p.period === 'year' ? 'year' : 'month') + ' · renew manually by UPI']);
      else rows.push(['Valid for', days ? days + ' days' : 'Lifetime']);
    }
    const signedIn = !!user();
    return `${head}
      ${CONFIG.sandbox ? `<div class="zik-warn"><span class="zik-test">TEST MODE</span> No real payment — development only.</div>` : ''}
      ${rows.length ? `<div class="sec"><div class="zik-kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div></div>` : ''}
      ${!dry.ok ? `<div class="zik-warn">${esc(dry.message || 'This purchase is not available right now.')}</div>` : ''}
      ${a.error ? `<div class="zik-warn">${esc(a.error)}</div>` : ''}
      ${signedIn ? '' : `<div class="zik-info">${ic('login')} Sign in first — your purchase is attached to your account so it works on every device.</div>`}
      <button class="btn btn-primary btn-block" data-a="${signedIn ? 'pay' : 'signin'}" ${!dry.ok || mode === 'creating' ? 'disabled' : ''}>
        ${mode === 'creating' ? ic('progress_activity', 'zik-spin') + ' Creating order…' : signedIn ? ic('qr_code_2') + ' Pay ' + inr(amount) + ' via UPI' : ic('login') + ' Sign in to pay'}</button>
      <button class="btn btn-ghost btn-block" data-zclose>Cancel</button>
      <div class="zik-note zik-center">UPI payment to Zikriyon AI. Credits are added after we confirm your payment. Refunds follow the Refund policy in Help &amp; Policies.</div>`;
  },
  after() {
    const d = panels.checkout.arg;
    if (d && d.mode === 'pay' && d.order) {
      clearInterval(panels.checkout._tick);
      panels.checkout._tick = setInterval(() => {
        const el = document.getElementById('zik-exp'); if (!el) return clearInterval(panels.checkout._tick);
        el.textContent = leftText(d.order.expiresAt);
        if (d.order.expiresAt <= now()) { clearInterval(panels.checkout._tick); d.mode = 'review'; d.error = 'This order expired. Start again.'; render('checkout'); }
      }, 1000);
    }
  },
  actions: {
    signin() { bridge.openModal('auth'); },
    async pay() {
      const d = panels.checkout.arg, p = C.byId[d.planId]; if (d.mode === 'creating') return;
      d.mode = 'creating'; d.error = ''; render('checkout');
      try {
        const o = await apiPost('/api/payments/create', { planId: p.id, inr: d.inr });
        const QR = (await import('qrcode')).default;
        d.qr = await QR.toDataURL(o.upiUri, { margin: 1, width: 400, errorCorrectionLevel: 'M' });
        d.order = o; d.mode = 'pay'; watchOrder(o.orderId);
      } catch (e) { d.mode = 'review'; d.error = e.message || 'Could not create the order.'; }
      render('checkout');
    },
    copyvpa() { const o = panels.checkout.arg.order; navigator.clipboard?.writeText(o.vpa).then(() => T('UPI ID copied', 'success')); },
    restart() { const d = panels.checkout.arg; d.mode = 'review'; d.order = null; d.error = ''; render('checkout'); },
    support() { open('contact', {}); }
  },
  async submit(form) {
    if (form.dataset.form !== 'utr') return;
    const d = panels.checkout.arg, utr = ($('#zik-utr').value || '').replace(/\s+/g, '');
    if (!isValidUtr(utr)) return T('UTR must be exactly 12 digits', 'warning');
    d.mode = 'submitting'; render('checkout');
    try { await apiPost('/api/payments/submit', { orderId: d.order.orderId, utr }); d.mode = 'pending'; T('UTR submitted — verifying', 'success'); }
    catch (e) { d.mode = 'pay'; T(e.message || 'Could not submit', 'error'); }
    render('checkout');
  }
});

export { currentPlanName, planActive, showLimit, quickBuy, planCard, verifiedAccount };

/* Welcome gift sheet (first visit) */
registerPanel('welcome', {
  title: 'Welcome', sheet: true,
  render() {
    return `<div class="zik-center"><div class="zik-sheet-ico" style="background:rgba(16,185,129,.14);color:var(--ok)">${ic('redeem')}</div>
      <h3>Welcome gift unlocked 🎉</h3><p><b>7 days of Pro</b> — every ZIT model, deep research, files and 32K context — plus <b>1,000 ZIK Credits</b>. After that you stay on Free Forever with 50 free credits every day.</p></div>
      <button class="btn btn-primary btn-block" data-zclose>Start exploring</button>
      <button class="btn btn-ghost btn-block" data-a="seeplans">See what's included</button>`;
  },
  actions: { seeplans() { open('plans', 'sub'); } }
});
