/**
 * ForeSight governance layer: permission model (design §3).
 *
 * | Role  | Writable objects                                             | Writer              |
 * | Root  | SOUL.md, IMPORTANT.md, policy.yaml, all memory fields, links | user / system pipe  |
 * | Agent | memories (gated), links (gated)                              | running agent       |
 *
 * - SOUL.md has no write path in the codebase once written (no function writes it).
 * - IMPORTANT.md is written exclusively via the deriver's important route.
 * - Permission violations → decline + audit (events table, type=permission.deny).
 */
import type { Policy } from '../policy.js'

export type WriteTarget = string

export function canWrite(actor: string, target: WriteTarget, policy: Policy): boolean {
  if (policy.permission.root_writers.includes(actor)) return true
  if (target === 'important_doc' && actor === policy.permission.important_doc_writer) return true
  if (target === 'links') return true // links are gated but agent-writable
  return policy.permission.agent_writable.includes(target)
}

/** Beta adjustments: only beta_settable_by (Root tool / direct policy edit). */
export function canSetBeta(actor: string, policy: Policy): boolean {
  return policy.permission.beta_settable_by.includes(actor)
}
