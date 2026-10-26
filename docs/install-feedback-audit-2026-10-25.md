# ForeSight 安装反馈审计（2026-10-25）

## 审计对象与快照

- 反馈内容：desktop profile（`<home>/.dsh/profiles/desktop`）安装记录，报告 npm 404、无 `lib/`、需 tsc 构建后打 tgz、数据目录为 `<home>/AppData/Roaming/foresight`，并称六个入口可导入、未配置 Ollama 时向量检索降级、server 默认关闭。
- 被审计代码：本地 `main` = `a9a2633`（2026-10-20），工作区另有 **30 项未提交改动**（29 个修改文件 + 1 个未跟踪测试）；`origin/main` = `e043d07`（2026-10-02），本地领先 **10 个提交**。
- 关键事实：反馈里的数据文件名是 `user.md`，与 `origin/main` 一致；当前 HEAD 已改名 `IMPORTANT.md`，`policy_version` 已从 3 升到 4。**这份反馈验证的是旧版代码，不是当前 HEAD。**
- 验证方式：`npm view`、`npm pack --dry-run --json`、`pnpm build`、`node --test`（本次 172/172 通过）、以及运行时探针（memoryRoot/env、空数据目录、v3 policy、user.md/IMPORTANT.md 遮蔽、vec 降级、embed 熔断、tarball 安装）。

## 修复状态（2026-10-25）

| 项 | 状态 | 落地内容 |
|---|---|---|
| P0-1 发行链路 | 已修复（tarball） | `prepare` 构建 + `files` 补全 + `repository`/`homepage`/`bugs`/`keywords`；版本 bump 0.2.0；release tgz 已生成并验证安装；npm 发布仍为外部步骤 |
| P0-2 首次启动 | 已修复 | `templates/**` 进包；`ensureDataDir` 首次运行自动播种 policy/SOUL/IMPORTANT，已存在文件不覆盖；tarball 安装实测通过 |
| P0-3 memoryRoot | 已修复 | `src/index.ts` 不再写死 `./memory`；包内 `cordis.patch.yml` 删除 memoryRoot；`FORESIGHT_MEMORY_DIR` 实测生效 |
| P0-4 升级断裂 | 已修复（运行期） | v3 policy 内存映射到 v4；`user.md` 与 `IMPORTANT.md` 合并而非遮蔽；新增 `scripts/migrate-policy.mjs`（备份/预演/合并） |
| P0-5 反馈针对旧代码 | 已修复（本次提交） | 本会话提交 0.2.0 并打 v0.2.0 tag，反馈版本与当前代码对齐 |
| P1-6 sqlite-vec | 已修复 | 加载失败降级 `vecEnabled=false`，FTS + 已存向量余弦继续工作；DLL 缺失探针实测通过 |
| P1-7 运行时下限 | 已修复 | `runtime-guard.ts` 在 `node:sqlite` 导入前检查 Node ≥ 22.13；README 兼容矩阵 |
| P1-8 卸载步骤 | 已修复 | README 中英文补全 profile patch/lockfile/环境变量/WAL/data dir/compatibility.json |
| P1-9 CI 打包检查 | 已修复 | `scripts/check-pack.mjs` 断言 lib/templates/migrate/patch 均在 tarball；CI 已接入 |
| P1-10 版本卫生 | 已修复 | 0.2.0 + 元数据 + CHANGELOG + v0.2.0 tag；GitHub Release 上传为外部步骤 |
| P2-11/12/13 | 已修复 | P2-13 热加载说明；P2-11 Ollama embed 熔断（失败阈值/冷却，环境变量可调）；P2-12 Windows 默认改为 `%LOCALAPPDATA%` 并保留旧 Roaming 数据 |

测试：`pnpm build` + 172/172 测试通过；tarball（70 files）安装到空目录后 `apply()` 成功、自动播种、`vecEnabled=true`；sqlite-vec 缺失时 `vecEnabled=false`，候选检索/冲突使用已存向量余弦，重开时自动回填 vec；Ollama 熔断与 v3→v4 迁移脚本均有测试。

## 结论摘要

