/**
 * ForeSight transition engine: write-time lifecycle plan + time/evidence-driven
 * aspect transitions (orthogonal aspect × anchor model).
 *
 * Semantics (user decisions 2026-10-04):
 *  - progressive finite window end → perfect (completion settlement; semantic time,
 *    offline catch-up settles with the window end, not sweep time);
 *  - open / interval missing end = ∞ → no mechanical expiry (evidence only);
 *  - prospective: anchor.start → mechanical activation to progressive (which is
 *    evidence-gated, end=∞); interval.end / prediction point.start → verdict due,
 *    no evidence → hold (no aspect change, mark overdue); evidence may fulfill
 *    (→perfect), cancel (soft delete), renew, activate early, or reschedule;
 *  - completion/renewal evidence evolves the matching memory instead of
 *    inserting a redundant copy;
 *  - uncertain (classify-failed fallback) → reclassifiable once evidence arrives.
 * All transitions are policy-driven, deterministic, and audited (memory.*).
 */
import type { Anchor, Aspect, Policy } from '../types.js'
import type { Memory, Store } from '../store.js'
import { progressiveWindow } from './temporal.js'

const MS_PER_DAY = 86_400_000

export interface LifecyclePlan {
  to: 'perfect' | 'verdict' | 'activation' | 'classified'
  at: string | null
  reason: 'window_end' | 'predict_by' | 'activation' | 'reclassify'
}

export interface EvidenceCandidate {
  memory: Memory
  sim: number
}

export interface EvidenceDecision {
  action: 'complete' | 'renew' | 'activate' | 'cancel' | 'reschedule' | 'new'
  targetId?: string
  confidence?: number
  evidenceTimeMs?: number
  anchor?: Anchor
  source: 'llm' | 'rules'
}

export interface EvidenceInput {
  text: string
  aspect: Aspect
  anchor: Anchor
  now: number
  candidates: EvidenceCandidate[]
  policy: Policy
}

export type EvidenceFn = (input: EvidenceInput) => Promise<EvidenceDecision | null> | EvidenceDecision | null

export interface LlmLike {
  call(req: { model: string; system: string; user: string; json?: boolean; maxTokens?: number }): Promise<{
    content?: string
    json?: unknown
  }>
}

function parseMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** Write-time plan: what will this memory become, and when. */
export function lifecyclePlan(policy: Policy, m: Memory): LifecyclePlan | null {
  if (m.aspect === 'progressive') {
    const w = progressiveWindow(policy, m)
    if (w.endMs !== null) {
      return { to: 'perfect', at: new Date(w.endMs).toISOString(), reason: 'window_end' }
    }
    return null
  }
  if (m.aspect === 'prospective') {
    const act = activationTime(m)
    if (act !== null) return { to: 'activation', at: new Date(act).toISOString(), reason: 'activation' }
    const vd = verdictTime(m)
    if (vd !== null) return { to: 'verdict', at: new Date(vd).toISOString(), reason: 'predict_by' }
  }
  return null
}

/** prospective activation time: anchor.start (prediction × point = verdict, not activation). */
export function activationTime(m: Memory): number | null {
  if (m.aspect !== 'prospective') return null
  if (m.modality === 'prediction' && m.anchor.type === 'point') return null
  return parseMs(m.anchor.start)
}

/** prospective verdict/deadline: interval.end, or point.start for predictions; open/none = ∞. */
export function verdictTime(m: Memory): number | null {
  if (m.aspect !== 'prospective') return null
  if (m.anchor.type === 'interval') return parseMs(m.anchor.end)
  if (m.anchor.type === 'point') return parseMs(m.anchor.start)
  return null
}

