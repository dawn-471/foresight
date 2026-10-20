/**
 * ForeSight injection layer: three-section table render + SOUL/user static
 * injection (design §9).
 *
 * System prompt section sources:
 *   - soul     = SOUL.md verbatim (Root static; mtime cached)
 *   - important = IMPORTANT.md verbatim (legacy user.md fallback; mtime cached)
 *   - memories = lifecycle-eligible rows of every stored aspect, ranked by
 *                activation (or by query overlap when a user turn is known),
 *                rendered with the same anchor rules as search. Completed
 *                memories stay visible as 「已完成」. Not-started progressive
 *                stays hidden.
 *
 * renderSections is pure (testable without dsh); registerSections mounts
 * onto systemPrompt.section (orders: soul -50 / user 10 / memories 20).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Store } from '../store.js'
import type { Policy, Anchor } from '../policy.js'
import { normalizeClock, type ClockLike } from '../clock.js'
import { lifecycleEligible } from '../evolve/temporal.js'
import { applyDueTransitions } from '../evolve/transitions.js'
import { estimateTokens } from '../tokens.js'
import { renderMemory, search } from '../retrieve/search.js'
import type { EmbedProvider } from '../store/embed.js'
import type { Aspect } from '../types.js'
import type { Memory } from '../store.js'

export interface RenderDeps {
  store: Store
  policy: Policy
  memoryRoot: string
  now?: Date
  clock?: ClockLike
  /** H3 override; defaults to policy.injection.memories_budget_tokens. */
  budgetTokens?: number
  /** Token counter override (eval uses its frozen counter). */
  countTokens?: (text: string) => number
  /** Latest user turn, or a getter the section re-reads on each assemble. */
  query?: string | (() => string)
  /** When set, replaces the lexical memories render (semantic cache). */
  memoriesText?: () => string
}

export interface RenderMemoriesOptions {
  budgetTokens?: number
  countTokens?: (text: string) => number
  /** Latest user turn. Ranks eligible memories by character-bigram overlap. */
  query?: string
}

const ACTIVATION_FLOOR = 0.2

export interface RenderResult {
  soul: string
  important: string
  memories: string
}

interface FileCacheEntry {
  mtimeMs: number
  content: string
}

const fileCache = new Map<string, FileCacheEntry>()

/** Read a text file under memoryRoot (mtime-cached). Missing/failed → ''. */
export function readTextFile(memoryRoot: string, filename: string): string {
  const p = path.join(memoryRoot, filename)
  try {
    const st = fs.statSync(p)
    const hit = fileCache.get(p)
    if (hit !== undefined && hit.mtimeMs === st.mtimeMs) return hit.content
    const content = fs.readFileSync(p, 'utf8')
    fileCache.set(p, { mtimeMs: st.mtimeMs, content })
    return content
  } catch {
    return ''
  }
}

/** Anchor expiry (mechanical; parse failure → not expired, conservative). */
export function anchorExpired(anchor: Anchor, now: Date): boolean {
  if (anchor.type === 'interval' && typeof anchor.end === 'string' && anchor.end.length > 0) {
    const end = Date.parse(anchor.end)
    return Number.isFinite(end) && end < now.getTime()
  }
  return false
}

/** Single progressive render: stable absolute-date suffix per anchor type. */
export function renderAnchorSuffix(content: string, anchor: Anchor): string {
  if (anchor.type === 'interval' && typeof anchor.end === 'string' && anchor.end.length > 0) {
    return `${content}（至 ${anchor.end}）`
  }
  if (anchor.type === 'point' && typeof anchor.start === 'string' && anchor.start.length > 0) {
    return `${content}（${anchor.start} 起）`
  }
  return content
}

function bigrams(text: string): string[] {
  const t = text.replace(/\s+/g, '')
  if (t.length < 2) return t ? [t] : []
  const out: string[] = []
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
  return out
}

function overlap(query: string, content: string): number {
  const grams = bigrams(query)
  if (grams.length === 0) return 0
  if (content.includes(query.trim())) return 1
  let hit = 0
  for (const g of grams) if (content.includes(g)) hit++
  return hit / grams.length
}

