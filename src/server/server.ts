/**
 * ForeSight service layer (§13): Node native HTTP REST API, multi-agent writes.
 *
 * - binds policy.server.host:port (default 127.0.0.1:9288), X-ForeSight-Token;
 * - writes go through the full gate path (classify + embed + conflict), shared
 *   with the in-process tool/observer path;
 * - retrieval uses the full search shape when an embedder is available;
 * - peer identity is the scope: reads/writes are isolated per peer, and only
 *   policy root writers may claim root/source=root or hard-delete;
 * - no framework deps (node:http), no CORS; JSON parse fail 400;
 * - deps injectable for tests.
 *
 * Endpoints:
 *   GET    /v1/health                 → {status:'ok'} (no auth)
 *   POST   /v1/memories               → 200 {id} | 4xx {error, clause, message?}
 *   POST   /v1/memories/search        → 200 {query, results}
 *   GET    /v1/memories/:id           → 200 memory | 404
 *   PATCH  /v1/memories/:id           → 200 memory
 *   DELETE /v1/memories/:id           → 200 {id, deleted} (?purge=1 root)
 *   POST   /v1/memories/:id/restore   → 200 memory
 *   POST   /v1/reason                 → 200 {query, answer, citations, conflicts}
 */
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Policy, Anchor, MemorySource } from '../policy.js'
import type { Store, Memory } from '../store.js'
import type { EmbedProvider } from '../store/embed.js'
import type { LlmLike } from '../dialectic/reason.js'
import type { Actor, MemoryPatch } from '../core.js'
import { gateWrite, type GateReceipt } from '../gate/gate.js'
import { buildClassifyFn } from '../gate/classify.js'
import { buildEvidenceFn, applyDueTransitions, renewMemory as renewMemoryTransition } from '../evolve/transitions.js'
import { ConflictResolver } from '../evolve/conflict.js'
import { search, type SearchHit, type SearchOptions } from '../retrieve/search.js'
import { normalizeClock, type ClockLike } from '../clock.js'
import { canWrite } from '../govern/permission.js'

export interface ServerDeps {
  policy: Policy
  store: Store
  host?: string
  port?: number
  embed?: EmbedProvider
  llm?: LlmLike
  gateWrite?: typeof gateWrite
  search?: typeof search
  reason?: (query: string, scope?: string) => Promise<Record<string, unknown>>
  clock?: ClockLike
  write?: (text: string, actor: Actor, sourceRef?: string, categoryHint?: string | null) => Promise<GateReceipt>
  query?: (query: string, opts?: SearchOptions) => Promise<SearchHit[]>
  updateMemory?: (id: string, patch: MemoryPatch, actor: Actor) => Promise<Memory | null>
  deleteMemory?: (id: string, actor: Actor, hard?: boolean) => Promise<boolean>
  restoreMemory?: (id: string, actor: Actor) => Promise<Memory | null>
  renewMemory?: (id: string, until: string | undefined, actor: Actor) => Promise<Memory | null>
}

export interface StartedServer {
  port: number
  close(): Promise<void>
}

const ASPECTS: readonly string[] = ['gnomic', 'progressive', 'perfect', 'prospective', 'uncertain']
const PUBLIC_SOURCES: readonly string[] = ['agent', 'root']
const ANCHOR_TYPES: readonly string[] = ['none', 'point', 'interval', 'open']
const MAX_BODY_BYTES = 1_048_576

class HttpError extends Error {
  constructor(
    public status: number,
    public error: string,
    public clause?: string,
  ) {
    super(error)
  }
}

const FAILED_LLM: LlmLike = {
  call: async () => {
    throw new Error('LLM 不可用（API key 缺失）')
  },
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        cleanup()
        req.pause()
        reject(new HttpError(413, 'payload_too_large'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (e: Error) => {
      cleanup()
      reject(e)
    }
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req)
  if (buf.length === 0) return {}
  try {
    const v = JSON.parse(buf.toString('utf8')) as unknown
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'invalid_json')
    return v as Record<string, unknown>
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(400, 'invalid_json')
  }
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function json(res: http.ServerResponse, status: number, obj: unknown): void {
  try {
    if (res.writableEnded) return
    const payload = JSON.stringify(obj)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    })
    res.end(payload)
  } catch {
    /* client gone */
  }
}