/** progressive → perfect at the semantic completion time. */
export function completeMemory(
  store: Store,
  m: Memory,
  atMs: number,
  reason: string,
  evidenceText?: string,
): Memory | null {
  if (m.aspect !== 'progressive') return null
  const atIso = new Date(atMs).toISOString()
  const metadata: Record<string, unknown> = {
    ...(m.metadata ?? {}),
    completed_at: atIso,
    completed_from: 'progressive',
    completion_reason: reason,
  }
  if (evidenceText) metadata.completion_evidence = evidenceText
  const updated = store.updateMemory(m.id, {
    aspect: 'perfect',
    anchor: { type: 'point', start: atIso.slice(0, 10) },
    metadata,
  })
  store.emit('memory.transition', m.id, {
    from: 'progressive',
    to: 'perfect',
    at: atIso,
    reason,
    evidence: evidenceText ?? null,
  })
  return updated
}

/** prospective → perfect (fulfilled) at the semantic time. */
export function fulfillProspective(store: Store, m: Memory, atMs: number, evidenceText?: string): Memory | null {
  if (m.aspect !== 'prospective') return null
  const atIso = new Date(atMs).toISOString()
  const metadata: Record<string, unknown> = {
    ...(m.metadata ?? {}),
    completed_at: atIso,
    completed_from: 'prospective',
    completion_reason: 'fulfilled',
  }
  if (evidenceText) metadata.completion_evidence = evidenceText
  const updated = store.updateMemory(m.id, {
    aspect: 'perfect',
    anchor: { type: 'point', start: atIso.slice(0, 10) },
    metadata,
  })
  store.emit('memory.transition', m.id, {
    from: 'prospective',
    to: 'perfect',
    at: atIso,
    reason: 'fulfilled',
    evidence: evidenceText ?? null,
  })
  return updated
}

/**
 * prospective → progressive (activation). Always evidence-gated afterwards:
 * the activated activity gets anchor open(start=at) with end=∞; the original
 * deadline is preserved as metadata.verdict_due for review/verdict.
 */
export function activateProspective(store: Store, m: Memory, atMs: number, evidenceText?: string): Memory | null {
  if (m.aspect !== 'prospective') return null
  const atIso = new Date(atMs).toISOString()
  const dueMs = verdictTime(m)
  const metadata: Record<string, unknown> = {
    ...(m.metadata ?? {}),
    activated_from: 'prospective',
    activated_at: atIso,
  }
  if (dueMs !== null) metadata.verdict_due = new Date(dueMs).toISOString()
  if (evidenceText) metadata.activation_evidence = evidenceText
  delete metadata.overdue_since
  delete metadata.overdue_reason
  const updated = store.updateMemory(m.id, {
    aspect: 'progressive',
    anchor: { type: 'open', start: atIso.slice(0, 10) },
    metadata,
  })
  store.emit('memory.transition', m.id, {
    from: 'prospective',
    to: 'progressive',
    at: atIso,
    reason: 'activation',
    evidence: evidenceText ?? null,
  })
  return updated
}

/** Deadline passed with no evidence: keep the aspect, mark overdue (review trigger). */
export function holdProspective(store: Store, m: Memory, atMs: number, reason = 'deadline_no_evidence'): Memory | null {
  if (m.aspect !== 'prospective') return null
  if (m.metadata?.overdue_since) return null
  const atIso = new Date(atMs).toISOString()
  const updated = store.updateMemory(m.id, {
    metadata: { ...(m.metadata ?? {}), overdue_since: atIso, overdue_reason: reason },
  })
  store.emit('memory.hold', m.id, { at: atIso, reason })
  return updated
}

/** Renewal evidence: extend the window (anchor end or TTL base). No aspect change. */
export function renewMemory(store: Store, policy: Policy, m: Memory, atMs: number, newEndMs?: number): Memory | null {
  if (m.aspect !== 'progressive' && m.aspect !== 'prospective') return null
  const ttlDays = Number(policy.aspects.progressive?.default_ttl_days ?? 7)
  const atIso = new Date(atMs).toISOString()
  let anchor = m.anchor
  if (Number.isFinite(newEndMs)) {
    anchor = {
      ...m.anchor,
      type: 'interval',
      start: m.anchor.start ?? atIso.slice(0, 10),
      end: new Date(newEndMs as number).toISOString().slice(0, 10),
    }
  } else if (m.anchor.type === 'interval' && m.anchor.end) {
    const base = Math.max(parseMs(m.anchor.end) ?? atMs, atMs)
    anchor = { ...m.anchor, end: new Date(base + ttlDays * MS_PER_DAY).toISOString().slice(0, 10) }
  }
  const updated = store.updateMemory(m.id, { anchor, metadata: { ...(m.metadata ?? {}), renewed_at: atMs } })
  store.emit('memory.renew', m.id, { at: atIso, until: anchor.end ?? null })
  return updated
}

