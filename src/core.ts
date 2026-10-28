/**
 * ForeSight core service: assembles store/policy/embed/llm + layers,
 * exposes to dsh plugins (tools/inject/observer/nudge/server) via ctx.foresight.
 * Wiring: write = gate + embed + conflict; turnEnd = derive trigger.
 */
import './runtime-guard.js'
import { openDatabase, type Schema } from './schema.js'
import { Store, type Memory } from './store.js'
import { CircuitBreakerEmbedProvider, OllamaEmbedProvider, type EmbedProvider } from './store/embed.js'
import { loadPolicyFromRoot, type Policy } from './policy.js'
import { LlmProvider, type LlmBackend, type LlmResponse } from './llm/provider.js'
export type { LlmResponse } from './llm/provider.js'
type LlmLike = { call(req: { model: string; system: string; user: string; json?: boolean; maxTokens?: number }): Promise<LlmResponse> }
import { gateWrite, type GateDeps, type GateWriteInput, type GateReceipt } from './gate/gate.js'
import { buildClassifyFn } from './gate/classify.js'
import { ConflictResolver } from './evolve/conflict.js'
import { search, type SearchHit, type SearchOptions } from './retrieve/search.js'
import { reason as dialecticReason, type ReasonResult } from './dialectic/reason.js'
import { Deriver, type DerivePersistInput, type DerivePersistResult } from './derive/deriver.js'
import { resolveConfig, ensureDataDir, type Config } from './config.js'
import { normalizeClock, type Clock, type ClockLike } from './clock.js'
import { applyDueTransitions, buildEvidenceFn, lifecyclePlan, renewMemory as renewMemoryTransition } from './evolve/transitions.js'
import { canWrite } from './govern/permission.js'
import type { Anchor, Aspect } from './types.js'
import * as path from 'node:path'

export interface ForeSightOptions extends Partial<Config> {
  /** Injectable clock (ManualClock in tests / eval time travel). */
  clock?: ClockLike
  /** Injectable embedder (tests / alternative local backends). */
  embed?: EmbedProvider
  /** Injectable LLM (tests / alternative backends). */
  llm?: LlmLike
}

export interface Actor {
  name: string
  isRoot: boolean
  /** Isolation scope; undefined means the default 'global' pool. */
  scope?: string
}

export interface MemoryPatch {
  content?: string
  aspect?: Aspect
  anchor?: Anchor
  activation?: number
}

export class ForeSight {
  readonly policy: Policy
  readonly store: Store
  readonly embed: EmbedProvider
  readonly llm: LlmLike
  readonly memoryRoot: string
  readonly clock: Clock
  private conflictResolver: ConflictResolver
  private deriver: Deriver | null = null
  private schema: Schema

  constructor(opts: ForeSightOptions = {}) {
    const cfg = resolveConfig(opts)
    ensureDataDir(cfg)
    this.memoryRoot = cfg.memoryRoot
    this.policy = loadPolicyFromRoot(this.memoryRoot)
    this.schema = openDatabase(path.join(this.memoryRoot, cfg.dbFile), cfg.embedDim)
    this.clock = normalizeClock(opts.clock)
    const logFile = this.policy.audit.log_file
    this.store = new Store(this.schema, logFile ? path.join(this.memoryRoot, logFile) : null, this.clock)
    const baseEmbed = opts.embed ?? new OllamaEmbedProvider({
      baseUrl: cfg.embedBaseUrl,
      model: cfg.embedModel,
    })
    this.embed = new CircuitBreakerEmbedProvider(baseEmbed, {
      failureThreshold: cfg.embedFailureThreshold,
      cooldownMs: cfg.embedCooldownMs,
      onOpen: (ms) => console.warn(`[foresight] embedding circuit open for ${Math.ceil(ms / 1000)}s`),
    })
    const backend: LlmBackend = {
      baseUrl: cfg.llmBaseUrl,
      model: cfg.llmModel,
      timeoutMs: Number(this.policy.llm.timeout_ms ?? 60_000),
      maxRetries: Number(this.policy.llm.max_retries ?? 2),
    }
    this.llm = opts.llm ?? new LlmProvider(backend)
    this.conflictResolver = new ConflictResolver(this.policy, this.store, undefined, this.clock)
    if (this.policy.derive.enabled) {
      this.deriver = new Deriver(this.store, this.llm, this.policy, this.clock, {
        persist: (input) => this.persistDerived(input),
      })
    }
  }