/** Active, lifecycle-eligible memories across every aspect the policy knows. */
export function collectInjectable(store: Store, policy: Policy, now: Date, query?: string): Memory[] {
  const nowMs = now.getTime()
  applyDueTransitions(store, policy, nowMs)
  const aspects = Object.keys(policy.aspects ?? {}) as Aspect[]
  const rows: Memory[] = []
  for (const aspect of aspects) {
    for (const m of store.listByAspectStatus(aspect, 'active')) {
      if (m.activation <= ACTIVATION_FLOOR) continue
      if (!lifecycleEligible(policy, m, nowMs)) continue
      rows.push(m)
    }
  }
  const q = query?.trim() ?? ''
  rows.sort((a, b) => {
    if (q) {
      const d = overlap(q, b.content) - overlap(q, a.content)
      if (d !== 0) return d
    }
    if (b.activation !== a.activation) return b.activation - a.activation
    return a.createdAt - b.createdAt
  })
  const k = Number(policy.retrieval?.top_k ?? 0)
  return k > 0 ? rows.slice(0, k) : rows
}

function applyBudget(lines: string[], budget: number, count: (text: string) => number): string {
  if (!(budget > 0)) return lines.join('\n')
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const t = count(line)
    if (used + t > budget) continue
    used += t
    kept.push(line)
  }
  return kept.join('\n')
}

/**
 * memories render: settle due transitions, then inject every eligible aspect
 * (not only progressive). A query reorders by overlap; vector search is the
 * live path (renderMemoriesQuery).
 */
export function renderMemories(store: Store, policy: Policy, now: Date, opts: RenderMemoriesOptions = {}): string {
  const lines = collectInjectable(store, policy, now, opts.query).map((m) => renderMemory(m, policy))
  const budget = Number(opts.budgetTokens ?? policy.injection?.memories_budget_tokens ?? 0)
  return applyBudget(lines, budget, opts.countTokens ?? estimateTokens)
}

/** Semantic injection: same search path as memory_query, then the token budget. */
export async function renderMemoriesQuery(
  store: Store,
  policy: Policy,
  embed: EmbedProvider,
  query: string,
  now: Date,
  opts: RenderMemoriesOptions = {},
): Promise<string> {
  const nowMs = now.getTime()
  applyDueTransitions(store, policy, nowMs)
  const k = Number(policy.retrieval?.top_k ?? 8)
  const hits = await search(query, store, embed, policy, nowMs, { topK: k > 0 ? k : 8 })
  const lines = hits.map((h) => h.rendered || h.content)
  if (lines.length === 0) return renderMemories(store, policy, now, opts)
  const budget = Number(opts.budgetTokens ?? policy.injection?.memories_budget_tokens ?? 0)
  return applyBudget(lines, budget, opts.countTokens ?? estimateTokens)
}

/** IMPORTANT.md with one-release fallback to the legacy user.md filename. */
export function readImportantDoc(memoryRoot: string): string {
  const next = readTextFile(memoryRoot, 'IMPORTANT.md')
  return next || readTextFile(memoryRoot, 'user.md')
}

/** Three-section render (pure). */
export function renderSections(deps: RenderDeps): RenderResult {
  const now = deps.now ?? new Date(normalizeClock(deps.clock).now())
  const query = typeof deps.query === 'function' ? deps.query() : deps.query
  return {
    soul: readTextFile(deps.memoryRoot, 'SOUL.md'),
    important: readImportantDoc(deps.memoryRoot),
    memories: deps.memoriesText
      ? deps.memoriesText()
      : renderMemories(deps.store, deps.policy, now, {
          budgetTokens: deps.budgetTokens,
          countTokens: deps.countTokens,
          query,
        }),
  }
}

/**
 * dsh registration: mount three sections onto ctx.systemPrompt.section.
 * text is a function → re-reads/re-renders each assemble (live edits/expiry).
 * order aligned: soul -50, user 10, memories 20. Names from policy.injection.
 */
