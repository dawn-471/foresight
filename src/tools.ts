/**
 * ForeSight tools plugin: registers memory operations on ctx.tools
 * so the model can call them. Domain logic stays in core.
 *
 * Registration shape matches dsh-tools defineTool (name / parameters /
 * output / execute). The helper is not imported so this package still
 * typechecks without the peer installed.
 */
import type { ForeSight } from './core.js'

export const name = 'foresight-tools'
export const inject = ['foresight', 'tools']

export interface ToolTextBlock {
  type: 'text'
  text: string
}

export interface MemoryToolDef {
  name: string
  description: string
  parameters: Record<string, { type: string; required?: boolean; description: string }>
  output: {
    schema: { type: string }
    render: (args: unknown, value: string) => ToolTextBlock[]
  }
  execute: (args: Record<string, unknown>) => Promise<string>
}

export interface ToolsHost {
  foresight: ForeSight
  tools: {
    register: (definition: MemoryToolDef) => unknown
  }
}

function textOut(_args: unknown, value: string): ToolTextBlock[] {
  return [{ type: 'text', text: value }]
}

export function buildMemoryTools(fsight: ForeSight): MemoryToolDef[] {
  return [
    {
      name: 'memory_write',
      description: '把一条事实写入长期记忆。写入门会分类体与锚，拒绝或演化既有条目。不要写入密钥。',
      parameters: {
        text: { type: 'string', required: true, description: '要记住的一句话' },
      },
      output: { schema: { type: 'string' }, render: textOut },
      async execute(args) {
        const text = String(args?.text ?? '').trim()
        if (!text) throw new Error('text is required')
        const rec = await fsight.write(text, { name: 'agent', isRoot: false, scope: 'global' })
        const id = rec.memory?.id ?? ''
        return rec.ok
          ? `已写入 ${id}：${rec.message}`
          : `未写入（${rec.clause ?? ''}）：${rec.message}`
      },
    },
    {
      name: 'memory_update',
      description: '修正一条既有记忆的正文；会重新计算向量、保留修订审计。',
      parameters: {
        id: { type: 'string', required: true, description: '记忆 id' },
        text: { type: 'string', required: true, description: '修正后的完整正文' },
      },
      output: { schema: { type: 'string' }, render: textOut },
      async execute(args) {
        const id = String(args?.id ?? '').trim()
        const text = String(args?.text ?? '').trim()
        if (!id) throw new Error('id is required')
        if (!text) throw new Error('text is required')
        const updated = await fsight.updateMemory(id, { content: text }, { name: 'agent', isRoot: false, scope: 'global' })
        return updated ? `已更新 ${updated.id}` : `未找到 ${id}`
      },
    },
    {
      name: 'memory_delete',
      description: '软删除一条记忆（可恢复，保留审计）；不要用它删除密钥类内容，那需要 Root purge。',
      parameters: {
        id: { type: 'string', required: true, description: '记忆 id' },
      },
      output: { schema: { type: 'string' }, render: textOut },
      async execute(args) {
        const id = String(args?.id ?? '').trim()
        if (!id) throw new Error('id is required')
        const ok = await fsight.deleteMemory(id, { name: 'agent', isRoot: false, scope: 'global' })
        return ok ? `已删除 ${id}` : `未找到 ${id}`
      },
    },
    {
      name: 'memory_restore',
      description: '恢复一条被软删除或被冲突抑制的记忆。',
      parameters: {
        id: { type: 'string', required: true, description: '记忆 id' },
      },
      output: { schema: { type: 'string' }, render: textOut },
      async execute(args) {
        const id = String(args?.id ?? '').trim()
        if (!id) throw new Error('id is required')
        const restored = await fsight.restoreMemory(id, { name: 'agent', isRoot: false, scope: 'global' })
        return restored ? `已恢复 ${restored.id}` : `未找到 ${id}`
      },
    },
    {
      name: 'memory_renew',
      description: '为进行体/未然体续期，可指定新的结束日期；nudge 的“续期”动作由此执行。',
      parameters: {
        id: { type: 'string', required: true, description: '记忆 id' },
        until: { type: 'string', required: false, description: '新的结束日期 YYYY-MM-DD；省略则按 TTL 顺延' },
      },
      output: { schema: { type: 'string' }, render: textOut },
      async execute(args) {
        const id = String(args?.id ?? '').trim()
        if (!id) throw new Error('id is required')
        const until = typeof args?.until === 'string' && args.until.trim() ? args.until.trim() : undefined
        const renewed = await fsight.renewMemory(id, until, { name: 'agent', isRoot: false, scope: 'global' })
        return renewed ? `已续期 ${renewed.id}（至 ${renewed.anchor.end ?? 'TTL'}）` : `未找到 ${id}`
      },
    },
    {
      name: 'memory_query',
      description: '按语义检索长期记忆（进行体/完成体/未然体/恒常体/兜底）。返回已渲染的命中。',
      parameters: {
        query: { type: 'string', required: true, description: '检索问句' },
        k: { type: 'number', required: false, description: '最多返回条数，默认 8，上限 20' },
      },
      output: { schema: { type: 'string' }, render: textOut },
      async execute(args) {
        const query = String(args?.query ?? '').trim()
        if (!query) throw new Error('query is required')
        const k = Math.min(20, Math.max(1, Number(args?.k ?? 8) || 8))
        const hits = await fsight.query(query, { topK: k, scope: 'global' })
        if (hits.length === 0) return '无命中'
        return hits.map((h) => h.rendered || h.content).join('\n')
      },
    },
    {
      name: 'memory_reason',
      description: '基于已检索证据回答，并标出冲突。模型不可用时退回证据拼接，不阻断。',
      parameters: {
        query: { type: 'string', required: true, description: '要裁定的问题' },
      },
      output: { schema: { type: 'string' }, render: textOut },
      async execute(args) {
        const query = String(args?.query ?? '').trim()
        if (!query) throw new Error('query is required')
        const r = await fsight.reason(query, 'global')
        const cites = r.citations.length ? `\n证据: ${r.citations.map((c) => c.content).join(' | ')}` : ''
        const conf = r.conflicts.length ? `\n冲突: ${r.conflicts.length}` : ''
        return `${r.answer}${cites}${conf}`
      },
    },
  ]
}

export function apply(ctx: ToolsHost): () => void {
  const fsight = ctx.foresight
  if (!fsight) throw new Error('foresight-tools: 缺少 ctx.foresight（需 foresight-core 先加载）')
  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('foresight-tools: ctx.tools 不可用（需要 dsh-tools）')
  }
  const disposers: Array<() => void> = []
  for (const def of buildMemoryTools(fsight)) {
    const d = ctx.tools.register(def)
    if (typeof d === 'function') disposers.push(d as () => void)
  }
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
