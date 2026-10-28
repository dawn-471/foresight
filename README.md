# ForeSight

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-blue?logo=github)](https://github.com/topics/dsh-plugin)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-black?logo=deepseek)](https://github.com/deepseek-ai/deepseek-harness)
[![CI](https://github.com/dawn-471/foresight/actions/workflows/ci.yml/badge.svg)](https://github.com/dawn-471/foresight/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dawn-471/foresight?display_name=tag)](https://github.com/dawn-471/foresight/releases)
[![License: MIT](https://img.shields.io/github/license/dawn-471/foresight.svg)](LICENSE)
![Status: experimental](https://img.shields.io/badge/status-experimental-yellow)

**English** | [中文](README.zh-CN.md)

**A temporal-aspect long-term memory plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).**

Every memory carries explicit temporal semantics — a linguistic *aspect*
(进行体 / 完成体 / 未然体 / 恒常体 / 不确定兜底) paired with an *anchor*
(time point / interval / open / none). The framework executes lifecycle
mechanically: completion settlement at anchor expiry (an ended event becomes a
retrievable "completed" fact, never silently dropped), TTL fallback, renewal
nudge, prospective review, prediction verification, uncertain fallback for
unclassifiable content, and conflict resolution by evidence with a single
conservative/aggressive knob (β).

## What's new in 0.2.2

- **dsh session compatibility**: nudge reminders now use an identified message
  with a producer-owned source kind, so current dsh session encoders can persist
  them and sessions keep resuming normally. Upgrade in place; no data migration
  is required.
- **Correct derive trigger**: `session/flush` is treated as a durability
  checkpoint, not as session end; the session-end derive hook now runs on
  `session/disposed`, and both `session` and `session_end` trigger spellings are
  honored.
- **Reload-safe listeners**: nudge and inject registrations are disposed on
  plugin reload/HMR, and injected memory text is excluded from dsh prompt
  variable interpolation.

## What's new in 0.2.1

- **dsh tool-schema compatibility**: memory tools now register raw
  object-rooted JSON Schema, fixing the `memory_delete` rejection
  (`schema must be a JSON Schema of type: "object"`) on newer dsh releases.
  Upgrade the tarball in place; no data migration is needed.

## What's new in 0.2.0

- **Installable release tarball**: the published artifact contains `lib/`,
  `templates/`, the policy migration script, `CHANGELOG.md`, and the dsh bundle
  patch. `scripts/check-pack.mjs` asserts the tarball contents in CI.
- **First run works from a clean install**: a missing `policy.yaml` is seeded
  from packaged templates; `SOUL.md` and `IMPORTANT.md` are seeded for a new or
  empty data directory. Existing files are never overwritten.
- **Correct data-directory resolution**: explicit config → `FORESIGHT_MEMORY_DIR`
  → platform default. Windows now defaults to `%LOCALAPPDATA%/foresight`; an
  existing `%APPDATA%/foresight` is kept as a legacy fallback.
- **v3 → v4 compatibility**: v3 policies boot through an in-memory mapping and
  `scripts/migrate-policy.mjs` can rewrite them with a backup. Legacy `user.md`
  is merged into `IMPORTANT.md` instead of being shadowed.
- **Runtime resilience**: `sqlite-vec` load failure degrades to FTS + exact
  cosine over stored embeddings; Ollama failures trip an embedding circuit
  breaker. A Node < 22.13 guard fails fast with an actionable message.
- **Management and isolation**: update / soft-delete / restore / renew tools and
  HTTP endpoints, per-peer scopes, per-peer tokens, exact-content dedup, memory
  FTS, and embedding backfill.

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
yet wired are explicitly registered as reserved in
[eval/DECISIONS.md](https://github.com/dawn-471/foresight/blob/main/eval/DECISIONS.md)
§13 (no silent decoration).

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
go to the always-injected `IMPORTANT.md`); 不确定: unclassifiable content is
parked in a fallback bucket instead of being dropped. **锚** says *when it is
true* — a point ("Aug 20"), an interval ("during my third year"), open
("since March"), or none (timeless).

A few design choices worth noting:

- The aspect taxonomy draws on established linguistic notions, but it is a
  deliberately minimal starting point rather than a complete theory — the
  schema is configurable (`policy.yaml`) and expected to evolve with use.
- The core is agent-agnostic: dsh is one adapter (the `src/` cordis plugins).
  Embedding and LLM services are pluggable interfaces — the default is local
  Ollama, and rules-based fallbacks keep the lifecycle running without a model
  at all.
- The lifecycle is executed by mechanism, not by model judgment: expiry,
  injection eligibility and conflict resolution are driven by policy; the
  optional LLM is used for classification/derivation only. This is still an
  early exploratory implementation — the taxonomy, policy model and mechanics
  are under active revision.
- Retrieval is hybrid: SQLite FTS (CJK trigram + Latin) plus vector search,
  with exact-content dedup and a stored-embedding cosine fallback when
  `sqlite-vec` is unavailable.

## Requirements and compatibility

| Component | Requirement |
|---|---|
| Node runtime | Node.js ≥ 22.13 (`node:sqlite` is unflagged from this version) |
| dsh | DeepSeek Harness 0.2.0-rc.2+ with the [cordis](https://github.com/deepseek-ai/cordis) plugin system; desktop Electron must ship Node ≥ 22.13 |
| Embedding | Ollama (default: `nomic-embed-text-v2-moe`, 768-dim) or any compatible endpoint; optional — rules fallback works without it |
| LLM | Optional DeepSeek-compatible API for classification / derivation / dialectic reasoning |
| Vector extension | `sqlite-vec` prebuilt binaries: Windows x64, Linux x64/arm64, macOS x64/arm64. Other platforms use FTS + stored-embedding cosine instead of failing to load |

## Installation (dsh profile)

The GitHub Release tarball is the supported install path while npm publication
is pending. The bundle patch is included, so the six entries (core / tools /
inject / nudge / observer / server) are inserted automatically.

### 1. Download the release tarball

From [Releases](https://github.com/dawn-471/foresight/releases):

```bash
curl -LO https://github.com/dawn-471/foresight/releases/download/v0.2.2/foresight-memory-0.2.2.tgz
```

Windows PowerShell:

```powershell
Invoke-WebRequest `
  -Uri https://github.com/dawn-471/foresight/releases/download/v0.2.2/foresight-memory-0.2.2.tgz `
  -OutFile foresight-memory-0.2.2.tgz
```

### 2. Add it to a dsh profile

```bash
dsh plugin --profile <name> add "file:/absolute/path/to/foresight-memory-0.2.2.tgz"
```

Do not add the six entries manually: `package.json` ships `dsh.bundle.patch`.
A profile-level `cordis.patch.yml` can override only the core config, for
example a custom data directory:

```yaml
# cordis.patch.yml (profile-level)
- id: foresight-core
  config:
    memoryRoot: '<absolute data directory>'   # optional; default is platform-specific
```

A profile patch replaces the whole `foresight-core` config (not a deep merge),
so repeat any non-default `dbFile` / `embedBaseUrl` / `embedModel` values you
need.

### 3. Build from source (optional)

```bash
pnpm install       # prepare compiles lib/
pnpm build
npm pack           # tarball contains lib/, templates/, migration script, patch
```

Bundle and config changes hot-load, but code changes in `lib/*.js` require a dsh
restart or a new session. Do not validate a rebuilt plugin in an already running
session.

## First run and data location

Your data lives outside the repo, in your own data directory. The plugin never
ships user data; the repository is code + templates.

```
<memoryRoot>/
├── SOUL.md          # personality (seeded from templates/SOUL.md.example)
├── IMPORTANT.md     # globally-important facts, always injected (seeded)
├── policy.yaml      # all tunables (seeded; edit this)
└── foresight.db     # SQLite store (created automatically)
```

On first run ForeSight creates the directory and seeds missing starter files
from the packaged `templates/`: `policy.yaml` always (required to boot), and
`SOUL.md` / `IMPORTANT.md` when the directory is new or empty. Existing files
are never overwritten. The seed is logged explicitly.

### Resolution chain

`explicit options (adapter) → environment variables → platform defaults`

`policy.yaml` lives inside `memoryRoot`, so it cannot supply `memoryRoot` itself.

| Setting | Env var | Default |
|---|---|---|
| data directory | `FORESIGHT_MEMORY_DIR` | `%LOCALAPPDATA%/foresight` (Windows; legacy `%APPDATA%` fallback) / `~/.local/share/foresight` (Unix) |
| database file | `FORESIGHT_DB_FILE` | `foresight.db` |
| embedding URL | `FORESIGHT_EMBED_URL` | `http://localhost:11434` |
| embedding model | `FORESIGHT_EMBED_MODEL` | `nomic-embed-text-v2-moe` |
| embedding dimension | `FORESIGHT_EMBED_DIM` | `768` |
| breaker failure threshold | `FORESIGHT_EMBED_FAILURES` | `3` |
| breaker cooldown (ms) | `FORESIGHT_EMBED_COOLDOWN_MS` | `30000` |
| LLM base URL | `FORESIGHT_LLM_BASE_URL` | `https://api.deepseek.com/v1` |
| LLM model | `FORESIGHT_LLM_MODEL` | `deepseek-flash` |

Windows SQLite + WAL should not live in a roaming profile. New installs use
`%LOCALAPPDATA%`; an existing `%APPDATA%/foresight` directory is detected and
kept rather than silently moved. Back it up and set `memoryRoot` explicitly if
you want to relocate it.

## Runtime behavior

- **Ingestion**: at `turn/end` the observer writes the transcript and sends each
  user/assistant turn through the same write gate: salience filter, aspect
  classification, embedding, exact-content dedup, and conflict resolution.
  Gate failures are logged and never block the session. Derive runs every
  `derive.every_n_turns` turns (and at session flush).
- **Retrieval**: hybrid memory FTS + semantic vectors, lifecycle eligibility,
  structural time filtering, and the injected memories section share the same
  ranking path. Embedding calls use a circuit breaker: after repeated Ollama
  failures, calls fail fast instead of adding a 30s timeout to every turn;
  writes continue without vectors and are repaired by backfill.
- **Scopes**: dsh / tools / injection / nudge use the `global` scope. The HTTP
  server derives a scope from `x-foresight-peer`, isolating peers from each
  other and from the dsh `global` pool. Configure `server.peer_tokens` for
  per-peer credentials; otherwise the shared token is one trust boundary.
  Bind the server to loopback.
- **Derive**: conversation increments are summarized into structured facts with
  a durable per-session cursor, exact-content dedup, embedding, lifecycle plan,
  and conflict resolution. `scripts/migrate-policy.mjs` handles the v3→v4
  policy rename and `user.md` merge.
- **Nudge**: review questions for renewals, prospective/prediction verdicts,
  uncertain fallback, suppressed conflicts, and active contradictions. The
  review actions are executable through `memory_update` / `memory_delete` /
  `memory_restore` / `memory_renew`.

### Tools

| Tool | Purpose |
|---|---|
| `memory_write` | Write one fact through the full gate, dedup, embed and conflict path |
| `memory_update` | Correct content (re-embeds, keeps revision audit) |
| `memory_delete` | Soft-delete (recoverable); hard purge via root-only HTTP API |
| `memory_restore` | Restore a soft-deleted or suppressed memory |
| `memory_renew` | Extend a progressive / prospective window |
| `memory_query` | Semantic + lexical retrieval |
| `memory_reason` | Dialectic answer over retrieved evidence, with conflicts surfaced |

### HTTP API

Enabled only when `policy.server.enabled` is true.

| Endpoint | Purpose |
|---|---|
| `GET /v1/health` | Liveness (no auth) |
| `POST /v1/memories` | Write through the full gate |
| `POST /v1/memories/search` | Hybrid retrieval |
| `GET /v1/memories/:id` | Read one memory (scope-checked) |
| `PATCH /v1/memories/:id` | Update content / aspect / anchor / activation |
| `DELETE /v1/memories/:id` | Soft delete; `?purge=1` root-only hard delete |
| `POST /v1/memories/:id/restore` | Restore |
| `POST /v1/memories/:id/renew` | Renew a window |
| `POST /v1/reason` | Dialectic reasoning |

Auth uses `X-ForeSight-Token`; peer identity uses `X-ForeSight-Peer`.

## Policy file

`policy.yaml` is the single source of truth for implemented tunables: permission
matrix, aspect lifecycle (TTL / renewal / anchor rendering), gate categories and
salience, activation β and decay constants, retrieval factor weights (frozen:
0.40 / 0.20 / 0.25 / 0.15), injection budgets, nudge cadence, server port/token,
and derive routes. Fields without an executor are explicitly listed as reserved
in [eval/DECISIONS.md](https://github.com/dawn-471/foresight/blob/main/eval/DECISIONS.md)
§13. Your assistant's personality, profile and memory policy are yours to
decide; none of it is baked into the code.

## Upgrading from 0.1.x (policy v3)

v0.2.0 ships `policy_version: 4`. A v3 policy still boots: the loader maps it in
memory, logs a warning, and fills v4-only keys (`uncertain`, `transitions`,
`gate.fallback_write`) from the packaged template. To rewrite the file
explicitly (with a backup) and merge a legacy `user.md` into `IMPORTANT.md`:

```bash
# from a repo checkout
node scripts/migrate-policy.mjs <memoryRoot>          # dry run: writes policy.yaml.v4-<ts> only
node scripts/migrate-policy.mjs <memoryRoot> --write  # backup + replace + merge user.md

# from an installed package inside the dsh profile
node node_modules/@foresight/memory/scripts/migrate-policy.mjs <memoryRoot> --write
```

The runtime also merges `IMPORTANT.md` and `user.md` during the transition, so
creating the new file never hides the old profile. v4 changes gnomic storage
from the old doc/always behavior to memory/conditional — review the generated
policy rather than assuming the defaults are your intent.

**Data-directory change:** the package bundle patch no longer ships
`memoryRoot: './memory'`. If an existing install relied on that cwd-relative
directory, set `memoryRoot` to its absolute path in the profile patch before
upgrading; otherwise the platform default is used. On Windows, an existing
`%APPDATA%/foresight` is kept as a legacy fallback (Roaming is not auto-migrated
because SQLite WAL can be corrupted by profile sync).

## Uninstall

1. `dsh plugin --profile <name> remove @foresight/memory` (or `pnpm remove` in
   the profile), which updates `package.json` and the lockfile.
2. Remove the package from the profile's `dsh.profile.bundles` list and delete
   the `foresight-core` entry from the profile-level `cordis.patch.yml`.
3. Remove any `FORESIGHT_*` environment variables and the data directory you
   configured (`%LOCALAPPDATA%/foresight`, legacy `%APPDATA%/foresight`,
   `$XDG_DATA_HOME/foresight`, or a custom absolute `memoryRoot`). It contains
   `foresight.db`, `-wal` / `-shm`, and the audit log if enabled.
4. If you used `dsh plugin allow-version`, remove that entry from the profile's
   `compatibility.json`.

Keeping the data directory is safe; deleting it is a hard purge.

## Layout

```
src/
├── types.ts            # domain types (aspect × anchor)
├── defaults.ts         # the ONLY place default values live
├── config.ts           # resolution chain + first-run seeding
├── policy.ts           # policy.yaml loader, v3→v4 mapping
├── schema.ts           # SQLite DDL + migrations + sqlite-vec fallback
├── store.ts            # CRUD, soft-delete, vectors, FTS, audit
├── runtime-guard.ts    # Node ≥ 22.13 guard
├── gate/               # write gate: salience, classify, validate, dedup
├── govern/             # permission model
├── evolve/             # temporal expiry/TTL, activation, β conflict
├── retrieve/           # hybrid retrieval + composable scoring factors
├── derive/             # conversation → structured memory
├── nudge/              # temporal/conflict review questions
├── server/             # multi-peer HTTP API
├── tools.ts            # dsh tool definitions
└── store/embed.ts      # embed provider + circuit breaker

templates/              # policy / SOUL / IMPORTANT starters shipped in the tarball
scripts/migrate-policy.mjs  # explicit v3→v4 data migration (dry-run or --write)
scripts/check-pack.mjs      # tarball content guard used by CI
tests/                  # node --test suite (172 tests)
```

## Development and verification

```bash
pnpm install
pnpm build
pnpm test              # no Ollama / API key / data dir required
node scripts/check-pack.mjs
node eval/smoke.mjs    # offline mechanism smoke
```

The test suite runs against temporary stores and a fake embedder. The release
tarball is verified by `scripts/check-pack.mjs` and the CI matrix.

## Documentation

- [CHANGELOG](CHANGELOG.md)
- [Install/upgrade audit](https://github.com/dawn-471/foresight/blob/main/docs/install-feedback-audit-2026-10-25.md)
- [Policy decisions and reserved fields](https://github.com/dawn-471/foresight/blob/main/eval/DECISIONS.md)

## License

MIT