/** Refuted/cancelled: soft delete (row retained, recoverable, audited). */
export function cancelMemory(store: Store, m: Memory, atMs: number, evidenceText?: string, reason = 'refuted'): boolean {
  const atIso = new Date(atMs).toISOString()
  const metadata: Record<string, unknown> = { ...(m.metadata ?? {}), cancelled_at: atIso, cancel_reason: reason }
  if (evidenceText) metadata.cancel_evidence = evidenceText
  store.updateMemory(m.id, { metadata })
  const ok = store.softDelete(m.id)
  store.emit('memory.cancel', m.id, { at: atIso, reason, evidence: evidenceText ?? null })
  return ok
}

/** Evidence gives a corrected time: update the anchor, clear overdue. */
export function rescheduleMemory(store: Store, m: Memory, anchor: Anchor, atMs: number, evidenceText?: string): Memory | null {
  const metadata: Record<string, unknown> = { ...(m.metadata ?? {}), rescheduled_at: new Date(atMs).toISOString() }
  delete metadata.overdue_since
  delete metadata.overdue_reason
  if (evidenceText) metadata.reschedule_evidence = evidenceText
  const updated = store.updateMemory(m.id, { anchor, metadata })
  store.emit('memory.reschedule', m.id, { at: new Date(atMs).toISOString(), anchor, evidence: evidenceText ?? null })
  return updated
}

/** uncertain → reclassified aspect once evidence/classification arrives. */
export function promoteUncertain(
  store: Store,
  m: Memory,
  targetAspect: Aspect,
  nowMs: number,
  opts: { anchor?: Anchor; evidenceText?: string } = {},
): Memory | null {
  if (m.aspect !== 'uncertain' || targetAspect === 'uncertain') return null
  const metadata: Record<string, unknown> = {
    ...(m.metadata ?? {}),
    reclassified_to: targetAspect,
    reclassified_at: new Date(nowMs).toISOString(),
  }
  if (opts.evidenceText) metadata.reclassify_evidence = opts.evidenceText
  const updated = store.updateMemory(m.id, {
    aspect: targetAspect,
    anchor: opts.anchor ?? m.anchor,
    metadata,
  })
  store.emit('memory.transition', m.id, {
    from: 'uncertain',
    to: targetAspect,
    at: new Date(nowMs).toISOString(),
    reason: 'reclassify',
    evidence: opts.evidenceText ?? null,
  })
  return updated
}

/**
 * Catch-up sweep: settle all due transitions with semantic timestamps.
 * Called by read paths (query/render) and at startup; idempotent.
 */
export function applyDueTransitions(store: Store, policy: Policy, now: number): string[] {
  if (policy.lifecycle?.enabled === false) return []
  const out: string[] = []

  if ((policy.transitions?.progressive?.on_window_end ?? 'perfect') === 'perfect') {
    for (const m of store.listByAspectStatus('progressive', 'active')) {
      const w = progressiveWindow(policy, m)
      if (w.endMs === null || now <= w.endMs) continue
      if (w.startMs !== null && now < w.startMs) continue
      if (completeMemory(store, m, w.endMs, w.reason ?? 'window_end')) out.push(m.id)
    }
  }

  if ((policy.transitions?.prospective?.on_start ?? 'progressive') === 'progressive') {
    for (const m of store.listByAspectStatus('prospective', 'active')) {
      const act = activationTime(m)
      if (act !== null && now >= act) {
        if (activateProspective(store, m, act)) out.push(m.id)
        continue
      }
      const vd = verdictTime(m)
      if (vd !== null && now >= vd) {
        // auto_resolve_prediction: nudge owns the verdict (B5) — no double handling.
        if (
          (policy.transitions?.prospective?.on_deadline_no_evidence ?? 'hold') === 'hold' &&
          policy.nudge?.auto_resolve_prediction !== true
        ) {
          holdProspective(store, m, vd)
        }
      }
    }
  }

  return out
}

