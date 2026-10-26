/**
 * ForeSight policy loader — reads memoryRoot/policy.yaml, validates version,
 * exports behavior lookup helpers. Single source of truth for tunables.
 *
 * v3 policies are mapped to v4 in memory (see `migrateV3`) so an existing data
 * directory keeps booting after the rename `user_doc_writer` →
 * `important_doc_writer` and the addition of `uncertain` / `transitions`.
 * The file on disk is never rewritten; `scripts/migrate-policy.mjs` does that
 * explicitly with a backup.
 */
import * as yaml from 'js-yaml'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Aspect, AspectBehavior, Policy } from './types.js'
import { POLICY_VERSION } from './defaults.js'

// Re-export domain types so consumers can `import type { Policy } from '@foresight/memory/policy'`
export type { Aspect, AspectBehavior, Anchor, DeriveRoute, MemoryStatus, MemorySource, Policy } from './types.js'

const TEMPLATE_URL = new URL('../templates/policy.yaml.example', import.meta.url)
let templateCache: Policy | null = null

function loadTemplate(): Policy {
  if (templateCache) return templateCache
  const raw = yaml.load(fs.readFileSync(TEMPLATE_URL, 'utf8')) as { foresight?: Policy } | undefined
  if (!raw?.foresight) {
    throw new Error(`invalid policy template at ${TEMPLATE_URL.pathname} (missing foresight root)`)
  }
  templateCache = raw.foresight
  return templateCache
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep merge: user values win; missing v4 keys come from the shipped template. */
function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (Array.isArray(base)) return Array.isArray(override) ? override : base
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in out ? deepMerge(out[key], value) : value
    }
    return out
  }
  return override
}

/**
 * In-memory v3 → v4 mapping. Preserves the user's old values (including the
 * old gnomic doc/always semantics) while filling the v4-only keys so the
 * lifecycle engine can run. A warning points at the explicit migration script.
 */
function migrateV3(p: Policy): Policy {
  const merged = deepMerge(loadTemplate(), p) as Policy
  const legacy = p as unknown as { permission?: Record<string, unknown> }
  if (
    legacy.permission?.user_doc_writer !== undefined &&
    legacy.permission?.important_doc_writer === undefined
  ) {
    merged.permission.important_doc_writer = String(legacy.permission.user_doc_writer)
  }
  delete (merged.permission as unknown as Record<string, unknown>).user_doc_writer
  merged.policy_version = POLICY_VERSION
  console.warn(
    '[foresight] policy v3 loaded: mapped to v4 in memory. Run scripts/migrate-policy.mjs to rewrite policy.yaml with a backup (gnomic semantics and important-doc routing change in v4).',
  )
  return merged
}

export function loadPolicy(policyPath: string): Policy {
  let text: string
  try {
    text = fs.readFileSync(policyPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `policy.yaml not found at ${policyPath}. On first run ForeSight seeds it from templates/; if the data directory is read-only, copy templates/policy.yaml.example there manually.`,
      )
    }
    throw e
  }
  const raw = yaml.load(text) as { foresight?: Policy } | undefined
  const p = raw?.foresight
  const version = Number(p?.policy_version)
  if (p && version === POLICY_VERSION) return p
  if (p && version === 3) return migrateV3(p)
  throw new Error(
    `policy version mismatch: expected ${POLICY_VERSION}, got ${p?.policy_version ?? 'none'} (file: ${policyPath})`,
  )
}

export function loadPolicyFromRoot(memoryRoot: string): Policy {
  return loadPolicy(path.join(memoryRoot, 'policy.yaml'))
}

/** Aspect → behavior lookup table (P2). All scheduling logic reads this. */
export function behavior(policy: Policy, aspect: Aspect): AspectBehavior {
  const a = policy.aspects[aspect]
  return {
    storage: (a.storage as AspectBehavior['storage']) ?? 'memory',
    injection: (a.injection as AspectBehavior['injection']) ?? 'conditional',
    expiry: (a.expiry as AspectBehavior['expiry']) ?? 'never',
    render_anchor: (a.render_anchor as AspectBehavior['render_anchor']) ?? false,
    renewable: a.renewable ?? false,
    default_ttl_days: Number(a.default_ttl_days ?? 0),
    review_every_turns: Number(a.review_every_turns ?? 30),
  }
}