1. 报告在它针对的 `origin/main` 上基本属实；但安装方式、首次启动、升级路径三条链路都有未覆盖的硬缺口。
2. 两个 P0 已用运行时探针复现：`memoryRoot` 默认值吞掉 `FORESIGHT_MEMORY_DIR` 与平台默认；空数据目录直接 `ENOENT`。
3. 升级到当前 HEAD 会被 `policy_version` 3→4 硬拒绝；`user.md`→`IMPORTANT.md` 的兼容读取存在“新文件一出现就整体遮蔽旧文件”的风险。
4. 发行链路本身不可用：npm 404、仓库不含 `lib/`、无 `prepare`/`prepack`、无 tag/release；包内还不含 `templates/`，按 README 复制模板在安装包场景下无源可拷。

## 决策清单

### P0-1 发行链路不可用（README 的安装命令 100% 失败）

**证据**
- `npm view @foresight/memory version` → `E404`（实测，已走代理）。
- `.gitignore` 含 `/lib/`；`git ls-files lib` 为空；`package.json` 的 `files` 只有 `lib/**/*.js`、`lib/**/*.d.ts`、`cordis.patch.yml`。
- `scripts` 只有 `build`/`test`，没有 `prepare` 或 `prepack`；仓库无 tag、无 GitHub Release。
- 结论链：`pnpm add github:dawn-471/foresight` → 没有 `lib/index.js`，也没有 `prepare` 触发构建 → 入口不存在。报告里的“取源码 + tsc + 打 tgz”是当前唯一可行路径。

**影响**：任何照 README 操作的新用户都会卡在第一步；反馈者不得不自己构建，后续无法获得可复现的升级。

**可选方案**
- A. 发布 npm（需确认 `@foresight` scope 是否可用；建议版本 0.2.0，policy v4 是破坏性变更）。
- B. GitHub Release 附构建好的 `foresight-memory-0.2.0.tgz`，README 直接指向 release（不依赖 npm scope，最快）。
- C. 加 `prepare`/`prepack` 支持 git 安装；pnpm 10 对依赖生命周期脚本的限制需实测确认，不能只写文档。
- D. 提交 `lib/`（不推荐：产物与源码漂移、review 噪音大）。

**建议**：先做 B（立刻可用），再做 A（长期）；无论 A/B，都加 `prepack: pnpm build`，避免“在未构建的干净 clone 上 `npm pack` 出一个没有入口的包”。

**决定**：________________

---

### P0-2 包内没有 `templates/`，首次启动必然失败

**证据**
- `npm pack --dry-run --json`：63 个文件；`lib/` 之外只有 `LICENSE`、`README.md`、`README.zh-CN.md`、`cordis.patch.yml`、`package.json`。**没有 `templates/`。**
- README `Installation` 之后要求 `cp templates/SOUL.md.example ...`；安装后的包目录里没有这个源文件。
- `src/policy.ts` 的 `loadPolicyFromRoot` 直接 `readFileSync(<memoryRoot>/policy.yaml)`，没有自动创建。
- 运行时探针：空数据目录 → `ENOENT: no such file or directory, open '...\empty-root\policy.yaml'`。

**影响**：新用户即使解决了 P0-1，也会在首次启动时看到六个入口全部不激活（dsh 侧通常只显示 `entries did not activate`，根因是 policy 缺失）。反馈者之所以能跑通，是因为手工从仓库复制了模板，但报告没有把这个前置条件写出来。

**可选方案**
- A. `files` 加 `templates/**`，首次运行检测到 `policy.yaml` 缺失时从包内模板复制，并打印明确的初始化日志。
- B. 提供 `foresight init --root <dir>`（或 `dsh plugin ... init`）子命令，由用户显式初始化；README 改成“先 init 再启动”。
- C. 把 policy 默认值内置为代码默认，`policy.yaml` 变可选（改动最大，偏离“policy 是唯一真源”的设计）。

**建议**：A + B 组合——A 保证“装完即可用”，B 给需要审计/自定义的用户一个可控入口；至少把 ENOENT 换成“已查找 `<abs path>`，请复制模板或运行 init”的可操作错误。

**决定**：________________

---

### P0-3 `memoryRoot` 默认值吞掉 env 与平台默认

**证据**
- `src/index.ts:18`：`const memoryRoot = config.memoryRoot ?? './memory'`。
- `src/config.ts` 的 `resolveConfig` 只有在 `override.memoryRoot` 为 `undefined` 时才会走 `FORESIGHT_MEMORY_DIR` → `defaultMemoryRoot()`；`index.ts` 永远传值，所以后两级永远不生效。
- 运行时探针（设置 `FORESIGHT_MEMORY_DIR` 后调用 `apply`）：
  - `resolved memoryRoot = ./memory`
  - `env honored = false`
