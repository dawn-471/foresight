/**
 * ForeSight Store — CRUD over the tables, soft delete, vectors, FTS, audit.
 * All writes funnel through this module (Node is single-threaded and
 * node:sqlite is synchronous, so writes are naturally serialized).
 */
import type { Schema } from './schema.js'
import type { Anchor, Aspect, MemorySource, MemoryStatus, LinkRel } from './types.js'
import { nanoid } from 'nanoid'
import * as fs from 'node:fs'
import { normalizeClock, systemClock, type Clock, type ClockLike } from './clock.js'
import { blobToF32 } from './f32.js'

export interface Memory {
  id: string
  content: string
  aspect: Aspect
  anchor: Anchor
  category: string | null
  telicity: string | null
  modality: string | null
  activation: number
  baseWeight: number
  source: MemorySource
  sourceRef: string | null
  /** Isolation scope; 'global' is the dsh/default pool. */
  scope: string
  status: MemoryStatus
  metadata: Record<string, unknown>
  embedding: Uint8Array | null
  createdAt: number
  updatedAt: number
}

export interface MemoryInput {
  content: string
  aspect: Aspect
  anchor: Anchor
  category?: string | null
  telicity?: string | null
  modality?: string | null
  activation?: number
  baseWeight?: number
  source: MemorySource
  sourceRef?: string | null
  scope?: string
  status?: MemoryStatus
  metadata?: Record<string, unknown>
  embedding?: Float32Array | null
  /** Record time override (eval/gate: classification time, not store clock). */
  createdAt?: number
}

function rowToMemory(r: Record<string, unknown>): Memory {
  return {
    id: r.id as string,
    content: r.content as string,
    aspect: r.aspect as Aspect,
    anchor: JSON.parse(r.anchor_json as string) as Anchor,
    category: (r.category as string) ?? null,
    telicity: (r.telicity as string) ?? null,
    modality: (r.modality as string) ?? null,
    activation: r.activation as number,
    baseWeight: r.base_weight as number,
    source: r.source as MemorySource,
    sourceRef: (r.source_ref as string) ?? null,
    scope: (r.scope as string) ?? 'global',
    status: r.status as MemoryStatus,
    metadata: JSON.parse((r.metadata as string) || '{}') as Record<string, unknown>,
    embedding: (r.embedding as Uint8Array) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }
}