export function registerSections(ctx: unknown, deps: RenderDeps): () => void {
  const sp = (ctx as { systemPrompt?: { section?: (s: unknown) => unknown } }).systemPrompt
  if (!sp || typeof sp.section !== 'function') {
    throw new Error('foresight-inject: ctx.systemPrompt 不可用（需要 dsh-system-prompt 服务）')
  }
  const disposers: Array<() => void> = []

  const mount = (name: string, order: number, pick: (r: RenderResult) => string): void => {
    disposers.push(
      sp.section!({
        name,
        order,
        text: () =>
          pick(
            renderSections({
              store: deps.store,
              policy: deps.policy,
              memoryRoot: deps.memoryRoot,
              clock: deps.clock,
              budgetTokens: deps.budgetTokens,
              countTokens: deps.countTokens,
              query: deps.query,
              memoriesText: deps.memoriesText,
            })
          ),
      }) as () => void
    )
  }

  mount(deps.policy.injection.soul_section, -50, (r) => r.soul)
  mount(deps.policy.injection.important_section, 10, (r) => r.important)
  mount(deps.policy.injection.memories_section, 20, (r) => r.memories)

  return () => {
    for (const d of disposers) {
      try {
        d()
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

// ── cordis plugin entry ─────────────────────────────────────────────

export interface InjectCtx {
  systemPrompt?: { section?: (s: unknown) => unknown }
  on?: (event: string, listener: (...args: unknown[]) => unknown) => unknown
}

export const name = 'foresight-inject'
export const inject = ['foresight', 'systemPrompt']

/**
 * Plugin entry: resolve store/policy/memoryRoot from injected ctx.foresight,
 * mount three sections. Throws on missing deps (fail-fast, never silent).
 */
function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return (blocks as Array<Record<string, unknown>>)
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

export function apply(ctx: InjectCtx): () => void {
  const fsight = (ctx as unknown as {
    foresight?: {
      store?: Store
      policy?: Policy
      memoryRoot?: string
      clock?: ClockLike
      embed?: EmbedProvider
    }
  }).foresight
  const store = fsight?.store
  const policy = fsight?.policy
  const memoryRoot = fsight?.memoryRoot
  if (!store || !policy || !memoryRoot) {
    throw new Error('foresight-inject: 缺少 ctx.foresight（需 foresight-core 先加载）')
  }
  if (!ctx.systemPrompt || typeof ctx.systemPrompt.section !== 'function') {
    throw new Error('foresight-inject: ctx.systemPrompt 不可用（需要 dsh-system-prompt 服务）')
  }
  let latestQuery = ''
  let cachedQuery = ''
  let cachedText: string | null = null
  const refresh = (q: string) => {
    if (!q.trim() || !fsight.embed) return
    void renderMemoriesQuery(store, policy, fsight.embed, q, new Date(normalizeClock(fsight.clock).now()), {})
      .then((text) => {
        if (latestQuery !== q) return
        cachedQuery = q
        cachedText = text
      })
      .catch(() => {
        /* lexical render remains the assemble fallback */
      })
  }
  if (typeof ctx.on === 'function') {
    ctx.on('session/event', (_session: unknown, event: unknown) => {
      const e = event as { type?: string; data?: Record<string, unknown> } | null
      if (e?.type !== 'user/message') return
      const source = e.data?.source as Record<string, unknown> | undefined
      if (source?.kind !== 'user') return
      const text = textOfBlocks(e.data?.content).trim()
      if (!text) return
      latestQuery = text
      refresh(text)
    })
  }
  return registerSections(ctx, {
    store,
    policy,
    memoryRoot,
    clock: fsight.clock,
    query: () => latestQuery,
    memoriesText: () => {
      if (latestQuery && cachedQuery === latestQuery && cachedText != null) return cachedText
      const now = new Date(normalizeClock(fsight.clock).now())
      return renderMemories(store, policy, now, { query: latestQuery })
    },
  })
}