function peerOf(req: http.IncomingMessage): string {
  const raw = header(req, 'x-foresight-peer')
  if (raw !== undefined && (raw.length > 64 || raw.trim().length === 0)) throw new HttpError(400, 'invalid_peer')
  return raw ?? 'agent'
}

function actorOf(peer: string, policy: Policy): Actor {
  return {
    name: peer,
    isRoot: policy.permission.root_writers.includes(peer),
    scope: peer,
  }
}

// ── endpoint implementations ─────────────────────────────────────────

async function handleWrite(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx): Promise<void> {
  const body = await readJson(req)
  const content = body.content
  if (typeof content !== 'string' || !content.trim()) throw new HttpError(400, 'content_required')
  const aspect = body.aspect
  if (aspect !== undefined && (typeof aspect !== 'string' || !ASPECTS.includes(aspect))) {
    throw new HttpError(400, 'invalid_aspect')
  }
  const anchor = body.anchor as Anchor | undefined
  if (anchor !== undefined && (typeof anchor !== 'object' || anchor === null || !ANCHOR_TYPES.includes(anchor.type))) {
    throw new HttpError(400, 'invalid_anchor')
  }
  const requestedSource = body.source
  if (requestedSource !== undefined && (typeof requestedSource !== 'string' || !PUBLIC_SOURCES.includes(requestedSource))) {
    throw new HttpError(400, 'invalid_source')
  }
  const sourceRef = typeof body.sourceRef === 'string' ? body.sourceRef : undefined
  if (body.metadata !== undefined && (typeof body.metadata !== 'object' || body.metadata === null || Array.isArray(body.metadata))) {
    throw new HttpError(400, 'invalid_metadata')
  }
  const categoryHint = typeof body.categoryHint === 'string' ? body.categoryHint : undefined

  const peer = peerOf(req)
  const actor = actorOf(peer, ctx.policy)
  if (requestedSource === 'root' && !actor.isRoot) throw new HttpError(403, 'permission_denied')
  const sourceRefWithPeer = sourceRef ? `${peer}:${sourceRef}` : peer

  const receipt = await ctx.write(content.trim(), actor, sourceRefWithPeer, categoryHint ?? null)
  if (!receipt.ok || !receipt.memory) {
    const status = receipt.eventType === 'permission.deny' ? 403 : 422
    return json(res, status, {
      error: 'gate_rejected',
      clause: receipt.clause,
      message: receipt.message,
      suggestion: receipt.suggestion,
    })
  }
  return json(res, 200, { id: receipt.memory.id })
}

async function handleSearch(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx): Promise<void> {
  const body = await readJson(req)
  const query = body.query
  if (typeof query !== 'string' || !query.trim()) throw new HttpError(400, 'query_required')
  const k =
    typeof body.k === 'number' && Number.isFinite(body.k)
      ? Math.min(100, Math.max(1, Math.floor(body.k)))
      : ctx.policy.retrieval.top_k
  const from = typeof body.from === 'string' ? body.from : undefined
  const to = typeof body.to === 'string' ? body.to : undefined
  const peer = peerOf(req)

  const hits = await ctx.query(query.trim(), { from, to, topK: k, scope: peer })
  return json(res, 200, { query: query.trim(), results: hits.map(hitToJson) })
}

function hitToJson(h: SearchHit): Record<string, unknown> {
  return {
    id: h.id,
    content: h.content,
    aspect: h.aspect,
    anchor: h.anchor,
    activation: h.activation,
    score: h.score,
    factors: h.factors,
    rendered: h.rendered,
    createdAt: h.createdAt,
  }
}

async function handleReason(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx): Promise<void> {
  const body = await readJson(req)
  const query = body.query
  if (typeof query !== 'string' || !query.trim()) throw new HttpError(400, 'query_required')

  const reasonFn = ctx.reason
  if (!reasonFn) throw new HttpError(501, 'reason_unavailable')
  const peer = peerOf(req)
  const result = await reasonFn(query.trim(), peer)
  return json(res, 200, { query: query.trim(), ...result })
}

