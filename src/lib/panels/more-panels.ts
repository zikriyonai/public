// @ts-nocheck
/* Ported from the original zikriyon-panels.js: billing account, usage, rewards, student, contact, notifications, API keys, help, projects. */
import E from '../billing/engine';
import C from '../billing/catalog';
import { walletStore as S } from '../wallet-store';
import { projectsStore as PS, chunkText, readFileText, newProjectId, KB_CAP } from '../projects-store';
import { CONFIG } from '../config';
import { download, copyText, lsGet, lsSet } from '../util';
import { DB } from './compat-db';
import { bridge, registerPanel, panels, open, close, render, esc, ic, fmtC, inr, now, $, $$, val, T, user, fmtDate, fmtDateTime, until, modelLabel, modelShort, rowSwitch, empty } from './framework';
import { apiPost } from './billing-adapter';
import { currentPlanName, planActive, showLimit } from './core-panels';

const CFG = () => CONFIG;
const st = () => S.get();
const U = { render, close, showLimit, planActive, currentPlanName, modelShort, panels };
let refPublished = false;
const toInrCredits = (v) => (v === '' || v == null ? null : Math.round(Number(v) / C.CREDIT_INR));
  function invoiceHtml(pay) {
    const gst = lsGet('zik-gst', {}), plan = C.byId[pay.planId] || {};
    const total = Number(pay.amountInr || 0), base = gst.gstin ? total / 1.18 : total, tax = total - base;
    return `<!doctype html><meta charset="utf-8"><title>Invoice ${esc(pay.orderId)}</title>
<style>body{font:14px system-ui;max-width:680px;margin:40px auto;color:#0f172a}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left}.r{text-align:right}.m{color:#64748b}</style>
<h1>Invoice</h1><p class="m">${esc(CFG().company)}${CFG().gstin ? '<br>GSTIN ' + esc(CFG().gstin) : ''}</p>
<p><b>Invoice for:</b> ${esc(gst.name || (user() && user().email) || 'Customer')}${gst.gstin ? '<br>GSTIN ' + esc(gst.gstin) : ''}${gst.address ? '<br>' + esc(gst.address) : ''}</p>
<p><b>Date:</b> ${fmtDate(pay.ts)}<br><b>Order:</b> ${esc(pay.orderId)}<br><b>Paid via:</b> ${esc(pay.gateway)}</p>
<table><tr><th>Item</th><th class="r">Amount</th></tr><tr><td>${esc(pay.name || plan.name)}</td><td class="r">₹${base.toFixed(2)}</td></tr>
${gst.gstin ? `<tr><td>GST 18% (included)</td><td class="r">₹${tax.toFixed(2)}</td></tr>` : ''}<tr><th>Total</th><th class="r">₹${total.toFixed(2)}</th></tr></table>
<p class="m">Status: ${esc(pay.status)}. Digital credits/services supplied electronically.</p>`;
  }
  registerPanel('billing', {
    title: 'Billing Account', cls: 'zik-wide',
    render() {
      const s = st(), t = now(), sub = s.sub && E.subActive(s.sub, t) ? s.sub : null, sp = sub ? C.byId[sub.planId] : null;
      const set = s.settings, gst = lsGet('zik-gst', {});
      const addons = Object.keys(s.addons).filter((id) => U.planActive(C.byId[id], s, t));
      const opts = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
      const lim = (c) => (c == null ? '' : (c * C.CREDIT_INR).toString());
      const pays = s.payments.slice(0, 20).map((p, i) => `<div class="zik-item"><div class="ic">${ic(p.status === 'refunded' ? 'currency_exchange' : 'receipt')}</div>
        <div class="meta"><b>${esc(p.name)}</b><small>${fmtDate(p.ts)} · ${esc(p.orderId)} · ${esc(p.status)}${p.gateway === 'sandbox' ? ' · TEST' : ''}</small></div>
        <div class="amt">${inr(p.amountInr)}</div><button class="icon-btn" title="Invoice" data-a="invoice" data-i="${i}">${ic('download')}</button></div>`).join('');
      const team = s.team;
      return `<div class="zik-hero"><small>Current plan</small><div class="big" style="font-size:1.6rem">${esc(U.currentPlanName(s, t))}</div>
        <div class="sub">${sub ? (sub.status === 'canceled' ? 'Cancelled — access until ' : 'Renews ') + fmtDate(sub.renewsAt) : 'No active subscription'}${s.loans.some((l) => l.status === 'outstanding') ? ' · AI advance outstanding' : ''}</div>
        <div class="acts"><button class="btn solid" data-a="plans">${ic('workspace_premium')} Change plan</button>
        ${sub ? `<button class="btn" data-a="plans">${ic('autorenew')} Renew / change</button>` : ''}</div></div>
        ${addons.length ? `<div class="sec"><div class="sec-title">${ic('extension')} Active add-ons</div><div class="zik-list">${addons.map((id) => `<div class="zik-item"><div class="ic">${ic(C.byId[id].icon || 'extension')}</div><div class="meta"><b>${esc(C.byId[id].name)}</b><small>Renews ${fmtDate(s.addons[id].renewsAt)}</small></div><button class="btn btn-ghost" style="padding:7px 11px;font-size:.72rem" data-a="plans">Renew</button></div>`).join('')}</div></div>` : ''}
        <div class="sec"><div class="sec-title">${ic('tune')} Spending controls</div>
          <div class="zik-grid3">
            <div class="zik-field"><label class="zik-label">Daily limit (₹)</label><input class="input" data-f="dailyLimit" type="number" min="0" step="1" placeholder="No limit" value="${lim(set.dailyLimit)}"></div>
            <div class="zik-field"><label class="zik-label">Monthly limit (₹)</label><input class="input" data-f="monthlyLimit" type="number" min="0" step="1" placeholder="No limit" value="${lim(set.monthlyLimit)}"></div>
            <div class="zik-field"><label class="zik-label">Per-request limit (₹)</label><input class="input" data-f="perRequestLimit" type="number" min="0" step="0.5" placeholder="No limit" value="${lim(set.perRequestLimit)}"></div></div>
          <div class="zik-grid3" style="margin-top:10px">
            <div class="zik-field"><label class="zik-label">Model preference</label><select class="input" data-f="modelPref">${opts([['auto', 'Auto (picker)'], ...C.ALL_MODELS.map((m) => [m, modelLabel(m)])], set.modelPref)}</select></div>
            <div class="zik-field"><label class="zik-label">Context preference</label><select class="input" data-f="contextPref">${opts([['auto', 'Auto (plan max)'], [2, '2K'], [4, '4K'], [8, '8K'], [16, '16K'], [32, '32K']], set.contextPref)}</select></div>
            <div class="zik-field"><label class="zik-label">Research depth</label><select class="input" data-f="depthPref">${opts(C.RESEARCH_LABEL.map((l, i) => [i, i === 0 ? 'Off (chat only)' : l]), set.depthPref)}</select></div></div>
          <div style="margin-top:6px">${rowSwitch('Low-balance alerts', '', 'lowalert', set.lowAlert)}${rowSwitch('Smart Balance Mode', '', 'smart', set.smartBalance)}${rowSwitch('Auto-recharge reminder', '', 'ar', set.autoRecharge.on)}</div>
          <div class="zik-grid2" style="margin-top:8px">
            <div class="zik-field"><label class="zik-label">When balance below</label><select class="input" data-f="arTrigger">${opts([[10, '₹10'], [50, '₹50'], [100, '₹100'], [500, '₹500']], set.autoRecharge.triggerInr)}</select></div>
            <div class="zik-field"><label class="zik-label">Recharge with</label><select class="input" data-f="arAmount">${opts([[10, '₹10'], [50, '₹50'], [100, '₹100'], [500, '₹500']], set.autoRecharge.amountInr)}</select></div></div>
          <div class="zik-note" style="margin-top:8px">Auto-recharge is a reminder + one-tap UPI payment (UPI Autopay mandates are not used).</div></div>
        <div class="sec"><div class="sec-title">${ic('history')} Payment history</div><div class="zik-list">${pays || empty('receipt_long', 'No payments yet.')}</div>
          <div class="zik-inline" style="margin-top:10px"><button class="btn btn-ghost" style="flex:1" data-a="refund">${ic('currency_exchange')} Request a refund</button></div></div>
        <div class="sec"><div class="sec-title">${ic('apartment')} GST details (business invoices)</div>
          <div class="zik-stack"><input class="input" id="zik-gst-name" placeholder="Business / legal name" value="${esc(gst.name || '')}">
          <input class="input" id="zik-gst-no" placeholder="GSTIN (15 characters)" maxlength="15" value="${esc(gst.gstin || '')}" style="text-transform:uppercase">
          <textarea class="input" id="zik-gst-addr" placeholder="Billing address">${esc(gst.address || '')}</textarea>
          <button class="btn btn-ghost" data-a="gst">${ic('save')} Save GST details</button></div></div>
        ${s.student.status === 'verified' ? '' : `<div class="sec"><div class="sec-title">${ic('school')} Student</div><div class="row"><span class="k">Student verification<span class="zik-row-sub">Unlocks Student plans and the Student AI loan.</span></span><button class="btn btn-ghost" style="padding:8px 14px;font-size:.78rem" data-a="student">${s.student.status === 'pending' ? 'Under review' : 'Verify'}</button></div></div>`}
        ${team ? `<div class="sec"><div class="sec-title">${ic('groups')} Team / family seats</div><div class="zik-note" style="margin:-6px 0 10px">${team.members.length} of ${team.seats} seats used. Invited members join your shared credit pool when they accept (needs the team service from /backend).</div>
          <div class="zik-list">${team.members.map((m, i) => `<div class="zik-item"><div class="ic">${ic('person')}</div><div class="meta"><b>${esc(m.email)}</b><small>${esc(m.status)}</small></div><button class="icon-btn" data-a="rmmember" data-i="${i}">${ic('close')}</button></div>`).join('')}</div>
          <form class="zik-inline" data-form="invite" style="margin-top:10px"><input class="input" id="zik-invite" type="email" placeholder="member@email.com"><button class="btn btn-primary" type="submit">Invite</button></form></div>` : ''}`;
    },
    change(el) {
      const f = el.dataset.f; if (!f) return;
      S.mutate((s) => {
        const v = el.value;
        if (['dailyLimit', 'monthlyLimit', 'perRequestLimit'].includes(f)) s.settings[f] = v === '' || Number(v) <= 0 ? null : toInrCredits(v);
        else if (f === 'modelPref') s.settings.modelPref = v;
        else if (f === 'contextPref') s.settings.contextPref = v === 'auto' ? 'auto' : Number(v);
        else if (f === 'depthPref') s.settings.depthPref = Number(v);
        else if (f === 'arTrigger') s.settings.autoRecharge.triggerInr = Number(v);
        else if (f === 'arAmount') s.settings.autoRecharge.amountInr = Number(v);
      }, 'settings');
      T('Saved', 'success');
    },
    submit(form) {
      if (form.dataset.form !== 'invite') return;
      const email = val('zik-invite'); if (!/^\S+@\S+\.\S+$/.test(email)) return T('Enter a valid email', 'warning');
      S.mutate((s) => { if (s.team.members.length >= s.team.seats) return; s.team.members.push({ email, status: 'invited', ts: now() }); }, 'team');
      const d = DB(), u = user(); if (d && u) d.collection('teamInvites').add({ owner: u.uid, email, planId: st().team.planId, ts: now() }).catch(() => {});
      T('Invitation saved', 'success');
    },
    actions: {
      plans() { open('plans', 'sub'); }, student() { open('student'); },
      lowalert() { S.mutate((s) => { s.settings.lowAlert = !s.settings.lowAlert; }, 'settings'); },
      smart() { S.mutate((s) => { s.settings.smartBalance = !s.settings.smartBalance; }, 'settings'); },
      ar() { S.mutate((s) => { s.settings.autoRecharge.on = !s.settings.autoRecharge.on; }, 'settings'); },
      rmmember(b) { S.mutate((s) => { s.team.members.splice(Number(b.dataset.i), 1); }, 'team'); },
      gst() {
        const g = { name: val('zik-gst-name'), gstin: val('zik-gst-no').toUpperCase(), address: val('zik-gst-addr') };
        if (g.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(g.gstin)) return T('That GSTIN does not look valid', 'warning');
        lsSet('zik-gst', g); T('GST details saved — used on your invoices', 'success');
      },
      invoice(b) { const p = st().payments[Number(b.dataset.i)]; if (!p) return; download('invoice-' + p.orderId + '.html', invoiceHtml(p), 'text/html'); },
      refund() { open('contact', { refund: true }); }
    }
  });

  /* ======================= USAGE & LIMITS ======================= */
  registerPanel('usage', {
    title: 'Usage & Limits', cls: 'zik-mid',
    render() {
      const s = st(), t = now(), u = E.usageStats(s, t), ent = E.entitlement(s, t), RL = C.RATE_LIMITS[ent.prio], day = s.counters.day;
      const max = Math.max(1, ...u.daily.map((d) => d.credits));
      const bars = u.daily.map((d) => `<div class="zik-bar" title="${fmtC(d.credits)} credits · ${d.msgs} requests"><i style="height:${Math.max(3, d.credits / max * 100)}%"></i><small>${new Date(d.ts).toLocaleDateString([], { weekday: 'short' }).slice(0, 2)}</small></div>`).join('');
      const hb = (obj) => { const tot = Object.values(obj).reduce((a, b) => a + b, 0) || 1; return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="zik-hbar"><div class="t"><span>${esc(k)}</span><b>${fmtC(v)}</b></div><div class="bar" style="margin:0"><span style="width:${v / tot * 100}%"></span></div></div>`).join('') || '<div class="zik-note">No usage this month yet.</div>'; };
      const recent = u.recent.map((r) => `<div class="zik-item"><div class="ic">${ic(r.feature === 'research' ? 'travel_explore' : r.feature === 'files' ? 'description' : 'chat_bubble')}</div>
        <div class="meta"><b>${esc(r.model ? modelLabel(r.model) : 'Document')} · ${esc(r.mode)}</b><small>${fmtDateTime(r.ts)}${r.covered ? ' · covered by ' + r.covered : ''}${r.aborted ? ' · stopped' : ''}</small></div><div class="amt neg">${r.credits ? '−' + fmtC(r.credits) : 'free'}</div></div>`).join('');
      const kv = (a, b) => `<span>${a}</span><b>${b}</b>`;
      return `<div class="zik-grid3"><div class="zik-stat"><small>Today</small><b>${fmtC(u.today)}</b><span>credits</span></div><div class="zik-stat"><small>7 days</small><b>${fmtC(u.week)}</b><span>credits</span></div><div class="zik-stat"><small>This month</small><b>${fmtC(u.month)}</b><span>${inr(u.month * C.CREDIT_INR)}</span></div></div>
        <div class="sec"><div class="sec-title">${ic('bar_chart')} Last 7 days</div><div class="zik-bars">${bars}</div></div>
        <div class="zik-grid2"><div class="sec"><div class="sec-title">${ic('memory')} By model</div>${hb(u.byModel)}</div><div class="sec"><div class="sec-title">${ic('category')} By feature</div>${hb(u.byFeature)}</div></div>
        <div class="sec"><div class="sec-title">${ic('speed')} Your plan limits</div><div class="zik-kv">
          ${kv('Models', esc(U.modelShort(ent.models)))}${kv('Context per request', ent.ctx + 'K')}${kv('Max answer length', 'up to ' + ent.maxOut + ' words-ish')}
          ${kv('Requests / minute', RL.perMin)}${kv('Requests today', day.msgs + ' / ' + RL.perDay)}
          ${kv('Research', C.RESEARCH_LABEL[ent.research] + (ent.deepQuota ? ' + ' + ent.deepQuota + ' deep/day (' + day.deep + ' used)' : ''))}
          ${kv('File upload', C.FILES_LABEL[ent.files])}${kv('Queue priority', C.PRIO_LABEL[ent.prio])}${kv('API access', C.API_LABEL[ent.api])}
          ${kv('Spent today', fmtC(day.spent) + ' credits')}</div>
          <div class="zik-note" style="margin-top:10px">Fair-use policy applies. Limits protect everyone's speed; upgrading raises them.</div>
          <button class="btn btn-ghost btn-block" style="margin-top:10px" data-a="plans">${ic('workspace_premium')} Raise my limits</button></div>
        <div class="sec"><div class="sec-title">${ic('history')} Recent requests</div><div class="zik-list">${recent || empty('history', 'Your requests will appear here.')}</div></div>`;
    },
    actions: { plans() { open('plans', 'sub'); } }
  });

  /* ======================= REWARDS ======================= */
  registerPanel('rewards', {
    title: 'Rewards', cls: 'zik-mid',
    render() {
      const s = st(), t = now(), d = E.dailyRewardStatus(s, t), R = C.REWARDS, u = user();
      const code = s.rewards.referral.code || E.referralCode(u ? u.uid : 'guest-' + s.createdAt);
      if (u && DB() && !refPublished) { refPublished = true; DB().collection('referralCodes').doc(code).set({ uid: u.uid, ts: now() }).catch(() => {}); }
      const days = d.table.map((v, i) => { const done = d.claimedToday ? i + 1 <= d.cycleDay : i + 1 < d.cycleDay; return `<div class="zik-day ${done ? 'done' : (!d.claimedToday && i + 1 === d.cycleDay ? 'next' : '')}">D${i + 1}<b>+${v}</b></div>`; }).join('');
      const fest = E.festivalsActive(s, t);
      const ph5 = C.PHASES[5] !== false;
      return `<div class="sec"><div class="sec-title">${ic('redeem')} Daily login reward</div><div class="zik-days">${days}</div>
          <div class="zik-note" style="margin:10px 0">Streak: <b>${d.claimedToday ? d.streak : d.nextStreak - 1} days</b>${d.nextMilestone ? ' · next bonus at ' + d.nextMilestone + ' days (+' + fmtC(R.streak[d.nextMilestone]) + ')' : ''} · 7-day = +100 · 30-day = +500 · 100-day = +2,000</div>
          <button class="btn btn-primary btn-block" data-a="daily" ${d.claimedToday ? 'disabled' : ''}>${d.claimedToday ? 'Claimed today ✓' : 'Claim +' + d.nextAmount + ' credits'}</button></div>
        ${ph5 && fest.length ? `<div class="sec"><div class="sec-title">${ic('celebration')} Festival gift</div>${fest.map((f) => `<div class="zik-item"><div class="ic">${ic('celebration')}</div><div class="meta"><b>${esc(f.name)} · ${fmtC(f.credits)} credits</b><small>Valid ${f.validityDays} days after claiming</small></div><button class="btn btn-primary" style="padding:8px 12px;font-size:.74rem" data-a="fest" data-id="${f.id}">Claim</button></div>`).join('')}</div>` : ''}
        ${ph5 ? `<div class="sec"><div class="sec-title">${ic('group_add')} Refer &amp; earn</div>
          <div class="zik-note" style="margin:-6px 0 10px">You and your friend each get <b>${R.referral.inviter} credits</b>. Up to ${R.referral.maxReferrals} referrals.</div>
          <div class="zik-code">${esc(code)}</div>
          <div class="zik-grid2" style="margin-top:10px"><button class="btn btn-primary" data-a="share">${ic('share')} Share link</button><button class="btn btn-ghost" data-a="copycode">${ic('content_copy')} Copy code</button></div>
          <div class="zik-note" style="margin-top:6px">Referred so far: <b>${s.rewards.referral.count}</b> / ${R.referral.maxReferrals}</div>
          ${s.rewards.referral.redeemed ? '' : `<form class="zik-inline" data-form="redeem" style="margin-top:12px"><input class="input" id="zik-ref-in" placeholder="Have a friend's code?" style="text-transform:uppercase"><button class="btn btn-ghost" type="submit">Redeem</button></form>`}</div>` : ''}
        <div class="sec"><div class="sec-title">${ic('rate_review')} Feedback rewards</div>
          <div class="zik-note" style="margin:-6px 0 10px">Detailed feedback +${R.feedback.detailed} credits (once a day) · accepted bug report +${R.feedback.bugAccepted} · model evaluation tasks +${R.feedback.evalMin}–${R.feedback.evalMax}</div>
          <textarea class="input" id="zik-fb" placeholder="Tell us what worked, what didn't, what you'd love next… (min ${R.feedback.detailedMinChars} characters)"></textarea>
          <div class="zik-grid2" style="margin-top:10px"><button class="btn btn-primary" data-a="fb">${ic('send')} Send feedback</button><button class="btn btn-ghost" data-a="bug">${ic('bug_report')} Report a bug</button></div></div>
        ${ph5 ? `<div class="sec"><div class="sec-title">${ic('savings')} Cashback wallet</div><div class="zik-kv">${R.cashback.slice().reverse().map((c) => `<span>₹${c.minInr.toLocaleString('en-IN')} recharge</span><b>${c.pct}% back in credits</b>`).join('')}</div></div>` : ''}`;
    },
    submit(form) {
      if (form.dataset.form !== 'redeem') return;
      const code = val('zik-ref-in').toUpperCase(); if (!code) return;
      const u = user(); if (!u) return T('Sign in to redeem a referral code', 'warning');
      if (code === (st().rewards.referral.code || E.referralCode(u.uid))) return T("That's your own code 🙂", 'warning');
      apiPost('/api/referral', { code }).then(() => T('Code accepted — your bonus is being added!', 'success')).catch((e) => T(e.message || 'Could not redeem the code', 'error'));
    },
    actions: {
      daily() { const r = S.mutate((s) => E.claimDaily(s, now()), 'reward'); r.ok ? T('+' + (r.amount + r.streakBonus) + ' credits' + (r.streakBonus ? ' (streak bonus!)' : ''), 'success') : T(r.message, 'warning'); },
      fest(b) { const r = S.mutate((s) => E.claimFestival(s, b.dataset.id, now()), 'reward'); r.ok ? T('+' + fmtC(r.credits) + ' credits', 'success') : T(r.message, 'warning'); },
      copycode() { const c = $('#zik-rewards .zik-code').textContent; copyText(c).then(() => T('Code copied', 'success')); },
      async share() {
        const c = $('#zik-rewards .zik-code').textContent, url = location.origin + '/?ref=' + c, text = 'Join me on Zikriyon AI — use my code ' + c + ' and we both get 100 free credits!';
        if (navigator.share) { try { await navigator.share({ title: 'Zikriyon AI', text, url }); } catch (e) {} } else { copyText(text + ' ' + url).then(() => T('Invite link copied', 'success')); }
      },
      fb() {
        const r = S.mutate((s) => E.submitFeedback(s, val('zik-fb'), now()), 'reward');
        if (!r.ok) return T(r.message, 'warning');
        const d = DB(); if (d) d.collection('feedback').add({ uid: (user() || {}).uid || null, text: val('zik-fb'), ts: now(), type: 'feedback' }).catch(() => {});
        $('#zik-fb').value = ''; T(r.credits ? '+' + r.credits + ' credits — thank you!' : r.message, 'success');
      },
      bug() { open('contact', { bug: true }); }
    }
  });

  /* ======================= STUDENT VERIFICATION ======================= */
  function shrink(file, max = 900) {
    return new Promise((res, rej) => {
      const r = new FileReader(); r.onerror = rej;
      r.onload = () => { const img = new Image(); img.onerror = rej; img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7)); }; img.src = r.result; };
      r.readAsDataURL(file);
    });
  }
  registerPanel('student', {
    title: 'Student verification', sheet: true,
    render() {
      const s = st();
      if (s.student.status === 'verified') return `<div class="zik-center"><div class="zik-sheet-ico" style="background:rgba(16,185,129,.14);color:var(--ok)">${ic('verified')}</div><h3>You're verified</h3><p>Student plans, 100 free credits a day and the Student loan are unlocked.</p></div><button class="btn btn-ghost btn-block" data-zclose>Close</button>`;
      if (!user()) return `<div class="zik-center"><div class="zik-sheet-ico">${ic('login')}</div><h3>Sign in first</h3><p>We attach verification to your account so it works on every device.</p></div><button class="btn btn-ghost btn-block" data-zclose>OK</button>`;
      if (s.student.status === 'pending') return `<div class="zik-center"><div class="zik-sheet-ico warn">${ic('hourglass_top')}</div><h3>Under review</h3><p>We usually verify within 1–2 working days. You'll get a notification.</p></div><button class="btn btn-ghost btn-block" data-zclose>OK</button>`;
      return `<div class="zik-center"><div class="zik-sheet-ico">${ic('school')}</div><h3>Verify your Student ID</h3><p>Upload a clear photo of your college ID. It's only used for verification.</p></div>
        <form class="zik-stack" data-form="student"><input class="input" id="zik-st-college" placeholder="College / school name" required><input class="input" id="zik-st-id" placeholder="Student ID number" required>
        <input class="input" id="zik-st-file" type="file" accept="image/*" required><button class="btn btn-primary btn-block" type="submit">${ic('upload')} Submit for review</button></form>`;
    },
    async submit() {
      const d = DB(), u = user(), f = $('#zik-st-file').files[0]; if (!d || !u || !f) return;
      try {
        const img = await shrink(f);
        await d.collection('studentVerifications').doc(u.uid).set({ uid: u.uid, email: u.email || null, college: val('zik-st-college'), studentId: val('zik-st-id'), image: img, status: 'pending', ts: now() });
        S.mutate((s) => { s.student.status = 'pending'; }, 'student'); T('Submitted for review', 'success'); U.render('student');
      } catch (e) { T('Could not submit — try a smaller photo', 'error'); }
    }
  });















  /* ======================= CONTACT / REFUND / BUG ======================= */
  registerPanel('contact', {
    title: 'Contact', sheet: true,
    render(arg) {
      const a = arg || {}, p = a.planId ? C.byId[a.planId] : null;
      const title = a.refund ? 'Request a refund' : a.bug ? 'Report a bug' : p ? 'Contact sales · ' + p.name : 'Contact us';
      const u = user();
      return `<div class="zik-center"><h3>${esc(title)}</h3><p>${a.refund ? 'Tell us the order and what went wrong. Include your UTR / order id so we can find the payment.' : a.bug ? 'Accepted bug reports earn +100 credits.' : 'Our team replies within one working day.'}</p></div>
        <form class="zik-stack" data-form="contact"><input class="input" id="zik-c-name" placeholder="Your name" value="${esc((u && u.displayName) || '')}" required>
        <input class="input" id="zik-c-email" type="email" placeholder="Email" value="${esc((u && u.email) || '')}" required>
        ${a.refund ? `<select class="input" id="zik-c-order">${st().payments.map((x) => `<option value="${esc(x.orderId)}">${esc(x.name)} · ${inr(x.amountInr)} · ${fmtDate(x.ts)}</option>`).join('') || '<option value="">No orders</option>'}</select>` : ''}
        ${p ? `<input class="input" id="zik-c-org" placeholder="Company / institution">` : ''}
        <textarea class="input" id="zik-c-msg" placeholder="Message" required></textarea><button class="btn btn-primary btn-block" type="submit">${ic('send')} Send</button></form>`;
    },
    async submit() {
      const a = U.panels.contact.arg || {};
      const rec = { type: a.refund ? 'refund' : a.bug ? 'bug' : a.planId ? 'sales' : 'contact', planId: a.planId || null, name: val('zik-c-name'), email: val('zik-c-email'), org: val('zik-c-org'), orderId: val('zik-c-order') || null, message: val('zik-c-msg'), uid: (user() || {}).uid || null, ts: now() };
      const d = DB();
      try { if (!d) throw new Error('offline'); await d.collection('leads').add(rec); T('Sent — we will get back to you soon', 'success'); U.close('contact'); }
      catch (e) { const to = rec.type === 'sales' ? CFG().salesEmail : CFG().supportEmail; location.href = 'mailto:' + to + '?subject=' + encodeURIComponent('[' + rec.type + '] Zikriyon AI') + '&body=' + encodeURIComponent(rec.message + '\n\n' + rec.name + ' · ' + rec.email + (rec.orderId ? '\nOrder: ' + rec.orderId : '')); }
    }
  });

  /* ======================= NOTIFICATION CENTRE ======================= */
  registerPanel('notifs', {
    title: 'Notifications', cls: 'zik-mid',
    render() {
      const list = S.notes;
      S.markAllRead();
      return `${list.length ? `<div class="zik-list">${list.map((n) => `<div class="zik-item"><div class="ic">${ic(n.icon)}</div><div class="meta"><b>${esc(n.title)}</b><small style="white-space:normal">${esc(n.text)} · ${fmtDateTime(n.ts)}</small></div></div>`).join('')}</div>
        <button class="btn btn-ghost btn-block" data-a="clear">${ic('delete_sweep')} Clear all</button>` : empty('notifications_off', 'Nothing yet. Offers, low-balance and expiry alerts show up here.')}`;
    },
    actions: { clear() { S.clearNotes(); U.render('notifs'); } }
  });

  /* ======================= API KEYS ======================= */
  registerPanel('apikeys', {
    title: 'API Keys', cls: 'zik-mid',
    render(arg) {
      const ent = E.entitlement(st(), now()), keys = (arg && arg.keys) || [];
      if (ent.api === 0) return `<div class="zik-center"><div class="zik-sheet-ico">${ic('key')}</div><h3>API access</h3><p>Developer plans include API keys. Start free (100 calls/day) or upgrade.</p></div><button class="btn btn-primary btn-block" data-a="plans">${ic('terminal')} See Developer plans</button>`;
      const rl = ent.api === 2 ? 'High rate limit' : 'Standard rate limit';
      return `<div class="zik-info">Plan access: <b>${C.API_LABEL[ent.api]}</b> · ${rl}. Per call: ₹0.05 basic · ₹0.50 research · ₹5 deep. Keys are shown <b>once</b> when created.</div>
        ${CFG().apiKeyEndpoint ? '' : `<div class="zik-warn">API keys need the backend (<code>/backend</code> → <b>apiKeys</b> function). Set <code>apiKeyEndpoint</code> in zikriyon-config.js after deploying.</div>`}
        <div class="zik-inline"><input class="input" id="zik-key-name" placeholder="Key name (e.g. my-app)"><button class="btn btn-primary" data-a="create">${ic('add')} Create</button></div>
        <div id="zik-key-new"></div>
        <div class="zik-list">${keys.map((k) => `<div class="zik-item"><div class="ic">${ic('key')}</div><div class="meta"><b>${esc(k.name)} · ${esc(k.prefix)}…</b><small>${k.revoked ? 'Revoked' : 'Created ' + fmtDate(k.ts) + ' · ' + (k.calls || 0) + ' calls'}</small></div>${k.revoked ? '' : `<button class="btn btn-danger" style="padding:7px 11px;font-size:.72rem" data-a="revoke" data-id="${esc(k.id)}">Revoke</button>`}</div>`).join('') || empty('key', 'No keys yet.')}</div>
        <a class="btn btn-ghost btn-block" style="text-decoration:none" href="${esc((CFG().functionsBase || '') + '/docs')}" target="_blank" rel="noopener">${ic('menu_book')} API documentation</a>`;
    },
    after() { if (!U.panels.apikeys._loading) loadKeys(); },
    actions: {
      plans() { open('plans', 'api'); },
      async create() {
        const u = user(); if (!u) return T('Sign in to create API keys', 'warning');
        if (!CFG().apiKeyEndpoint) return T('Backend not configured yet', 'warning');
        try {
          const r = await fetch(CFG().apiKeyEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ action: 'create', name: val('zik-key-name') || 'key' }) });
          const j = await r.json(); if (!r.ok) throw new Error(j.message || 'Failed');
          $('#zik-key-new').innerHTML = `<div class="zik-ok">Copy your key now — it won't be shown again.<div class="zik-code" style="margin-top:8px">${esc(j.key)}</div></div>`; loadKeys(true);
        } catch (e) { T(e.message, 'error'); }
      },
      async revoke(b) {
        const u = user(); if (!u || !CFG().apiKeyEndpoint) return;
        try { await fetch(CFG().apiKeyEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ action: 'revoke', id: b.dataset.id }) }); T('Key revoked', 'success'); loadKeys(); } catch (e) { T('Failed', 'error'); }
      }
    }
  });
  async function loadKeys(keepNew) {
    const d = DB(), u = user(); if (!d || !u) return;
    try {
      const snap = await d.collection('users').doc(u.uid).collection('apiKeys').orderBy('ts', 'desc').get();
      const keys = []; snap.forEach((x) => keys.push(Object.assign({ id: x.id }, x.data())));
      const p = U.panels.apikeys, html = keepNew ? ($('#zik-key-new') || {}).innerHTML : '';
      p._loading = true; p.arg = { keys }; U.render('apikeys'); p._loading = false;
      if (keepNew && html) $('#zik-key-new').innerHTML = html;
    } catch (e) { /* keys collection not readable yet */ }
  }

  /* ======================= HELP & POLICIES ======================= */
  registerPanel('help', {
    title: 'Help & Policies', cls: 'zik-mid',
    render() {
      const faq = [
        ['What is a ZIK Credit?', '1 ZIK Credit = ₹0.01. You never deal with tokens — recharge, chat, and we give you the best access for your balance.'],
        ['How much does a message cost?', 'Fast chat ₹0.05–0.20, normal chat ₹0.20–0.50, research chat ₹0.50–2. Research tasks: basic ₹0.50, normal ₹1–3, deep ₹5–10, maximum ₹10–25. The exact cost shows under every answer.'],
        ['Do credits expire?', 'Yes, per pack (7 days to 365 days). The No-Expiry pack and Lifetime Supporter credits never expire. Spending uses the soonest-expiring credits first.'],
        ['What is Smart Balance Mode?', 'When your balance is low, we switch to a lighter model, shorter context and no deep research so basic chat keeps working. You can turn it off in Wallet.'],
        ['What is an AI credit advance?', 'A small advance of AI credits (not cash). It is repaid automatically from your next recharge — unused advance credits are simply returned.']
      ];
      return `<div class="sec"><div class="sec-title">${ic('quiz')} How it works</div>${faq.map(([q, a]) => `<details style="padding:9px 0;border-bottom:1px solid var(--border)"><summary style="cursor:pointer;font-weight:700;font-size:.84rem">${esc(q)}</summary><p class="zik-prose" style="margin-top:6px">${esc(a)}</p></details>`).join('')}</div>
        <div class="sec zik-prose"><div class="sec-title">${ic('gavel')} Policies</div>
          <h4>Refund policy</h4><p>UPI payments can be refunded to the paying account on request within 7 days if the credits are unused, and as required by law. Unused credits of a refunded order are removed from your wallet. Credits already spent are not refundable. Write to us from Billing → Request a refund.</p>
          <h4>Fair-use policy</h4><p>Passes and "unlimited" basic chat are for personal use. We apply per-minute and per-day limits to keep Zikriyon AI fast for everyone, and may slow or pause accounts that automate or abuse the service.</p>
          <h4>AI credit advance terms</h4><p>Advances are AI credits, not money. They are recovered automatically from your next recharge. Limits: Emergency 1 per 7 days · Small 2 per month · Student 1 per month. We may refuse advances to protect against abuse.</p>
          <h4>Privacy</h4><p>Chats are stored on your device and, when you sign in, in your private cloud space. Payments are made through your own UPI app — we only see the amount, UTR and order id you submit.</p></div>
        <div class="sec"><div class="sec-title">${ic('support_agent')} Contact</div><div class="zik-stack">
          <button class="btn btn-primary" data-a="contact">${ic('mail')} Contact support</button>
          <div class="zik-note">${esc(CFG().company)} · Founder ${esc(CFG().founder)} · ${esc(CFG().supportEmail)}</div></div></div>
        <div class="sec"><div class="sec-title">${ic('database')} Your data</div><div class="zik-stack">
          <button class="btn btn-ghost" data-a="export">${ic('ios_share')} Export all my data (JSON)</button></div></div>`;
    },
    actions: {
      contact() { open('contact', {}); },
      export() {
        const ent = E.entitlement(st(), now());
        if (C.ENFORCE.dataExport && !ent.dataExport) return open('limit', { code: 'files_locked', message: 'Exporting all chats & reports is part of the Data Export add-on (₹99/month). You can still export a single chat from the chat menu.' });
        const chats = lsGet('zikriyonLocalHistory', []);
        download('zikriyon-export-' + E.dayKey(now()) + '.json', JSON.stringify({ exportedAt: now(), wallet: st(), chats }, null, 2), 'application/json');
      }
    }
  });