- 包内 `cordis.patch.yml` 也写死 `memoryRoot: './memory'`，相对路径按 dsh 进程 cwd 解析；桌面端 cwd 可能是应用安装目录（只读）或用户工作区，数据位置不可预测，最坏情况 `mkdir` 直接 `EACCES`。

**影响**：README 承诺的“平台默认目录 / 环境变量覆盖”在最常用的 dsh 插件路径上失效；用户的数据可能写到 `./memory`（随启动目录漂移），卸载时也找不到。

**可选方案**
- A. `index.ts` 不再填默认值，把 `memoryRoot: config.memoryRoot` 原样交给 `resolveConfig`；包内 patch 删除 `memoryRoot`，让平台默认生效。
- B. 保留相对路径，但按 dsh profile 目录解析（需要拿到 profile baseDir），而不是 cwd。
- C. 文档强制绝对路径 + 启动时校验（最省代码，但把风险转给用户）。

**建议**：A + 包 patch 删除 `memoryRoot`；如果必须支持相对路径，采用 B 并在启动日志打印解析后的绝对路径。

**决定**：________________

---

### P0-4 升级断裂：policy v3→v4 与 `user.md`→`IMPORTANT.md`

**证据**
- `templates/policy.yaml.example`：`policy_version: 3` → `4`；`src/policy.ts` 用严格相等校验，探针用 `origin/main` 的 v3 模板启动当前 HEAD → `policy version mismatch: expected 4, got 3`。
- 文件名迁移：`src/inject/render.ts:193-195` 先读 `IMPORTANT.md`，**非空则完全不再读 `user.md`**；`src/core.ts:274` 的 deriver 写入目标是 `IMPORTANT.md`；全仓库没有把 `user.md` 合并/重命名到 `IMPORTANT.md` 的迁移代码。
- 探针：只有 `user.md` 时读到旧内容；一旦创建 `IMPORTANT.md`，返回值只剩 `IMPORTANT.md` 的内容，`user.md` 仍在磁盘但被遮蔽。
- 语义变化：v3 的 `gnomic.storage: 'doc'` + `injection: 'always'` 改为 v4 的 `'memory'` + `'conditional'`；v3 的 `user_doc_writer` 改为 `important_doc_writer`。

**影响**：反馈者的数据目录（`user.md` + v3 policy）升级到当前 HEAD 后：
1. 直接因 policy 版本不匹配无法启动；
2. 即使手工改 policy，只要 deriver 写出第一条 `IMPORTANT.md`，旧 `user.md` 的全部画像会从注入中消失；
3. 旧 `user.md` 里的 traits 不会自动进入 memories，gnomic 的新检索语义拿不到历史数据。

**可选方案**
- A. 提供 `scripts/migrate-data.mjs`：v3 policy 键映射（`user_doc_writer`→`important_doc_writer`、gnomic 语义提示）+ `user.md` 合并进 `IMPORTANT.md`（或按行拆分：全局重要→IMPORTANT，其余→gnomic memories），升级前备份。
- B. loader 接受 v3 一个版本窗口，运行时做键映射并打印 deprecation warning；文件名读取改为“合并”而不是“遮蔽”。
- C. 只写升级文档，要求用户手工重建（最省事，但会持续产生“升级后记忆消失”的反馈）。

**建议**：A 为正式路径，B 作为过渡；最低限度先把 `readImportantDoc` 改成 `IMPORTANT.md + user.md` 合并（去重），避免遮蔽。

**决定**：________________

---

### P0-5 反馈针对旧代码，不能当作当前 HEAD 的验收

**证据**
- `git fetch` 后 `origin/main` 仍是 `e043d07`（2026-10-02）；本地 `main` 是 `a9a2633`（2026-10-20），领先 10 个提交，工作区还有 30 项未提交改动。
- 反馈中的 `user.md`、policy v3 与 `origin/main` 一致；当前 HEAD 已改为 `IMPORTANT.md` + policy v4 + temporal lifecycle。
- 反馈的“已验证”清单（六入口导入、Electron 实例化、Ollama 降级、server 关闭）没有覆盖这些新改动。

**影响**：如果直接按这份反馈判断“已经可用”，会把旧版的通过误当成新版的通过；尤其是 policy v4 和 IMPORTANT 路由，正好是升级最脆弱的部分。