  /** Write gate single channel: gate + embed + conflict (fully wired). */
  async write(text: string, actor: Actor, sourceRef?: string, categoryHint?: string | null): Promise<GateReceipt> {
    const deps: GateDeps = {
      policy: this.policy,
      store: this.store,
      classifyFn: buildClassifyFn(this.policy, this.llm),
      permission: { actor: actor.name, target: 'memories' },
      embedFn: (t) => this.embed.embedOne(t).catch(() => null),
      conflictResolver: {
        resolve: (n, _p) => this.conflictResolver.resolveOnWrite(n).then(() => undefined),
      },
      evidenceFn: buildEvidenceFn(this.policy, this.llm),
      clock: this.clock,
    }
    const input: GateWriteInput = {
      text,
      source: actor.isRoot ? 'root' : 'agent',
      sourceRef: sourceRef ?? null,
      categoryHint: categoryHint ?? null,
      scope: actor.scope ?? 'global',
    }
    return gateWrite(input, deps)
  }

  /** Retrieval: read-path lifecycle contract (C1) + scoring + anchor render. */
  async query(query: string, opts?: SearchOptions): Promise<SearchHit[]> {
    const now = this.clock.now()
    applyDueTransitions(this.store, this.policy, now)
    return search(query, this.store, this.embed, this.policy, now, {
      ...(opts ?? {}),
      scope: opts?.scope ?? 'global',
    })
  }

  /** Dialectic reasoning (LLM failure → evidence concat, never blocks). */
  async reason(query: string, scope?: string): Promise<ReasonResult> {
    return dialecticReason(query, {
      store: this.store,
      policy: this.policy,
      embed: this.embed,
      llm: this.llm,
      now: this.clock.now(),
      scope: scope ?? 'global',
    })
  }

  /** Update a memory through the full write-quality path (re-embed + audit). */
  async updateMemory(id: string, patch: MemoryPatch, actor: Actor): Promise<Memory | null> {
    this.assertWrite(actor)
    const before = this.store.getMemory(id, actor.scope)
    if (!before) return null
    if (patch.content !== undefined && patch.content.trim().length === 0) {
      throw new Error('content must not be empty')
    }
    let embedding: Float32Array | null = null
    if (patch.content !== undefined) {
      try {
        embedding = await this.embed.embedOne(patch.content)
      } catch {
        embedding = null
      }
    }
    const revision = Number(before.metadata?.revision ?? 0) + 1
    const updated = this.store.updateMemory(id, {
      ...patch,
      metadata: { ...(before.metadata ?? {}), revision },
    })
    if (!updated) return null
    const plan = lifecyclePlan(this.policy, updated)
    if (plan) {
      this.store.updateMemory(id, { metadata: { ...(updated.metadata ?? {}), lifecycle: plan } })
    }
    if (patch.content !== undefined) {
      if (embedding) {
        this.store.setEmbedding(id, embedding)
        try {
          await this.conflictResolver.resolveOnWrite({ ...updated, embedding: Buffer.from(embedding.buffer) })
        } catch {
          /* conflict resolution is best-effort */
        }
      } else {
        this.store.clearEmbedding(id)
      }
    }
    this.store.emit('memory.update', id, {
      before: { content: before.content, aspect: before.aspect, anchor: before.anchor, status: before.status },
      after: { content: updated.content, aspect: updated.aspect, anchor: updated.anchor, status: updated.status },
      scope: before.scope,
    })
    return this.store.getMemory(id, actor.scope)
  }

  /** Soft delete by default; hard purge is root-only. */
  async deleteMemory(id: string, actor: Actor, hard = false): Promise<boolean> {
    this.assertWrite(actor)
    if (hard && !actor.isRoot && !this.policy.permission.root_writers.includes(actor.name)) {
      throw new Error('仅 Root 可执行硬删除')
    }
    const before = this.store.getMemory(id, actor.scope)
    if (!before) return false
    const ok = hard ? this.store.hardDelete(id) : this.store.softDelete(id)
    if (ok) {
      this.store.emit('memory.delete', id, {
        hard,
        snapshot: { content: before.content, aspect: before.aspect, anchor: before.anchor, status: before.status },
        scope: before.scope,
      })
    }
    return ok
  }