/* ======================= PROJECTS (data lives in projectsStore) ======================= */
const EMOJI = ['📁', '🚀', '📚', '💡', '🧪', '💼', '🎨', '🛠️', '📈', '🌍'];
let editing = null, view = 'list';
const pdata = () => PS.data;
function grab() {
  if (!editing) return;
  const g = (id) => { const e = document.getElementById(id); return e ? e.value : null; };
  const n = g('zik-pr-name'); if (n != null) editing.name = n.trim();
  const d = g('zik-pr-desc'); if (d != null) editing.description = d.trim();
  const i = g('zik-pr-ins'); if (i != null) editing.instructions = i.trim();
  const m = g('zik-pr-model'); if (m != null) editing.model = m;
}
registerPanel('projects', {
  title: 'Projects', cls: 'zik-mid',
  render() {
    const s = st(), ent = E.entitlement(s, now()), P = pdata(), proj = (id) => PS.proj(id);
    if (view === 'edit' && editing) {
      const p = editing, isNew = !proj(p.id), files = (p.files || []).map((f, i) => `<div class="zik-item"><div class="ic">${ic('description')}</div><div class="meta"><b>${esc(f.name)}</b><small>${fmtC(f.chars)} characters · ${f.chunks.length} sections</small></div><button class="icon-btn" data-a="rmfile" data-i="${i}">${ic('delete')}</button></div>`).join('');
      const chats = Object.keys(P.chats).filter((k) => P.chats[k] === p.id);
      return `<button class="btn btn-ghost" style="align-self:flex-start;padding:8px 12px;font-size:.78rem" data-a="back">${ic('arrow_back')} All projects</button>
        <div class="zik-field"><label class="zik-label">Icon</label><div class="zik-emoji">${EMOJI.map((e) => `<button type="button" class="${p.emoji === e ? 'on' : ''}" data-a="emoji" data-v="${e}">${e}</button>`).join('')}</div></div>
        <div class="zik-field"><label class="zik-label">Name</label><input class="input" id="zik-pr-name" value="${esc(p.name)}" maxlength="60" placeholder="e.g. Thesis helper"></div>
        <div class="zik-field"><label class="zik-label">Description</label><input class="input" id="zik-pr-desc" value="${esc(p.description || '')}" maxlength="140" placeholder="What is this project for?"></div>
        <div class="zik-field"><label class="zik-label">Custom instructions (apply to every chat in this project)</label><textarea class="input" id="zik-pr-ins" maxlength="2000" placeholder="e.g. Answer in Hinglish. Keep answers short. Cite the file name.">${esc(p.instructions || '')}</textarea></div>
        <div class="zik-field"><label class="zik-label">Default model</label><select class="input" id="zik-pr-model"><option value="">Use my picker</option>${C.ALL_MODELS.map((m) => `<option value="${m}" ${p.model === m ? 'selected' : ''}>${modelLabel(m)}</option>`).join('')}</select></div>
        <div class="sec"><div class="sec-title">${ic('folder_open')} Knowledge files</div>
          ${ent.files === 0 ? `<div class="zik-warn">Knowledge files need a plan with file support. Instructions still work on every plan.</div>` : `<div class="zik-note" style="margin:-6px 0 10px">PDF, DOCX, CSV, TXT, MD, JSON. We search your files and send only the relevant parts with each question.${ent.files === 1 ? ' Limited plan: ' + C.LIMITED_FILES_PER_DAY + ' free documents a day.' : ''}</div>`}
          <div class="zik-list">${files || ''}</div>
          ${ent.files > 0 ? `<input id="zik-pr-file" type="file" accept=".pdf,.docx,.txt,.md,.csv,.json" hidden multiple><button class="btn btn-ghost btn-block" style="margin-top:10px" data-a="addfile">${ic('upload_file')} Add files</button>` : ''}</div>
        ${chats.length ? `<div class="sec"><div class="sec-title">${ic('forum')} Chats in this project (${chats.length})</div><div class="zik-list" id="zik-pr-chats"></div></div>` : ''}
        <div class="zik-grid2"><button class="btn btn-primary" data-a="save">${ic('check')} ${isNew ? 'Create project' : 'Save'}</button>${isNew ? '<span></span>' : `<button class="btn btn-ghost" data-a="newchat">${ic('add_comment')} New chat here</button>`}</div>
        ${isNew ? '' : `<div class="zik-grid2"><button class="btn btn-ghost" data-a="archive">${ic(p.archived ? 'unarchive' : 'archive')} ${p.archived ? 'Unarchive' : 'Archive'}</button><button class="btn btn-danger" data-a="delete">${ic('delete')} Delete</button></div>`}`;
    }
    const list = P.projects.filter((p) => !p.archived), arch = P.projects.filter((p) => p.archived);
    const card = (p) => `<div class="zik-proj" data-a="edit" data-id="${p.id}"><div class="em">${esc(p.emoji)}</div><div style="flex:1;min-width:0"><b>${esc(p.name)}${P.active === p.id ? ' · <span style="color:var(--ok)">active</span>' : ''}</b><small>${esc(p.description || 'No description')}</small><small>${(p.files || []).length} files · ${Object.values(P.chats).filter((x) => x === p.id).length} chats</small></div>
      <button class="btn ${P.active === p.id ? 'btn-ghost' : 'btn-primary'}" style="padding:8px 12px;font-size:.74rem" data-a="use" data-id="${p.id}">${P.active === p.id ? 'Leave' : 'Chat'}</button></div>`;
    return `<button class="btn btn-primary btn-block" data-a="new">${ic('create_new_folder')} New project</button>
      <div class="zik-list">${list.map(card).join('') || empty('folder_special', 'Projects keep instructions, files and chats together.<br>Create one to get started.')}</div>
      ${arch.length ? `<div class="zik-h">Archived</div><div class="zik-list">${arch.map(card).join('')}</div>` : ''}`;
  },
  after(body) {
    const box = $('#zik-pr-chats', body); if (!box || !editing) return;
    const P = pdata(), ids = Object.keys(P.chats).filter((k) => P.chats[k] === editing.id), local = lsGet('zikriyonLocalHistory', []);
    box.innerHTML = ids.map((id) => { const c = local.find((x) => x.id === id); return `<div class="zik-item click" data-a="openchat" data-id="${esc(id)}"><div class="ic">${ic('chat_bubble')}</div><div class="meta"><b>${esc(c ? c.title : id)}</b><small>${c ? fmtDateTime(c.timestamp) : 'Saved in cloud history'}</small></div></div>`; }).join('');
  },
  actions: {
    new() { editing = { id: newProjectId(), name: '', emoji: '📁', description: '', instructions: '', model: '', files: [], pinned: [] }; view = 'edit'; render('projects'); },
    edit(b, e) { if (e.target.closest('[data-a="use"]')) return; editing = JSON.parse(JSON.stringify(PS.proj(b.dataset.id))); view = 'edit'; render('projects'); },
    back() { view = 'list'; editing = null; render('projects'); },
    emoji(b) { grab(); editing.emoji = b.dataset.v; render('projects'); },
    use(b, e) {
      e.stopPropagation(); const id = b.dataset.id;
      if (pdata().active === id) { PS.setActive(null); return render('projects'); }
      PS.setActive(id); bridge.resetChat();
      const p = PS.proj(id);
      if (p && p.model) { const key = Object.keys(C.PICKER_MAP).find((k) => C.PICKER_MAP[k] === p.model); if (key) bridge.setModel(key); }
      close('projects'); T('Project “' + (p ? p.name : '') + '” is active', 'success');
    },
    save() {
      grab(); if (!editing.name) return T('Give your project a name', 'warning');
      PS.upsert(editing); T('Saved', 'success'); view = 'list'; editing = null; render('projects');
    },
    newchat() { grab(); if (PS.proj(editing.id)) { PS.upsert(editing); PS.setActive(editing.id); } bridge.resetChat(); close('projects'); },
    archive() { editing.archived = !editing.archived; PS.upsert(editing); if (editing.archived && pdata().active === editing.id) PS.setActive(null); view = 'list'; editing = null; render('projects'); },
    delete() {
      if (!confirm('Delete this project and its files? Chats are kept.')) return;
      PS.remove(editing.id); view = 'list'; editing = null; render('projects');
    },
    rmfile(b) { grab(); editing.files.splice(Number(b.dataset.i), 1); render('projects'); },
    addfile() {
      const inp = $('#zik-pr-file'); inp.onchange = async () => {
        grab();
        for (const f of Array.from(inp.files)) {
          if (f.size > 8 * 1024 * 1024) { T(f.name + ' is larger than 8 MB', 'warning'); continue; }
          try {
            const text = (await readFileText(f)).replace(/\s+\n/g, '\n').trim(); if (!text) { T(f.name + ' has no readable text', 'warning'); continue; }
            const chunks = chunkText(text), add = chunks.reduce((n, c) => n + c.length, 0);
            if (PS.kbSize() + add > KB_CAP) { T('Not enough local space for ' + f.name + ' (limit ~1.5 MB of text)', 'warning'); continue; }
            const r = S.mutate((s) => E.chargeDocument(s, text.length, now()), 'doc');
            if (!r.ok) { showLimit(r); break; }
            editing.files.push({ name: f.name, chars: text.length, chunks });
            T(f.name + ' added' + (r.credits ? ' · −' + fmtC(r.credits) + ' credits' : ' · free'), 'success');
          } catch (e) { T(e.message || 'Could not read ' + f.name, 'error'); }
        }
        render('projects');
      }; inp.click();
    },
    openchat(b) { const c = lsGet('zikriyonLocalHistory', []).find((x) => x.id === b.dataset.id); if (c) { close('projects'); bridge.loadSession(c); } else T('Open it from Chat History', 'info'); }
  }
});