**建议**：先提交/推送当前工作区，bump 到 0.2.0，打 tag；给反馈者一个带版本号的 tgz 和最小验证清单（干净 profile + 空数据目录 + 升级场景），再重跑。

**决定**：________________

---

### P1-6 `sqlite-vec` 加载失败会让整个插件不可用（不是“自动降级”）

**证据**
- `src/schema.ts:33-37`：`new DatabaseSync(..., { allowExtension: true })` 后无条件 `db.loadExtension(sqliteVec.getLoadablePath())`，没有 try/catch。
- `sqlite-vec@0.1.9` 的 optionalDependencies 只覆盖 `darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`、`windows-x64`；没有 `win32-arm64`，也没有 musl 变体。
- 可选依赖被跳过/平台不支持时，`getLoadablePath()` 抛错 → `openDatabase` 抛错 → 六个入口全部不激活。

**影响**：Windows ARM、Alpine/musl、离线安装缺 optional dep 的用户会看到“插件装了但不工作”，且错误不在 README 的已知限制里。反馈里的“向量检索自动降级”只覆盖了 Ollama 不可用，不覆盖扩展加载失败。

**可选方案**
- A. `try/catch` 包住加载，失败时 `vecEnabled=false`，FTS/结构检索继续，启动日志警告；`f_embed` 权重在无 vec 时从分母中移除。
- B. 启动前探测平台/二进制，给出明确的不支持提示。
- C. 把 `sqlite-vec` 改为可选依赖，按需加载。

**建议**：A（真正的降级）+ 文档列支持平台；如果短期不做 A，至少把错误信息改成“sqlite-vec 不可用，原因是 X”。

**决定**：________________

---

### P1-7 运行时下限未强制（Node/Electron 版本）

**证据**
- `engines.node >= 22.13` 只对 npm 安装生效，Electron 运行时不看 `engines`。
- `src/schema.ts` 顶层静态 `import { DatabaseSync } from 'node:sqlite'`；旧 Node/Electron 上会在模块加载阶段报“找不到 node:sqlite”，dsh 侧表现为 `entries did not activate`，很难定位。
- README 只写 Node ≥ 22.13，没有写 dsh/Electron 的最低版本；反馈里的 Node 24.21 是桌面端实测值。

**建议**：README 增加兼容矩阵（dsh 0.2.0-rc.2+ / 桌面端对应 Electron Node 版本）；`index.ts` 启动时做 feature detect，失败时抛出带“请升级 dsh/桌面端”的错误。

**决定**：________________

---

### P1-8 卸载步骤不完整

**证据**：反馈只列了 profile `package.json` 依赖、`bundles`、`node_modules/@foresight/memory`、tgz。实际还会残留：
- profile `cordis.patch.yml` 里的 `foresight-core` 等覆盖条目；
- `pnpm-lock.yaml` 的解析记录（不重跑 install 不会清）；
- `FORESIGHT_*` 环境变量；
- 默认/覆盖后的实际 `memoryRoot`（可能是 cwd 下的 `memory/`，不只是 AppData）；
- `foresight.db-wal` / `-shm`、`audit.log_file`；
- dsh 的 `compatibility.json`（如果曾用 allow-version）。

**建议**：文档给“保留数据 / 彻底删除”两档；提供卸载自检脚本（打印实际 memoryRoot、profile 残留条目、端口占用）；优先用 `dsh plugin remove` + 手工清 bundles/patch。

**决定**：________________

---

### P1-9 CI 没有安装/打包测试

**证据**：`.github/workflows/ci.yml` 只跑 `pnpm install`、`pnpm build`、`pnpm test`、离线 smoke；没有断言 `npm pack` 内容，也没有“从 tgz 安装到干净 profile”的 smoke。

**影响**：`files` 漏 `templates`、`lib` 未构建、exports 缺失这类问题不会被 CI 拦住，正是本次反馈的来源。

**建议**：加一个 packaging job：
1. `pnpm build && npm pack --json`，断言 `templates/policy.yaml.example` 与 `lib/index.js` 存在；
2. 把 tgz 装进临时 profile（或临时目录 + 最小 peer stub），import 全部 exports；
3. 空 `memoryRoot` 启动，断言错误信息可操作（或 init 成功）。

**决定**：________________

---

### P1-10 版本与发布卫生

**证据**：`package.json` 仍是 `0.1.0`（与 `origin/main` 相同）；无 git tag；`gh release list` 为空；无 CHANGELOG；`repository`/`homepage`/`bugs`/`keywords` 均未设置。

