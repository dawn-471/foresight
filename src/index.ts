/**
 * ForeSight main plugin: registers the core service on the cordis context.
 * Other plugins (tools/inject/nudge/observer/server) inject this service.
 * Pure dsh/cordis boundary — all domain logic lives under src/ scope,
 * and nothing here imports user data.
 */
import './runtime-guard.js'
import { ForeSight, type ForeSightOptions } from './core.js'

export const name = 'foresight-core'

export interface ForesightPluginConfig extends Partial<ForeSightOptions> {
  memoryRoot?: string
}

export function apply(ctx: { provide: (key: string, value: unknown) => void }, config: ForesightPluginConfig = {}) {
  // Leave memoryRoot undefined unless the adapter explicitly sets it:
  // ForeSight's resolveConfig then applies FORESIGHT_MEMORY_DIR, then the
  // platform default (%APPDATA%/foresight or $XDG_DATA_HOME/foresight).
  // A cwd-relative './memory' default here would silently bypass both.
  const fs = new ForeSight({
    memoryRoot: config.memoryRoot,
    dbFile: config.dbFile,
    embedBaseUrl: config.embedBaseUrl,
    embedModel: config.embedModel,
    embedDim: config.embedDim,
    embedFailureThreshold: config.embedFailureThreshold,
    embedCooldownMs: config.embedCooldownMs,
    clock: config.clock,
  })
  ctx.provide('foresight', fs)
  void fs.backfillEmbeddings().catch(() => undefined)
  return () => fs.close()
}

// Re-export domain types & the container for consumers.
export type { Policy, Aspect, Anchor, MemoryStatus, MemorySource } from './types.js'
export { ForeSight } from './core.js'
