# ForeSight

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-blue?logo=github)](https://github.com/topics/dsh-plugin)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-black?logo=deepseek)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/github/license/dawn-471/foresight.svg)](LICENSE)
![Status: experimental](https://img.shields.io/badge/status-experimental-yellow)

**English** | [中文](README.zh-CN.md)

**A temporal-aspect long-term memory plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).**

Every memory carries explicit temporal semantics — a linguistic *aspect*
(进行体 / 完成体 / 未然体 / 恒常体 / 不确定兜底) paired with an *anchor*
(time point / interval / open / none). The framework executes lifecycle
mechanically: completion settlement at anchor expiry (an ended event becomes
a retrievable "completed" fact, never silently dropped), TTL fallback,
renewal nudge, prospective review, prediction verification, uncertain
fallback for unclassifiable content, and conflict resolution by evidence
with a single conservative/aggressive knob (β).

## The problem

Long-term memory is a data-management problem, not a prompt-engineering one.
Left unmanaged, agent memories tend to hit two familiar failure modes:

**Stale injection.** A project that ended a month ago still competes for the
injection budget as if it were current context.

**Lost valid time.** "I did that yesterday" comes back as "just now" — nothing
records when a memory is true, let alone when it stops being true.

## Why it exists

Unlike chat vendors' rolling memories, ForeSight treats memory as
**scheduled first-class data**: every implemented tunable — expiry/TTL,
renewal cadence, activation β, retrieval factor weights, injection budgets —
is read from one structured policy file (`policy.yaml`). Fields that are not
yet wired are explicitly registered as reserved in [eval/DECISIONS.md](https://github.com/dawn-471/foresight/blob/main/eval/DECISIONS.md) §13
(no silent decoration).

ForeSight approaches this with two axes borrowed from linguistics:

| Axis | Values | What it controls |
|---|---|---|
| 体 (aspect) | progressive / perfect / prospective / gnomic / uncertain | lifecycle: expires, permanent, to-verify, retrieved like any fact, reclassifiable |
| 锚 (anchor) | none / point / interval / open | when the statement is true (valid time) |

In plain terms, **体** says *what stage a fact is at* — 进行体: "I am writing
the report" (ongoing, ends someday → settles to completed); 完成体: "the
report is submitted" (concluded, permanent); 未然体: "due next week" (pending,
gets verified later); 恒常体: "I drink coffee daily" (timeless — stored like
any other aspect and retrieved by relevance; only *globally* important facts
go to the always-injected IMPORTANT.md); 不确定: unclassifiable content is
parked in a fallback bucket instead of being dropped. **锚** says *when it is
true* — a point ("Aug 20"), an interval ("during my third year"), open
("since March"), or none (timeless).

A few design choices worth noting:

- The aspect taxonomy draws on established linguistic notions, but it is a
  deliberately minimal starting point rather than a complete theory — the
  schema is configurable (`policy.yaml`) and expected to evolve with use.
- The core is agent-agnostic: dsh is one adapter (the `src/` cordis plugins). Embedding
  and LLM services are pluggable interfaces — the default is local Ollama, and
  rules-based fallbacks keep the lifecycle running without a model at all.
- The lifecycle is executed by mechanism, not by model judgment: expiry,
  injection eligibility and conflict resolution are driven by policy; the
  optional LLM is used for classification/derivation only. However, this is an
  early exploratory implementation — the taxonomy, the policy model and the
  mechanics are all under active revision.

## Requirements

- Node.js ≥ 22.13 (`node:sqlite` is unflagged from this version)
- DeepSeek Harness (dsh) 0.2.0-rc.2+ with the [cordis](https://github.com/deepseek-ai/cordis) plugin system; the desktop app must ship an Electron runtime with Node ≥ 22.13
- An embedding backend (default: [Ollama](https://ollama.com/) with
  `nomic-embed-text-v2-moe`, 768-dim)
- (Optional) An LLM API for classification/derivation (default:
  DeepSeek compatible API; rules-based fallbacks exist)
- Supported platforms follow `sqlite-vec`'s prebuilt binaries: Windows x64,
  Linux x64/arm64, macOS x64/arm64. On other platforms ForeSight degrades to
  FTS + stored-embedding cosine instead of failing to load.

## Installation (dsh profile)

Published npm package is pending. Install a built release tarball (or a local
build) through dsh's plugin command so the bundle patch is registered:

```bash
# from a GitHub release / local build
dsh plugin --profile <name> add "file:/path/to/foresight-memory-0.2.0.tgz"
```

`package.json` ships `dsh.bundle.patch`, so the six entries (core / tools /
inject / nudge / observer / server) are inserted automatically; do not add
them a second time. To use a custom data directory, override only the core
config in the profile patch:

```yaml
# cordis.patch.yml (profile-level)
- id: foresight-core
  config:
    memoryRoot: '<absolute data directory>'   # optional; default is platform-specific
```

A profile patch replaces the whole `foresight-core` config (not a deep merge),
so repeat any non-default `dbFile`/`embedBaseUrl`/`embedModel` values you need.

If you build from source, `pnpm install` runs the `prepare` script and compiles
`lib/`; `npm pack` / `pnpm pack` also runs `prepare`, so the tarball always contains
the compiled entry points and `templates/`.

Bundle/config changes hot-load, but code changes in `lib/*.js` require a dsh
restart or a new session — do not use a running session to validate a rebuilt
plugin.

## Configuration — where does my data go?

**Your data lives OUTSIDE the repo, in your own data directory.** The plugin
never ships any user data; the repository is pure code + templates.

### Data directory layout

```
<memoryRoot>/
├── SOUL.md          # personality (seeded from templates/SOUL.md.example)
├── IMPORTANT.md     # globally-important facts, always injected (seeded)
├── policy.yaml      # all tunables (seeded; edit this)
└── foresight.db     # SQLite store (created automatically)
```

On first run ForeSight creates the directory and **seeds missing starter files
from the packaged `templates/`** — `policy.yaml` always (it is required to
boot), and `SOUL.md`/`IMPORTANT.md` when the data directory is new. It logs what
it created; existing files are never overwritten. Edit `policy.yaml` to tune
behavior; there is no separate copy step for a package install.

### Resolution chain

`explicit options (adapter) → environment variables → defaults`

(`policy.yaml` lives inside `memoryRoot`, so it cannot supply `memoryRoot`
itself.)

| Setting | Env var | Default |
|---|---|---|
| data directory | `FORESIGHT_MEMORY_DIR` | `%LOCALAPPDATA%/foresight` (win; legacy `%APPDATA%` fallback) / `~/.local/share/foresight` (unix) |
| db file | `FORESIGHT_DB_FILE` | `foresight.db` |
| embed URL | `FORESIGHT_EMBED_URL` | `http://localhost:11434` |
| embed model | `FORESIGHT_EMBED_MODEL` | `nomic-embed-text-v2-moe` |
| embed dimension | `FORESIGHT_EMBED_DIM` | `768` |
| embed breaker failures | `FORESIGHT_EMBED_FAILURES` | `3` |
| embed breaker cooldown (ms) | `FORESIGHT_EMBED_COOLDOWN_MS` | `30000` |
| LLM base URL | `FORESIGHT_LLM_BASE_URL` | `https://api.deepseek.com/v1` |
| LLM model | `FORESIGHT_LLM_MODEL` | `deepseek-flash` |

### Runtime wiring

- **Ingestion**: at `turn/end` the observer writes the transcript and sends each
  user/assistant turn through the same write gate (salience, classification,
  embedding, exact-content dedup, conflict resolution). Gate failures are logged
  and never block the session. Derive runs every `derive.every_n_turns` turns.
- **Tools**: `@foresight/memory/tools` registers `memory_write`, `memory_update`,
  `memory_delete`, `memory_restore`, `memory_renew`, `memory_query` and
  `memory_reason` on `ctx.tools`. Updates re-embed; deletes are
  soft/recoverable; renew extends progressive/prospective windows; hard purge
  is root-only.
- **Injection**: the memories section is produced by the retrieval path over
  every stored aspect (progressive / perfect / prospective / gnomic / uncertain),
  ranked by the latest user turn; completed rows render as 「已完成」. The
  retrieval tool and the system prompt therefore see the same memories.
- **Scopes**: dsh/tools/injection/nudge use the `global` scope. The HTTP server
  derives a scope from `x-foresight-peer`, so multi-agent writes and reads are
  isolated from each other and from the dsh `global` pool. Use
  `server.peer_tokens` for per-peer credentials; otherwise the shared token is a
  single trust boundary. Run it on loopback.
- **Management API**: `PATCH /v1/memories/:id`, `DELETE /v1/memories/:id`
  (`?purge=1` root-only), `POST /v1/memories/:id/restore` and
  `POST /v1/memories/:id/renew`; GET hides soft-deleted rows unless a root peer
  asks for them.
- **Retrieval**: semantic vectors plus memory FTS (CJK trigram + Latin), with
  exact-content dedup and startup backfill for rows written while the embedder
  was down. Embedding calls use a circuit breaker (`FORESIGHT_EMBED_FAILURES`,
  `FORESIGHT_EMBED_COOLDOWN_MS`): after repeated Ollama failures, calls fail
  fast instead of adding a timeout to every turn; writes continue vectorless and
  are repaired by backfill later.

### Policy file

`policy.yaml` is the single source of truth for the **implemented** tunables:
permission matrix, aspect lifecycle (TTL/renewal/anchor rendering), gate
categories, activation β and decay constants, retrieval factor weights
(frozen: 0.40/0.20/0.25/0.15), injection budgets, nudge cadence, server
port/token. Fields without an executor are explicitly listed as reserved in
[eval/DECISIONS.md](https://github.com/dawn-471/foresight/blob/main/eval/DECISIONS.md) §13. **You decide** your assistant's personality,
profile, and memory policy — none of it is baked into the code.

## Upgrading from 0.1.x (policy v3)

v0.2.0 ships `policy_version: 4`. A v3 policy still boots: the loader maps it
in memory, logs a warning, and fills the v4-only keys (`uncertain`,
`transitions`, `gate.fallback_write`) from the shipped template. To rewrite the
file explicitly (with a backup) and to merge a legacy `user.md` into
`IMPORTANT.md`:

```bash
# from a repo checkout
node scripts/migrate-policy.mjs <memoryRoot>          # dry run: writes policy.yaml.v4-<ts>
node scripts/migrate-policy.mjs <memoryRoot> --write  # backup + replace + merge user.md

# from an installed package (inside the dsh profile)
node node_modules/@foresight/memory/scripts/migrate-policy.mjs <memoryRoot> --write
```

The runtime also merges `IMPORTANT.md` and `user.md` during the transition, so
creating the new file never hides the old profile. v4 changes gnomic storage
from the old doc/always behavior to memory/conditional — review the generated
policy rather than assuming the defaults are your intent.

**Data-directory change:** the package bundle patch no longer ships
`memoryRoot: './memory'`. If your existing install relied on the old
cwd-relative directory, keep it by setting `memoryRoot` to that absolute path in
the profile patch before upgrading; otherwise the plugin starts using the
platform default (`%LOCALAPPDATA%/foresight` or `$XDG_DATA_HOME/foresight`).
On Windows, an existing `%APPDATA%/foresight` directory is detected and kept in
place (Roaming is not auto-migrated because SQLite WAL can be corrupted by
profile sync); back it up and set `memoryRoot` explicitly if you want to move it.

## Uninstall

1. `dsh plugin --profile <name> remove @foresight/memory` (or run `pnpm remove`
   in the profile), which updates `package.json` and the lockfile.
2. Remove the package from the profile's `dsh.profile.bundles` list and delete
   the `foresight-core` entry from the profile-level `cordis.patch.yml`.
3. Remove any `FORESIGHT_*` environment variables and the data directory you
   configured (`%LOCALAPPDATA%/foresight`, legacy `%APPDATA%/foresight`,
   `$XDG_DATA_HOME/foresight`, or a custom absolute `memoryRoot`). It contains
   `foresight.db`, `-wal`/`-shm`, and the audit log if enabled.
4. If you used `dsh plugin allow-version`, remove that entry from the profile's
   `compatibility.json`.

Keeping the data directory is safe; deleting it is a hard purge.

## Layout

```
src/
├── types.ts            # domain types (aspect×anchor)
├── defaults.ts         # the ONLY place default values live
├── config.ts           # resolution chain + data dir bootstrap
├── policy.ts           # policy.yaml loader + behavior lookup
├── schema.ts           # SQLite DDL + migration + sqlite-vec
├── store.ts            # CRUD, soft-delete, vectors, FTS, audit
├── gate/               # write gate: classify + validate (aspect-text)
├── govern/             # permission model
├── evolve/             # temporal expiry/TTL, activation, β conflict
├── retrieve/           # composable scoring factors + search (3 shapes)
└── store/embed.ts      # embed provider interface (Ollama default)
```

## Verification

```bash
pnpm install
pnpm build     # tsc
pnpm test      # node --test — no external services required
```

All tests run against an in-memory/temp store and a fake embedder — the suite
passes on a clean machine with no Ollama, no API key, and no data directory.

## License

MIT
