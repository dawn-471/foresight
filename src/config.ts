/**
 * ForeSight config — resolution chain.
 *
 * Precedence (highest first):
 *   1. explicit constructor options (from platform adapter / CLI)
 *   2. environment variables  FORESIGHT_*
 *   3. defaults.ts            (cross-platform safe defaults)
 *
 * `policy.yaml` lives *inside* memoryRoot, so it cannot supply memoryRoot
 * itself; it is intentionally not part of this chain.
 *
 * Machine-dependent values (paths, URLs, model names) NEVER appear in source
 * outside defaults.ts; users override through env or their own policy file.
 */
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {
  DEFAULT_DB_FILE,
  DEFAULT_EMBED_BASE_URL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_FAILURE_THRESHOLD,
  DEFAULT_EMBED_COOLDOWN_MS,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  EMBED_DIM,
} from './defaults.js'

export interface Config {
  /** Data directory (SOUL.md / IMPORTANT.md / policy.yaml / foresight.db). */
  memoryRoot: string
  dbFile: string
  embedBaseUrl: string
  embedModel: string
  /** Embedding dimension fixed when the vec0 table is created. */
  embedDim: number
  /** Consecutive Ollama failures before the embed circuit opens. */
  embedFailureThreshold: number
  /** How long the embed circuit stays open (ms). */
  embedCooldownMs: number
  llmBaseUrl: string
  llmModel: string
}

function env(name: string): string | undefined {
  return process.env[name]
}

function hasState(dir: string): boolean {
  return ['policy.yaml', 'foresight.db', 'IMPORTANT.md', 'user.md', 'SOUL.md']
    .some((name) => fs.existsSync(path.join(dir, name)))
}

/** Platform default data dir: %LOCALAPPDATA%/foresight on Windows,
 *  $XDG_DATA_HOME/foresight or ~/.local/share/foresight otherwise.
 *
 *  SQLite + WAL should not live in a roaming profile (enterprise sync can
 *  corrupt it), so new installs use LocalAppData. Existing Roaming data is
 *  detected and kept in place rather than silently "moving" and appearing
 *  lost; users can move it explicitly after backing up. */
export function defaultMemoryRoot(): string {
  if (process.platform === 'win32') {
    const localBase = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    const legacyBase = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    const local = path.join(localBase, 'foresight')
    const legacy = path.join(legacyBase, 'foresight')
    const hasDb = (dir: string) => fs.existsSync(path.join(dir, 'foresight.db'))
    if (!hasState(local) && hasState(legacy)) return legacy
    // A failed first run can leave an empty Local policy.yaml while the real
    // database still lives in Roaming; prefer the directory with the database.
    if (!hasDb(local) && hasDb(legacy)) return legacy
    return local
  }
  return path.join(
    env('XDG_DATA_HOME') ?? path.join(os.homedir(), '.local', 'share'),
    'foresight',
  )
}

/**
 * Resolve the effective config. Absent value → env → default.
 * Explicit options (dsh patch config) always win, then env, then defaults.
 */
export function resolveConfig(override?: Partial<Config>): Config {
  const root = override?.memoryRoot ?? env('FORESIGHT_MEMORY_DIR') ?? defaultMemoryRoot()
  const rawDim = override?.embedDim ?? Number(env('FORESIGHT_EMBED_DIM') ?? EMBED_DIM)
  const embedDim = Number.isFinite(rawDim) && rawDim > 0 ? Math.floor(rawDim) : EMBED_DIM
  const rawThreshold = override?.embedFailureThreshold ?? Number(env('FORESIGHT_EMBED_FAILURES') ?? DEFAULT_EMBED_FAILURE_THRESHOLD)
  const rawCooldown = override?.embedCooldownMs ?? Number(env('FORESIGHT_EMBED_COOLDOWN_MS') ?? DEFAULT_EMBED_COOLDOWN_MS)
  return {
    memoryRoot: root,
    dbFile: override?.dbFile ?? env('FORESIGHT_DB_FILE') ?? DEFAULT_DB_FILE,
    embedBaseUrl: override?.embedBaseUrl ?? env('FORESIGHT_EMBED_URL') ?? DEFAULT_EMBED_BASE_URL,
    embedModel: override?.embedModel ?? env('FORESIGHT_EMBED_MODEL') ?? DEFAULT_EMBED_MODEL,
    embedDim,
    embedFailureThreshold: Number.isFinite(rawThreshold) && rawThreshold > 0 ? Math.floor(rawThreshold) : DEFAULT_EMBED_FAILURE_THRESHOLD,
    embedCooldownMs: Number.isFinite(rawCooldown) && rawCooldown >= 0 ? Math.floor(rawCooldown) : DEFAULT_EMBED_COOLDOWN_MS,
    llmBaseUrl: override?.llmBaseUrl ?? env('FORESIGHT_LLM_BASE_URL') ?? DEFAULT_LLM_BASE_URL,
    llmModel: override?.llmModel ?? env('FORESIGHT_LLM_MODEL') ?? DEFAULT_LLM_MODEL,
  }
}

/** Template files shipped in the package, copied into a fresh data dir. */
const SEED_FILES: Array<readonly [template: string, target: string]> = [
  ['policy.yaml.example', 'policy.yaml'],
  ['SOUL.md.example', 'SOUL.md'],
  ['IMPORTANT.md.example', 'IMPORTANT.md'],
]

function templatesDir(): URL {
  // lib/config.js → ../templates/ (repo root or installed package root)
  return new URL('../templates/', import.meta.url)
}

/**
 * Data directory bootstrap shim: create the directory if missing and seed any
 * missing starter file from the packaged templates. Existing files are never
 * overwritten — a user's SOUL/IMPORTANT/policy always wins.
 *
 * The seed is what makes `install → first run` work without a repo clone; it is
 * logged explicitly rather than silent. If the templates are unavailable (an
 * older package), the loader raises an actionable policy.yaml error instead.
 */
export function ensureDataDir(config: Pick<Config, 'memoryRoot'>): void {
  // A pre-created but empty directory is still a new install. Only suppress
  // optional doc seeding when the directory already contains user state
  // (policy/db/SOUL/IMPORTANT/user.md), so upgrades stay non-invasive.
  const fresh = !hasState(config.memoryRoot)
  fs.mkdirSync(config.memoryRoot, { recursive: true })
  const seeded: string[] = []
  for (const [templateName, targetName] of SEED_FILES) {
    const target = path.join(config.memoryRoot, targetName)
    if (fs.existsSync(target)) continue
    // policy.yaml is required to boot, so seed it into an existing dir too.
    // SOUL/IMPORTANT are optional context: only seed them on a genuinely new
    // data dir, so an upgrade never starts injecting template defaults into an
    // existing user's prompt.
    if (targetName !== 'policy.yaml' && !fresh) continue
    const template = new URL(templateName, templatesDir())
    if (!fs.existsSync(template)) continue
    fs.copyFileSync(template, target)
    seeded.push(targetName)
  }
  if (seeded.length > 0) {
    console.info(
      `[foresight] seeded ${seeded.join(', ')} in ${config.memoryRoot} from packaged templates; edit policy.yaml to tune behavior`,
    )
  }
}
