/* eslint-disable @typescript-eslint/no-explicit-any */
import E from './billing/engine';
import C from './billing/catalog';
import { projectsStore } from './projects-store';
import { walletStore } from './wallet-store';
import { toast } from './ui-bus';

const now = () => Date.now();
const modelLabel = (id: string) => (C.MODELS[id] || {}).label || id;

/** Pre-flight: model/depth/context/rate-limit/credits check for one request. plan.ok === false → show the limit sheet. */
export function planNow(message: string, files: number, pickerModel: string): any {
  const st = walletStore.get();
  const pc = projectsStore.buildContext(message, E.entitlement(st, now()));
  const req = {
    model: C.PICKER_MAP[pickerModel] || null,
    inChars: message.length + pc.prefix.length,
    files,
    chunks: pc.chunks,
  };
  const plan = E.planRequest(st, req, now());
  if (plan.ok) {
    plan.project = pc;
    plan.msgChars = message.length;
  }
  walletStore.commit('plan');
  return plan;
}

/** Friendly toasts for silent downgrades (locked model, clamped depth, smart balance). */
export function noteExtras(plan: any): void {
  (plan.notes || []).forEach((n: any) => {
    if (n.type === 'model_fallback') toast(`${modelLabel(n.from)} is locked on your plan — using ${modelLabel(n.to)}.`, 'warning');
    if (n.type === 'depth_clamped') toast('Research depth lowered to match your plan.', 'info');
    if (n.type === 'smart_balance') toast(`Smart Balance Mode: using ${modelLabel(plan.model)} to save credits.`, 'info');
  });
}

/** Settle a finished (or stopped) request: spend credits, fire low-balance alerts. Returns the cost label for the UI. */
export function settle(plan: any, composed: string, outChars: number, aborted: boolean): string {
  const res = walletStore.mutate(
    (s) => E.charge(s, plan, { inChars: composed.length, outChars, chunks: plan.project ? plan.project.chunks : 0, aborted }, now()),
    'charge',
  );
  (res.alerts || []).forEach((a: number) => {
    const left = a === 20 ? '20%' : a === 10 ? '10%' : '5%';
    walletStore.addNote({
      key: `low:${a}:${walletStore.get().balanceRef}`,
      icon: 'battery_alert',
      type: 'warn',
      title: `Credits running low (${left} left)`,
      text: 'Recharge from ₹1 to avoid interruption.',
      push: true,
    });
    toast(`Credits at ${left} — consider a recharge`, 'warning');
  });
  const cov =
    res.covered && res.covered.passId
      ? `Covered by ${(C.byId[res.covered.planId] || {}).name || 'your pass'}`
      : res.covered && res.covered.community
        ? 'Community access · free'
        : `−${C.fmtCredits(res.credits)} credits`;
  return `${cov} · ${modelLabel(plan.model)}${plan.depth > 0 ? ` · ${C.RESEARCH_LABEL[plan.depth]} research` : ''}`;
}