**建议**：bump `0.2.0`（policy v4 是破坏性变更），打 tag，写 release notes（安装方式、破坏性变更、迁移步骤）；补 npm 元数据。README 里指向 `eval/DECISIONS.md` 的链接在 npm 页面会失效，改成 GitHub 绝对链接或把 docs 一并发布。

**决定**：________________

---

### P2-11 Ollama 故障时的查询延迟与权重稀释

**证据**：`OllamaEmbedProvider.embedOne` 默认 30s timeout；`search` 捕获失败后只 `console.warn`，每次查询都会重试；`f_embed` 仍留在权重分母里（非 lexical 记忆的 embed 因子为 0，分数被压到约 0.6 上限）。`backfillEmbeddings` 在首次失败后 break，不会反复打。

**影响**：Ollama 进程未启动时通常 `ECONNREFUSED` 很快；但如果端口被防火墙丢包/远端地址不可达，每轮注入可能多等 30s。权重稀释会让 `min_score` 附近的召回变少。

**建议**：失败缓存/会话级熔断 + 查询 embed 用更短超时（如 3–5s）；无 vec 时把 embed 权重从分母移除。

**决定**：________________

---

### P2-12 文档/导出小不一致

**证据**
- `src/policy.ts` 顶部注释写 `import type { Policy } from '@foresight/memory/policy'`，但 `package.json` 的 `exports` 没有 `./policy`。
- README 的“Resolution chain”写 `explicit → env → policy.yaml → defaults`，但 `memoryRoot` 实际不读 policy.yaml（鸡生蛋问题），`resolveConfig` 也没实现。
- Windows 文档示例用 `~/.config/foresight`，代码默认是 `%APPDATA%/foresight`（unix 是 `~/.local/share/foresight`）。
- Windows 用 Roaming 存 SQLite+WAL，企业漫游配置下可能同步冲突；`%LOCALAPPDATA%` 更合适。

**建议**：统一文档与代码；补 `./policy` 导出或删掉注释；Windows 默认改 `LOCALAPPDATA`（或明确说明为何用 Roaming）。

**决定**：________________

---

### P2-13 “热加载”只覆盖挂载，不覆盖代码更新

**证据**：反馈称“已通过热加载挂载，无需重启”；但 dsh 的热加载针对插件树/配置，`lib/*.js` 的代码更新仍需重启或新会话（项目技能里已有记录）。

**建议**：文档写清“首次挂载可热加载；改代码后需重启/新会话”，避免反馈者用旧模块继续测。

**决定**：________________

---

## 建议执行顺序

1. **先冻结快照**：提交/推送当前工作区，bump 0.2.0，打 tag；把反馈者的版本号对齐。
2. **修发行**：`prepack` + `templates/**` 进 `files` + release tgz（P0-1/P0-2）。
3. **修默认路径**：`index.ts` 不再填 `./memory`，包 patch 删除 `memoryRoot`（P0-3）。
4. **做迁移**：policy v3→v4 键映射 + `user.md` 合并/拆分 + 备份；至少先消除遮蔽（P0-4）。
5. **补容错**：sqlite-vec 加载失败降级 + 运行时版本 guard（P1-6/P1-7）。
6. **补 CI**：pack 内容断言 + tgz 安装 smoke + 空数据目录 init（P1-9）。
7. **重跑验收**：干净 profile 安装 → 空数据目录启动 → 写入/查询/注入 → 升级旧数据目录 → 卸载残留检查。

## 复现证据（本机）

```bash
# 发行/包内容
npm view @foresight/memory version                  # E404
cd D:/Project/AICode/ForeSight
npm pack --dry-run --json                           # 63 files; no templates/
git ls-files lib                                    # 空
git status -sb                                      # main...origin/main [ahead 10]

# 构建与测试
pnpm build                                          # ok
node --test                                         # 163 pass / 0 fail

# 运行时探针（脚本：%LOCALAPPDATA%/hermes/cache/scratch/fs_probe.mjs）
# 设置 FORESIGHT_MEMORY_DIR 后 apply：
#   resolved memoryRoot = ./memory
#   env honored = false
# 空数据目录：
#   ENOENT .../empty-root/policy.yaml
# origin/main 的 v3 policy + 当前 HEAD：
#   policy version mismatch: expected 4, got 3
# 同时存在 user.md 与 IMPORTANT.md：
#   readImportantDoc() 只返回 IMPORTANT.md 内容
```