function cosineF32(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export class Store {
  private clock: Clock

  constructor(
    private schema: Schema,
    private auditLogPath: string | null = null,
    /** Injectable clock (Clock object or legacy () => number). */
    clock: ClockLike = systemClock,
  ) {
    this.clock = normalizeClock(clock)
  }

  private tx<T>(fn: () => T): T {
    this.schema.db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      this.schema.db.exec('COMMIT')
      return r
    } catch (e) {
      try {
        this.schema.db.exec('ROLLBACK')
      } catch {
        /* rollback best-effort */
      }
      throw e
    }
  }

  private indexMemory(id: string, content: string): void {
    this.schema.db.prepare(`DELETE FROM memories_fts WHERE id = ?`).run(id)
    this.schema.db.prepare(`DELETE FROM memories_fts_zh WHERE id = ?`).run(id)
    this.schema.db.prepare(`INSERT INTO memories_fts (id, content) VALUES (?,?)`).run(id, content)
    this.schema.db.prepare(`INSERT INTO memories_fts_zh (id, content) VALUES (?,?)`).run(id, content)
  }

  private unindexMemory(id: string): void {
    this.schema.db.prepare(`DELETE FROM memories_fts WHERE id = ?`).run(id)
    this.schema.db.prepare(`DELETE FROM memories_fts_zh WHERE id = ?`).run(id)
  }

  private acceptedEmbedding(embedding: Float32Array | null | undefined): Float32Array | null {
    if (!embedding) return null
    if (embedding.length !== this.schema.dim) {
      this.emit('memory.embed_dim_mismatch', null, {
        expected: this.schema.dim,
        got: embedding.length,
      })
      return null
    }
    return embedding
  }

  // ── memories ────────────────────────────────────────────────────────

  insertMemory(input: MemoryInput): Memory {
    const now = input.createdAt ?? this.clock.now()
    const id = nanoid()
    const embedding = this.acceptedEmbedding(input.embedding)
    const scope = input.scope ?? 'global'
    this.tx(() => {
      this.schema.db
        .prepare(
          `INSERT INTO memories (id, content, aspect, anchor_json, category, telicity, modality,
             activation, base_weight, source, source_ref, scope, status, metadata, embedding, created_at, updated_at)
           VALUES (@id, @content, @aspect, @anchor_json, @category, @telicity, @modality,
             @activation, @base_weight, @source, @source_ref, @scope, @status, @metadata, @embedding, @created_at, @updated_at)`,
        )
        .run({
          id,
          content: input.content,
          aspect: input.aspect,
          anchor_json: JSON.stringify(input.anchor),
          category: input.category ?? null,
          telicity: input.telicity ?? null,
          modality: input.modality ?? null,
          activation: input.activation ?? 1.0,
          base_weight: input.baseWeight ?? 1.0,
          source: input.source,
          source_ref: input.sourceRef ?? null,
          scope,
          status: input.status ?? 'active',
          metadata: JSON.stringify(input.metadata ?? {}),
          embedding: embedding ? Buffer.from(embedding.buffer) : null,
          created_at: now,
          updated_at: now,
        })
      if (embedding && this.schema.vecEnabled) {
        this.schema.db
          .prepare(`INSERT INTO memories_vec (id, embedding) VALUES (?, ?)`)
          .run(id, Buffer.from(embedding.buffer))
      }
      this.indexMemory(id, input.content)
    })
    return this.getMemory(id)!
  }

  getMemory(id: string, scope?: string): Memory | null {
    const r = this.schema.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id)
    if (!r) return null
    const m = rowToMemory(r as Record<string, unknown>)
    if (scope !== undefined && m.scope !== scope) return null
    return m
  }

  findActiveByContent(content: string, scope?: string): Memory | null {
    const r = scope === undefined
      ? this.schema.db.prepare(`SELECT * FROM memories WHERE content = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`).get(content)
      : this.schema.db.prepare(`SELECT * FROM memories WHERE content = ? AND status = 'active' AND scope = ? ORDER BY created_at DESC LIMIT 1`).get(content, scope)
    return r ? rowToMemory(r as Record<string, unknown>) : null
  }

  updateMemory(
    id: string,
    patch: Partial<Pick<Memory, 'content' | 'activation' | 'baseWeight' | 'status' | 'metadata' | 'aspect' | 'anchor' | 'category' | 'telicity' | 'modality' | 'scope'>>,
  ): Memory | null {
    const fields: string[] = []
    const values: Record<string, string | number | null> = { id, updated_at: this.clock.now() }
    if (patch.content !== undefined) {
      fields.push('content = @content')
      fields.push('embedding = NULL')
      values.content = patch.content
    }
    if (patch.aspect !== undefined) { fields.push('aspect = @aspect'); values.aspect = patch.aspect }
    if (patch.anchor !== undefined) { fields.push('anchor_json = @anchor_json'); values.anchor_json = JSON.stringify(patch.anchor) }
    if (patch.category !== undefined) { fields.push('category = @category'); values.category = patch.category }
    if (patch.telicity !== undefined) { fields.push('telicity = @telicity'); values.telicity = patch.telicity }
    if (patch.modality !== undefined) { fields.push('modality = @modality'); values.modality = patch.modality }
    if (patch.activation !== undefined) { fields.push('activation = @activation'); values.activation = patch.activation }
    if (patch.baseWeight !== undefined) { fields.push('base_weight = @base_weight'); values.base_weight = patch.baseWeight }
    if (patch.scope !== undefined) { fields.push('scope = @scope'); values.scope = patch.scope }
    if (patch.status !== undefined) { fields.push('status = @status'); values.status = patch.status }
    if (patch.metadata !== undefined) { fields.push('metadata = @metadata'); values.metadata = JSON.stringify(patch.metadata) }
    fields.push('updated_at = @updated_at')
    let changes = 0
    this.tx(() => {
      const r = this.schema.db
        .prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = @id`)
        .run(values)
      changes = Number(r.changes)
      if (changes > 0 && patch.content !== undefined) {
        if (this.schema.vecEnabled) this.schema.db.prepare(`DELETE FROM memories_vec WHERE id = ?`).run(id)
        this.indexMemory(id, patch.content)
      }
    })
    return changes > 0 ? this.getMemory(id) : null
  }

  /** Soft delete: status=deleted, row retained (recoverable). */
  softDelete(id: string): boolean {
    const now = this.clock.now()
    let changes = 0
    this.tx(() => {
      const r = this.schema.db
        .prepare(`UPDATE memories SET status='deleted', updated_at=? WHERE id=? AND status!='deleted'`)
        .run(now, id)
      changes = Number(r.changes)
      if (changes > 0) {
        if (this.schema.vecEnabled) this.schema.db.prepare(`DELETE FROM memories_vec WHERE id = ?`).run(id)
        this.unindexMemory(id)
      }
    })
    return changes > 0
  }

  /** Restore a soft-deleted/suppressed row; re-index FTS and vector. */
  restore(id: string): Memory | null {
    const m = this.getMemory(id)
    if (!m) return null
    if (m.status === 'active') return m
    const activation = m.baseWeight > 0 ? m.baseWeight : 1
    this.tx(() => {
      this.schema.db
        .prepare(`UPDATE memories SET status='active', activation=?, updated_at=? WHERE id=?`)
        .run(activation, this.clock.now(), id)
      this.indexMemory(id, m.content)
      if (this.schema.vecEnabled && m.embedding && m.embedding.byteLength === this.schema.dim * 4) {
        this.schema.db.prepare(`DELETE FROM memories_vec WHERE id = ?`).run(id)
        this.schema.db.prepare(`INSERT INTO memories_vec (id, embedding) VALUES (?, ?)`).run(id, Buffer.from(m.embedding))
      }
    })
    return this.getMemory(id)
  }

  /** Hard delete (right-to-be-forgotten / reclaim): rows, vectors, FTS, links. */
  hardDelete(id: string): boolean {
    const exists = this.schema.db.prepare(`SELECT id FROM memories WHERE id = ?`).get(id)
    if (!exists) return false
    this.tx(() => {
      this.schema.db.prepare(`DELETE FROM links WHERE src=? OR dst=?`).run(id, id)
      if (this.schema.vecEnabled) this.schema.db.prepare(`DELETE FROM memories_vec WHERE id = ?`).run(id)
      this.unindexMemory(id)
      this.schema.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id)
    })
    this.emit('memory.purge', id, {})
    return true
  }

  listByAspectStatus(aspect: Aspect, status: MemoryStatus, scope?: string): Memory[] {
    const rows = scope === undefined
      ? this.schema.db
        .prepare(`SELECT * FROM memories WHERE aspect=? AND status=? ORDER BY created_at`)
        .all(aspect, status) as Record<string, unknown>[]
      : this.schema.db
        .prepare(`SELECT * FROM memories WHERE aspect=? AND status=? AND scope=? ORDER BY created_at`)
        .all(aspect, status, scope) as Record<string, unknown>[]
    return rows.map(rowToMemory)
  }

  /**
   * Vector KNN. With sqlite-vec this is an index query; when the extension is
   * unavailable (unsupported platform / missing optional dependency), fall
   * back to exact cosine over the embeddings stored in the `memories` column.
   * That keeps retrieval, conflict resolution and evidence evolution alive.
   */
  vectorNeighbors(embedding: Float32Array, k: number): Array<{ id: string; distance: number }> {
    if (!this.schema.vecEnabled) {
      const rows = this.schema.db
        .prepare(`SELECT id, embedding FROM memories WHERE embedding IS NOT NULL AND status!='deleted'`)
        .all() as Array<{ id: string; embedding: Uint8Array }>
      const scored: Array<{ id: string; distance: number }> = []
      for (const row of rows) {
        if (row.embedding.byteLength !== this.schema.dim * 4) continue
        const sim = cosineF32(embedding, blobToF32(row.embedding))
        scored.push({ id: row.id, distance: 1 - sim })
      }
      scored.sort((a, b) => a.distance - b.distance)
      return scored.slice(0, k)
    }
    const rows = this.schema.db
      .prepare(`SELECT id, distance FROM memories_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?`)
      .all(Buffer.from(embedding.buffer), k) as Array<{ id: string; distance: number }>
    return rows
  }

  /** Set/replace embedding (vec0 has no upsert: delete-then-insert). */
  setEmbedding(id: string, vec: Float32Array): boolean {
    const embedding = this.acceptedEmbedding(vec)
    if (!embedding) return false
    const buf = Buffer.from(embedding.buffer)
    let found = false
    this.tx(() => {
      const r = this.schema.db
        .prepare(`UPDATE memories SET embedding = ?, updated_at = ? WHERE id = ?`)
        .run(buf, this.clock.now(), id)
      found = Number(r.changes) > 0
      if (found && this.schema.vecEnabled) {
        this.schema.db.prepare(`DELETE FROM memories_vec WHERE id = ?`).run(id)
        this.schema.db.prepare(`INSERT INTO memories_vec (id, embedding) VALUES (?, ?)`).run(id, buf)
      }
    })
    return found
  }

  /** Drop a stale vector after a content update whose re-embed failed. */
  clearEmbedding(id: string): boolean {
    let found = false
    this.tx(() => {
      const r = this.schema.db
        .prepare(`UPDATE memories SET embedding = NULL, updated_at = ? WHERE id = ?`)
        .run(this.clock.now(), id)
      found = Number(r.changes) > 0
      if (found && this.schema.vecEnabled) this.schema.db.prepare(`DELETE FROM memories_vec WHERE id = ?`).run(id)
    })
    return found
  }

  listMissingEmbeddings(limit = 100): Array<{ id: string; content: string; scope: string }> {
    return this.schema.db
      .prepare(`SELECT id, content, scope FROM memories WHERE embedding IS NULL AND status='active' ORDER BY created_at LIMIT ?`)
      .all(limit) as Array<{ id: string; content: string; scope: string }>
  }

  // ── memory FTS ──────────────────────────────────────────────────────

  /** Lexical memory search: trigram FTS for CJK + tokenizer FTS for Latin. */
  searchMemoriesLexical(query: string, limit = 20, scope?: string): Array<{ id: string; content: string }> {
    const q = query.trim()
    if (!q) return []
    if ([...q].length < 3) {
      const rows = scope === undefined
        ? this.schema.db.prepare(`SELECT id, content FROM memories WHERE content LIKE ? AND status!='deleted' ORDER BY updated_at DESC LIMIT ?`).all(`%${q}%`, limit)
        : this.schema.db.prepare(`SELECT id, content FROM memories WHERE content LIKE ? AND status!='deleted' AND scope=? ORDER BY updated_at DESC LIMIT ?`).all(`%${q}%`, scope, limit)
      return rows as Array<{ id: string; content: string }>
    }
    const seen = new Set<string>()
    const out: Array<{ id: string; content: string }> = []
    const esc = `"${q.replaceAll('"', '""')}"`
    const fetchLimit = scope === undefined ? limit : Math.max(limit * 5, limit)
    const zh = this.schema.db
      .prepare(`SELECT id, content FROM memories_fts_zh WHERE memories_fts_zh MATCH ? LIMIT ?`)
      .all(esc, fetchLimit) as Array<{ id: string; content: string }>
    for (const r of zh) {
      if (!seen.has(r.id)) { seen.add(r.id); out.push(r) }
    }
    if (out.length < fetchLimit) {
      const en = this.schema.db
        .prepare(`SELECT id, content FROM memories_fts WHERE memories_fts MATCH ? LIMIT ?`)
        .all(esc, fetchLimit - out.length) as Array<{ id: string; content: string }>
      for (const r of en) {
        if (!seen.has(r.id)) { seen.add(r.id); out.push(r) }
      }
    }
    if (scope === undefined) return out.slice(0, limit)
    return out.filter((r) => this.getMemory(r.id)?.scope === scope).slice(0, limit)
  }

  // ── links ───────────────────────────────────────────────────────────

  insertLink(src: string, dst: string, rel: LinkRel, source: string, weight = 1.0): number {
    const r = this.schema.db
      .prepare(`INSERT INTO links (src, dst, rel, weight, source, created_at) VALUES (?,?,?,?,?,?)`)
      .run(src, dst, rel, weight, source, this.clock.now())
    return Number(r.lastInsertRowid)
  }

  listLinksOf(id: string): Array<{ id: number; src: string; dst: string; rel: LinkRel; weight: number; source: string }> {
    return this.schema.db
      .prepare(`SELECT * FROM links WHERE src=? OR dst=?`)
      .all(id, id) as never
  }

  /** Contradictions where both endpoints are still active (review queue). */
  listActiveContradictions(scope?: string): Array<{ src: string; dst: string }> {
    const sql = `SELECT l.src AS src, l.dst AS dst
      FROM links l
      JOIN memories a ON a.id = l.src
      JOIN memories b ON b.id = l.dst
      WHERE l.rel='contradicts' AND a.status='active' AND b.status='active'
      ${scope === undefined ? '' : 'AND a.scope=? AND b.scope=?'}
      GROUP BY l.src, l.dst`
    return (scope === undefined ? this.schema.db.prepare(sql).all() : this.schema.db.prepare(sql).all(scope, scope)) as Array<{ src: string; dst: string }>
  }

  // ── conversations ───────────────────────────────────────────────────

  insertConversation(sessionId: string, peer: string, content: string): number {
    const r = this.schema.db
      .prepare(`INSERT INTO conversations (session_id, peer, content, created_at) VALUES (?,?,?,?)`)
      .run(sessionId, peer, content, this.clock.now())
    const id = Number(r.lastInsertRowid)
    this.schema.db.prepare(`INSERT INTO conversations_fts (rowid, content) VALUES (?,?)`).run(id, content)
    this.schema.db.prepare(`INSERT INTO conversations_fts_zh (rowid, content) VALUES (?,?)`).run(id, content)
    return id
  }

  /** Session increment (input for derive/extract): messages after createdAfter. */
  listConversationsSince(sessionId: string, createdAfter: number, limit = 200): Array<{ id: number; peer: string; content: string; createdAt: number }> {
    return this.schema.db
      .prepare(`SELECT id, peer, content, created_at FROM conversations WHERE session_id=? AND created_at>? ORDER BY id LIMIT ?`)
      .all(sessionId, createdAfter, limit) as never
  }

  /** Collision-safe derive cursor query (id is monotonic; timestamps are not). */
  listConversationsAfterId(sessionId: string, afterId: number, limit = 200): Array<{ id: number; peer: string; content: string; createdAt: number }> {
    return this.schema.db
      .prepare(`SELECT id, peer, content, created_at FROM conversations WHERE session_id=? AND id>? ORDER BY id LIMIT ?`)
      .all(sessionId, afterId, limit) as never
  }

  listRecentUserTexts(since: number, limit = 200): string[] {
    return (this.schema.db
      .prepare(`SELECT content FROM conversations WHERE peer='user' AND created_at>=? ORDER BY id DESC LIMIT ?`)
      .all(since, limit) as Array<{ content: string }>).map((r) => r.content)
  }

  getDeriveCursor(sessionId: string): number {
    const r = this.schema.db.prepare(`SELECT last_conversation_id FROM derive_cursors WHERE session_id=?`).get(sessionId) as { last_conversation_id: number } | undefined
    return r?.last_conversation_id ?? 0
  }

  setDeriveCursor(sessionId: string, lastConversationId: number): void {
    this.schema.db
      .prepare(`INSERT INTO derive_cursors (session_id, last_conversation_id, updated_at) VALUES (?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET last_conversation_id=excluded.last_conversation_id, updated_at=excluded.updated_at`)
      .run(sessionId, lastConversationId, this.clock.now())
  }

  /** Full-text search over conversations: trigram FTS for CJK + tokenizer FTS
   *  for Latin; merge, dedupe. Short queries (<3 chars) fall back to LIKE. */
  searchConversations(query: string, limit = 20): Array<{ id: number; content: string }> {
    const seen = new Set<number>()
    const out: Array<{ id: number; content: string }> = []
    if ([...query].length < 3) {
      return this.schema.db
        .prepare(`SELECT id, content FROM conversations WHERE content LIKE ? ORDER BY id DESC LIMIT ?`)
        .all(`%${query}%`, limit) as Array<{ id: number; content: string }>
    }
    const zh = this.schema.db
      .prepare(`SELECT rowid AS id, content FROM conversations_fts_zh WHERE conversations_fts_zh MATCH ? LIMIT ?`)
      .all(`"${query.replaceAll('"', '""')}"`, limit) as Array<{ id: number; content: string }>
    for (const r of zh) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r) } }
    if (out.length < limit) {
      const en = this.schema.db
        .prepare(`SELECT rowid AS id, content FROM conversations_fts WHERE conversations_fts MATCH ? LIMIT ?`)
        .all(`"${query.replaceAll('"', '""')}"`, limit - out.length) as Array<{ id: number; content: string }>
      for (const r of en) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r) } }
    }
    return out
  }

  // ── events ──────────────────────────────────────────────────────────

  /** Audit trail. events table is the primary channel; JSONL file (if
   *  configured) is best-effort and never blocks the write path. */
  emit(type: string, target: string | null, detail: Record<string, unknown> | null, clause?: string): void {
    this.schema.db
      .prepare(`INSERT INTO events (ts, type, target, detail, clause) VALUES (?,?,?,?,?)`)
      .run(this.clock.now(), type, target, detail ? JSON.stringify(detail) : null, clause ?? null)
    if (this.auditLogPath) {
      try {
        fs.appendFileSync(
          this.auditLogPath,
          JSON.stringify({ ts: this.clock.now(), type, target, detail, clause }) + '\n',
          'utf8',
        )
      } catch {
        /* JSONL degrade: events table unaffected */
      }
    }
  }
}