  /** Restore a soft-deleted/suppressed memory; re-embed when needed. */
  async restoreMemory(id: string, actor: Actor): Promise<Memory | null> {
    this.assertWrite(actor)
    const before = this.store.getMemory(id, actor.scope)
    if (!before) return null
    const restored = this.store.restore(id)
    if (!restored) return null
    if (!restored.embedding) {
      try {
        this.store.setEmbedding(id, await this.embed.embedOne(restored.content))
      } catch {
        /* stays without a vector; backfill can retry */
      }
    }
    this.store.emit('memory.restore', id, {
      scope: before.scope,
      from: before.status,
    })
    return this.store.getMemory(id, actor.scope)
  }

  /** Renew a progressive/prospective window (nudge review action). */
  async renewMemory(id: string, until: string | undefined, actor: Actor): Promise<Memory | null> {
    this.assertWrite(actor)
    const before = this.store.getMemory(id, actor.scope)
    if (!before) return null
    let endMs: number | undefined
    if (until !== undefined) {
      endMs = Date.parse(until)
      if (!Number.isFinite(endMs)) throw new Error('until must be an ISO date')
    }
    const renewed = renewMemoryTransition(this.store, this.policy, before, this.clock.now(), endMs)
    if (!renewed) return null
    this.store.emit('memory.renew', id, {
      until: renewed.anchor.end ?? null,
      scope: before.scope,
    })
    return this.store.getMemory(id, actor.scope)
  }

  /** Backfill memories written while the embedder was unavailable. */
  async backfillEmbeddings(limit = 100): Promise<number> {
    let done = 0
    for (const row of this.store.listMissingEmbeddings(limit)) {
      try {
        const vec = await this.embed.embedOne(row.content)
        if (this.store.setEmbedding(row.id, vec)) {
          done += 1
          this.store.emit('memory.embed_backfill', row.id, { scope: row.scope })
        }
      } catch {
        break
      }
    }
    return done
  }

  /** turnEnd hook (observer wiring): incremental derive per session. */
  async onTurnEnd(sessionId: string, turn: number): Promise<void> {
    if (!this.deriver) return
    if (this.policy.derive.trigger === 'session' || this.policy.derive.trigger === 'session_end') return
    const every = Number(this.policy.derive.every_n_turns ?? 0)
    if (every > 0 && turn > 0 && turn % every !== 0) return
    await this.runDeriver(sessionId)
  }

  /** Session disposed hook: flush the derive tail for either trigger mode. */
  async onSessionEnd(sessionId: string): Promise<void> {
    if (!this.deriver) return
    await this.runDeriver(sessionId)
  }

  private async runDeriver(sessionId: string): Promise<void> {
    if (!this.deriver) return
    await this.deriver.run(sessionId, {
      userDocPath: path.join(this.memoryRoot, 'IMPORTANT.md'),
    })
  }

  private async persistDerived(input: DerivePersistInput): Promise<DerivePersistResult> {
    const scope = 'global'
    const duplicate = this.store.findActiveByContent(input.content, scope)
    if (duplicate) {
      this.store.emit('derive.duplicate', duplicate.id, { route: input.category, scope })
      return { id: duplicate.id, duplicate: true, suppressed: false }
    }
    let embedding: Float32Array | null = null
    try {
      embedding = await this.embed.embedOne(input.content)
    } catch {
      embedding = null
    }
    const baseWeight = Number(this.policy.activation.base_weights.derive ?? 0.7)
    const memory = this.store.insertMemory({
      content: input.content,
      aspect: input.aspect,
      anchor: input.anchor,
      category: input.category,
      source: 'derive',
      sourceRef: input.sourceRef,
      scope,
      activation: baseWeight,
      baseWeight,
      metadata: input.metadata,
      embedding,
    })
    const plan = lifecyclePlan(this.policy, memory)
    if (plan) {
      this.store.updateMemory(memory.id, { metadata: { ...(memory.metadata ?? {}), lifecycle: plan } })
    }
    if (embedding) {
      try {
        await this.conflictResolver.resolveOnWrite({ ...memory, embedding: Buffer.from(embedding.buffer) })
      } catch {
        /* conflict resolution is best-effort */
      }
    }
    const after = this.store.getMemory(memory.id)
    return { id: memory.id, duplicate: false, suppressed: after?.status === 'suppressed' }
  }

  private assertWrite(actor: Actor): void {
    if (!canWrite(actor.name, 'memories', this.policy)) {
      throw new Error(`写入方 ${actor.name} 无权管理记忆`)
    }
  }

  /** Close underlying db (lifecycle). */
  close(): void {
    this.schema.db.close()
  }
}