async function handleGet(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx, id: string): Promise<void> {
  const peer = peerOf(req)
  const actor = actorOf(peer, ctx.policy)
  const m = ctx.store.getMemory(id, peer)
  const includeDeleted = new URL(req.url ?? '/', 'http://localhost').searchParams.get('includeDeleted') === '1'
  if (!m || (m.status === 'deleted' && !(includeDeleted && actor.isRoot))) {
    return json(res, 404, { error: 'not_found', clause: null })
  }
  return json(res, 200, memoryToJson(m))
}

function memoryToJson(mem: Memory): Record<string, unknown> {
  return {
    id: mem.id,
    content: mem.content,
    aspect: mem.aspect,
    anchor: mem.anchor,
    category: mem.category,
    telicity: mem.telicity,
    modality: mem.modality,
    activation: mem.activation,
    baseWeight: mem.baseWeight,
    source: mem.source,
    sourceRef: mem.sourceRef,
    scope: mem.scope,
    status: mem.status,
    metadata: mem.metadata,
    createdAt: mem.createdAt,
    updatedAt: mem.updatedAt,
  }
}

async function handleDelete(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx, id: string): Promise<void> {
  const peer = peerOf(req)
  const actor = actorOf(peer, ctx.policy)
  const url = new URL(req.url ?? '/', 'http://localhost')
  const hard = url.searchParams.get('purge') === '1'
  if (hard && !actor.isRoot) throw new HttpError(403, 'permission_denied')
  const ok = await ctx.deleteMemory(id, actor, hard)
  if (!ok) return json(res, 404, { error: 'not_found', clause: null })
  return json(res, 200, { id, deleted: true, hard })
}

async function handlePatch(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx, id: string): Promise<void> {
  const body = await readJson(req)
  const patch: MemoryPatch = {}
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) throw new HttpError(400, 'invalid_content')
    patch.content = body.content.trim()
  }
  if (body.aspect !== undefined) {
    if (typeof body.aspect !== 'string' || !ASPECTS.includes(body.aspect)) throw new HttpError(400, 'invalid_aspect')
    patch.aspect = body.aspect as MemoryPatch['aspect']
  }
  if (body.anchor !== undefined) {
    const a = body.anchor as Anchor
    if (typeof a !== 'object' || a === null || !ANCHOR_TYPES.includes(a.type)) throw new HttpError(400, 'invalid_anchor')
    patch.anchor = a
  }
  if (body.activation !== undefined) {
    if (typeof body.activation !== 'number' || !Number.isFinite(body.activation)) throw new HttpError(400, 'invalid_activation')
    patch.activation = body.activation
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'empty_patch')
  const actor = actorOf(peerOf(req), ctx.policy)
  const updated = await ctx.updateMemory(id, patch, actor)
  if (!updated) return json(res, 404, { error: 'not_found', clause: null })
  return json(res, 200, memoryToJson(updated))
}

async function handleRestore(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx, id: string): Promise<void> {
  const actor = actorOf(peerOf(req), ctx.policy)
  const restored = await ctx.restoreMemory(id, actor)
  if (!restored) return json(res, 404, { error: 'not_found', clause: null })
  return json(res, 200, memoryToJson(restored))
}

async function handleRenew(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx, id: string): Promise<void> {
  const body = await readJson(req)
  const until = typeof body.until === 'string' && body.until.trim() ? body.until.trim() : undefined
  if (until !== undefined && Number.isNaN(Date.parse(until))) throw new HttpError(400, 'invalid_until')
  const actor = actorOf(peerOf(req), ctx.policy)
  const renewed = await ctx.renewMemory(id, until, actor)
  if (!renewed) return json(res, 404, { error: 'not_found', clause: null })
  return json(res, 200, memoryToJson(renewed))
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, ctx: ServerCtx): Promise<void> {
  try {
    const u = new URL(req.url ?? '/', 'http://localhost')
    const pathname = u.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && pathname === '/v1/health') return json(res, 200, { status: 'ok' })

    if (!ctx.policy.server.enabled) return json(res, 503, { error: 'server_disabled', clause: null })
    const token = header(req, 'x-foresight-token')
    const peer = peerOf(req)
    const peerTokens = ctx.policy.server.peer_tokens ?? {}
    const expected = Object.keys(peerTokens).length > 0 ? peerTokens[peer] : ctx.policy.server.token
    if (!expected || token !== expected) return json(res, 401, { error: 'unauthorized', clause: null })

    if (method === 'POST' && pathname === '/v1/memories') return await handleWrite(req, res, ctx)
    if (method === 'POST' && pathname === '/v1/memories/search') return await handleSearch(req, res, ctx)
    if (method === 'POST' && pathname === '/v1/reason') return await handleReason(req, res, ctx)
    const restore = method === 'POST' ? /^\/v1\/memories\/([^/]+)\/restore$/.exec(pathname) : null
    if (restore) return await handleRestore(req, res, ctx, decodeURIComponent(restore[1]))
    const renew = method === 'POST' ? /^\/v1\/memories\/([^/]+)\/renew$/.exec(pathname) : null
    if (renew) return await handleRenew(req, res, ctx, decodeURIComponent(renew[1]))
    const m = /^\/v1\/memories\/([^/]+)$/.exec(pathname)
    if (m && method === 'GET') return await handleGet(req, res, ctx, decodeURIComponent(m[1]))
    if (m && method === 'PATCH') return await handlePatch(req, res, ctx, decodeURIComponent(m[1]))
    if (m && method === 'DELETE') return await handleDelete(req, res, ctx, decodeURIComponent(m[1]))

    return json(res, 404, { error: 'not_found', clause: null })
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.error, clause: e.clause ?? null })
    console.error('[foresight:server] 未捕获异常:', e)
    return json(res, 500, { error: 'internal_error', clause: null })
  }
}