/** Rules fallback for the evidence layer (conservative; LLM is the primary path). */
export function rulesEvidence(input: EvidenceInput): EvidenceDecision | null {
  const { text, aspect, candidates } = input
  if (candidates.length === 0) return null
  const top = candidates[0]
  if (/(取消|不做了|放弃|不打算|不再|终止|cancel|abandon|no longer)/i.test(text)) {
    return { action: 'cancel', targetId: top.memory.id, confidence: top.sim, source: 'rules' }
  }
  if (/(开始|着手|动手|启动|started|began|kicked off)/i.test(text) && top.memory.aspect === 'prospective') {
    return { action: 'activate', targetId: top.memory.id, confidence: top.sim, source: 'rules' }
  }
  if (aspect === 'perfect') {
    const target = candidates.find((c) => c.memory.aspect === 'progressive' || c.memory.aspect === 'prospective')
    if (target) return { action: 'complete', targetId: target.memory.id, confidence: target.sim, source: 'rules' }
  }
  if (aspect === 'progressive') {
    const target = candidates.find((c) => c.memory.aspect === 'progressive')
    // Conservative: only explicit continuation wording renews; otherwise the
    // statement is treated as a new fact (never silently swallowed).
    if (target && /(仍|还|继续|依然|持续|照常|still|continues?|ongoing)/i.test(text)) {
      return { action: 'renew', targetId: target.memory.id, confidence: target.sim, source: 'rules' }
    }
  }
  return null
}

/** LLM-assisted evidence layer with rules fallback (never blocks writes). */
export function buildEvidenceFn(policy: Policy, llm: LlmLike | null): EvidenceFn {
  return async (input) => {
    const fallback = rulesEvidence(input)
    if (!llm || input.candidates.length === 0) return fallback
    try {
      const r = await llm.call({
        model: policy.gate.llm_model,
        system:
          '你是记忆演化判定器。给定一条新陈述与若干既有记忆，判断新陈述对既有记忆的作用：' +
          'complete=该既有事件已完成/实现；renew=该既有活动仍在继续（续期）；activate=该既有计划已开始；' +
          'cancel=该既有计划/预测被取消或证伪；reschedule=新陈述给出了该既有事件的新时间；new=无关新事实。' +
          '只输出 JSON：{"action":"complete"|"renew"|"activate"|"cancel"|"reschedule"|"new","target_id":"<既有记忆 id>"|null,"confidence":0..1,"anchor":{"type":"point"|"interval"|"open","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}|null}。' +
          '不确定一律 new；reschedule 必须给 anchor。',
        user: JSON.stringify({
          statement: input.text,
          aspect: input.aspect,
          candidates: input.candidates.map((c) => ({
            id: c.memory.id,
            aspect: c.memory.aspect,
            content: c.memory.content,
            similarity: Number(c.sim.toFixed(3)),
          })),
        }),
        json: true,
        maxTokens: 1024,
      })
      const j = r.json as { action?: unknown; target_id?: unknown; confidence?: unknown; anchor?: unknown } | null
      const actions = ['complete', 'renew', 'activate', 'cancel', 'reschedule']
      if (
        j &&
        typeof j.action === 'string' &&
        actions.includes(j.action) &&
        typeof j.target_id === 'string' &&
        input.candidates.some((c) => c.memory.id === j.target_id)
      ) {
        const decision: EvidenceDecision = {
          action: j.action as EvidenceDecision['action'],
          targetId: j.target_id,
          confidence: Number(j.confidence ?? 0.5),
          source: 'llm',
        }
        if (j.action === 'reschedule' && j.anchor && typeof (j.anchor as Anchor).type === 'string') {
          decision.anchor = j.anchor as Anchor
        } else if (j.action === 'reschedule') {
          return fallback
        }
        return decision
      }
      return fallback
    } catch {
      return fallback
    }
  }
}
