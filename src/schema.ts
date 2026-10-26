/**
 * ForeSight schema — SQLite DDL, idempotent migration, sqlite-vec loading.
 * Design contract: docs/design.md §7.
 *
 * Four tables:
 *   memories      memory entries (hybrid: structured cols + vector + metadata bag)
 *   links         edges between memories
 *   conversations raw session messages (twice FTS-indexed)
 *   events        append-only audit trail
 *   derive_cursors durable per-session derive high-water mark
 * Plus FTS5 shadow tables, a derive cursor table, and one sqlite-vec vec0
 * virtual table.
 *
 * SQLite access: built-in `node:sqlite` (no native module -- runs identically
 * under plain Node and the Electron runtime; sqlite-vec loaded as an extension).
 */
import './runtime-guard.js'
import { DatabaseSync } from 'node:sqlite'
import * as sqliteVec from 'sqlite-vec'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { EMBED_DIM } from './defaults.js'

export interface Schema {
  db: DatabaseSync
  dbPath: string
  /** Embedding dimension fixed by the vec0 table. */
  dim: number
  /** False when sqlite-vec could not be loaded (FTS + stored-vector cosine still work). */
  vecEnabled: boolean
}

/** Open (or create) the database, apply DDL, load sqlite-vec. Idempotent. */
export function openDatabase(dbPath: string, dim = EMBED_DIM): Schema {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath, { allowExtension: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.enableLoadExtension(true)
  let vecEnabled = false
  try {
    db.loadExtension(sqliteVec.getLoadablePath())
    vecEnabled = true
  } catch (e) {
    console.warn(
      `[foresight] sqlite-vec unavailable (${(e as Error).message}); vector index disabled, FTS + stored-embedding cosine fallback active`,
    )
  }
  migrate(db, dim, vecEnabled)
  const vec = db.prepare(`SELECT sql FROM sqlite_master WHERE name='memories_vec'`).get() as { sql?: string } | undefined
  if (vecEnabled && vec?.sql && !vec.sql.includes(`float[${dim}]`)) {
    throw new Error(
      `embedding dimension mismatch: existing memories_vec is not float[${dim}] (set FORESIGHT_EMBED_DIM or rebuild the DB)`,
    )
  }
  if (vecEnabled) backfillVecIndex(db, dim)
  return { db, dbPath, dim, vecEnabled }
}

/**
 * The vec table may be empty while embeddings already exist in the memories
 * column (database created while sqlite-vec was unavailable, or a migration
 * that created the table later). Populate only the missing ids.
 */
function backfillVecIndex(db: DatabaseSync, dim: number): void {
  const table = db.prepare(`SELECT name FROM sqlite_master WHERE name='memories_vec'`).get()
  if (!table) return
  const withVec = (db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE embedding IS NOT NULL`).get() as { n: number }).n
  const inVec = (db.prepare(`SELECT COUNT(*) AS n FROM memories_vec`).get() as { n: number }).n
  if (withVec === inVec) return
  const present = new Set(
    (db.prepare(`SELECT id FROM memories_vec`).all() as Array<{ id: string }>).map((r) => r.id),
  )
  const rows = db.prepare(`SELECT id, embedding FROM memories WHERE embedding IS NOT NULL`).all() as Array<{
    id: string
    embedding: Uint8Array
  }>
  const insert = db.prepare(`INSERT INTO memories_vec (id, embedding) VALUES (?, ?)`)
  for (const row of rows) {
    if (present.has(row.id)) continue
    if (row.embedding.byteLength !== dim * 4) continue
    try {
      insert.run(row.id, Buffer.from(row.embedding))
    } catch {
      /* one corrupt vector must not prevent the database from opening */
    }
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS memories (
  id           TEXT PRIMARY KEY,
  content      TEXT NOT NULL,
  aspect       TEXT NOT NULL,
  anchor_json  TEXT NOT NULL DEFAULT '{"type":"none"}',
  category     TEXT,
  telicity     TEXT,
  modality     TEXT,
  activation   REAL NOT NULL DEFAULT 1.0,
  base_weight  REAL NOT NULL DEFAULT 1.0,
  source       TEXT NOT NULL,
  source_ref   TEXT,
  scope        TEXT NOT NULL DEFAULT 'global',
  status       TEXT NOT NULL DEFAULT 'active',
  metadata     TEXT NOT NULL DEFAULT '{}',
  embedding    BLOB,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_aspect_status ON memories(aspect, status);
CREATE INDEX IF NOT EXISTS idx_memories_activation ON memories(activation);
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_scope_status ON memories(scope, status);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  src        TEXT NOT NULL,
  dst        TEXT NOT NULL,
  rel        TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1.0,
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(src);
CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  peer       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  type   TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  clause TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS derive_cursors (
  session_id            TEXT PRIMARY KEY,
  last_conversation_id  INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(content);
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts_zh USING fts5(content, tokenize='trigram');

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts_zh USING fts5(id UNINDEXED, content, tokenize='trigram');
`

const EMBED_DDL = (dim: number): string => `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[${dim}]
);
`

/** Migrate: idempotent DDL, version recorded in PRAGMA user_version. */
function migrate(db: DatabaseSync, dim: number, vecEnabled: boolean): void {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (current < 1) {
    db.exec(DDL)
    if (vecEnabled) db.exec(EMBED_DDL(dim))
  }
  if (current < 2) {
    // v1 → v2: scoped memories, memory FTS, durable derive cursors.
    const cols = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'scope')) {
      db.exec(`ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'`)
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_scope_status ON memories(scope, status)')
    db.exec('CREATE TABLE IF NOT EXISTS derive_cursors (session_id TEXT PRIMARY KEY, last_conversation_id INTEGER NOT NULL, updated_at INTEGER NOT NULL)')
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content)')
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts_zh USING fts5(id UNINDEXED, content, tokenize='trigram')")
    const ftsCount = (db.prepare('SELECT count(*) AS n FROM memories_fts').get() as { n: number }).n
    if (ftsCount === 0) {
      db.exec('INSERT INTO memories_fts(id, content) SELECT id, content FROM memories')
      db.exec('INSERT INTO memories_fts_zh(id, content) SELECT id, content FROM memories')
    }
    db.exec('PRAGMA user_version = 2')
  }
  // Existing databases created before the extension was available still get
  // the vec table when the extension later loads; if it never does, FTS and
  // stored-embedding cosine keep retrieval functional.
  if (vecEnabled) db.exec(EMBED_DDL(dim))
}

export function closeDatabase(schema: Schema): void {
  schema.db.close()
}