interface ServerCtx extends ServerDeps {
  embed: EmbedProvider
  llm: LlmLike
  write: NonNullable<ServerDeps['write']>
  query: NonNullable<ServerDeps['query']>
  updateMemory: NonNullable<ServerDeps['updateMemory']>
  deleteMemory: NonNullable<ServerDeps['deleteMemory']>
  restoreMemory: NonNullable<ServerDeps['restoreMemory']>
  renewMemory: NonNullable<ServerDeps['renewMemory']>
}

export async function startServer(deps: ServerDeps): Promise<StartedServer> {
  const host = deps.host ?? deps.policy.server.host
  const port = deps.port ?? deps.policy.server.port
  const clock = normalizeClock(deps.clock)
  const realEmbed = deps.embed !== undefined
  const embed: EmbedProvider = deps.embed ?? {
    embedOne: async () => new Float32Array(768),
    embedBatch: async (t) => Array(t.length).fill(new Float32Array(768)) as unknown as Float32Array[],
  }
  const llm: LlmLike = deps.llm ?? FAILED_LLM
  const conflictResolver = new ConflictResolver(deps.policy, deps.store, undefined, clock)
  const classifyFn = buildClassifyFn(deps.policy, llm)
  const evidenceFn = buildEvidenceFn(deps.policy, llm)
  const write: NonNullable<ServerDeps['write']> = deps.write ?? (async (text, actor, sourceRef, categoryHint) => {
    return gateWrite(
      {
        text,
        source: actor.isRoot ? 'root' : 'agent',
        sourceRef: sourceRef ?? null,
        categoryHint: categoryHint ?? null,
        scope: actor.scope ?? 'global',
      },
      {
        policy: deps.policy,
        store: deps.store,
        classifyFn,
        permission: { actor: actor.name, target: 'memories' },
        embedFn: realEmbed ? (t) => deps.embed!.embedOne(t).catch(() => null) : undefined,
        conflictResolver: {
          resolve: (n) => conflictResolver.resolveOnWrite(n).then(() => undefined),
        },
        evidenceFn,
        clock,
      },
    )
  })
  const query: NonNullable<ServerDeps['query']> = deps.query ?? (async (q, opts) => {
    const now = clock.now()
    applyDueTransitions(deps.store, deps.policy, now)
    if (realEmbed) {
      return search(q, { store: deps.store, embed: deps.embed!, policy: deps.policy, now }, opts)
    }
    return search(deps.store, q, opts)
  })
  const updateMemory: NonNullable<ServerDeps['updateMemory']> = deps.updateMemory ?? (async (id, patch, actor) => {
    const before = deps.store.getMemory(id, actor.scope)
    if (!before) return null
    if (!canWrite(actor.name, 'memories', deps.policy)) throw new HttpError(403, 'permission_denied')
    const updated = deps.store.updateMemory(id, patch)
    if (updated && patch.content !== undefined) {
      if (realEmbed) {
        try {
          deps.store.setEmbedding(id, await deps.embed!.embedOne(patch.content))
        } catch {
          deps.store.clearEmbedding(id)
        }
      } else {
        deps.store.clearEmbedding(id)
      }
    }
    return deps.store.getMemory(id, actor.scope)
  })
  const deleteMemory: NonNullable<ServerDeps['deleteMemory']> = deps.deleteMemory ?? (async (id, actor, hard) => {
    const before = deps.store.getMemory(id, actor.scope)
    if (!before) return false
    if (!canWrite(actor.name, 'memories', deps.policy)) throw new HttpError(403, 'permission_denied')
    if (hard) {
      if (!actor.isRoot) throw new HttpError(403, 'permission_denied')
      return deps.store.hardDelete(id)
    }
    return deps.store.softDelete(id)
  })
  const restoreMemory: NonNullable<ServerDeps['restoreMemory']> = deps.restoreMemory ?? (async (id, actor) => {
    const before = deps.store.getMemory(id, actor.scope)
    if (!before) return null
    if (!canWrite(actor.name, 'memories', deps.policy)) throw new HttpError(403, 'permission_denied')
    const restored = deps.store.restore(id)
    if (restored && !restored.embedding && realEmbed) {
      try {
        deps.store.setEmbedding(id, await deps.embed!.embedOne(restored.content))
      } catch {
        /* backfill can retry */
      }
    }
    return deps.store.getMemory(id, actor.scope)
  })

  const renewMemory: NonNullable<ServerDeps['renewMemory']> = deps.renewMemory ?? (async (id, until, actor) => {
    const before = deps.store.getMemory(id, actor.scope)
    if (!before) return null
    if (!canWrite(actor.name, 'memories', deps.policy)) throw new HttpError(403, 'permission_denied')
    const endMs = until !== undefined ? Date.parse(until) : undefined
    if (endMs !== undefined && Number.isNaN(endMs)) throw new HttpError(400, 'invalid_until')
    renewMemoryTransition(deps.store, deps.policy, before, clock.now(), endMs)
    return deps.store.getMemory(id, actor.scope)
  })

  const ctx: ServerCtx = {
    ...deps,
    embed,
    llm,
    write,
    query,
    updateMemory,
    deleteMemory,
    restoreMemory,
    renewMemory,
  }
  const srv = http.createServer((req, res) => {
    handle(req, res, ctx).catch((e) => {
      console.error('[foresight:server] 请求处理异常:', e)
      try {
        res.destroy()
      } catch {
        /* ignore */
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(port, host, () => {
      srv.off('error', reject)
      resolve()
    })
  })
  const addr = srv.address() as AddressInfo
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        srv.close((e) => (e ? reject(e) : resolve()))
      }),
  }
}

export const name = 'foresight-server'
export const inject = ['foresight']

export async function apply(ctx: unknown): Promise<() => void> {
  const fsight = (ctx as {
    foresight?: {
      policy?: Policy
      store?: Store
      embed?: EmbedProvider
      llm?: LlmLike
      reason?: ServerDeps['reason']
      clock?: ClockLike
      write?: ServerDeps['write']
      query?: ServerDeps['query']
      updateMemory?: ServerDeps['updateMemory']
      deleteMemory?: ServerDeps['deleteMemory']
      restoreMemory?: ServerDeps['restoreMemory']
      renewMemory?: ServerDeps['renewMemory']
      backfillEmbeddings?: () => Promise<number>
    }
  }).foresight
  if (!fsight?.policy || !fsight.store) {
    throw new Error('foresight-server 需要 foresight 服务（@foresight/memory 主插件）')
  }
  if (!fsight.policy.server.enabled) return () => {}
  const started = await startServer({
    policy: fsight.policy,
    store: fsight.store,
    embed: fsight.embed,
    llm: fsight.llm,
    reason: fsight.reason?.bind(fsight),
    clock: fsight.clock,
    write: fsight.write?.bind(fsight),
    query: fsight.query?.bind(fsight),
    updateMemory: fsight.updateMemory?.bind(fsight),
    deleteMemory: fsight.deleteMemory?.bind(fsight),
    restoreMemory: fsight.restoreMemory?.bind(fsight),
    renewMemory: fsight.renewMemory?.bind(fsight),
  })
  void fsight.backfillEmbeddings?.().catch(() => undefined)
  return () => { void started.close() }
}
