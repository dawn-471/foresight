#!/usr/bin/env node
import http from 'node:http'

const BRIDGE = (process.env.CODEX_BRIDGE_URL ?? 'http://127.0.0.1:3220/v1').replace(/\/+$/, '')
const HOST = process.env.SHIM_HOST ?? '127.0.0.1'
const PORT = Number(process.env.SHIM_PORT ?? 3222)
const TIMEOUT_MS = Number(process.env.SHIM_TIMEOUT_MS ?? 300000)

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('')
  return ''
}

export function toResponsesBody(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const systems = []
  const input = []
  for (const m of messages) {
    const text = contentText(m?.content)
    if (!text) continue
    if (m.role === 'system' || m.role === 'developer') systems.push(text)
    else input.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text })
  }
  const out = { model: body.model }
  if (systems.length > 0) out.instructions = systems.join('\n\n')
  out.input = input.length > 0 ? input : ''
  return out
}

export async function callBridge(responsesBody, { bridge = BRIDGE, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${bridge}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responsesBody),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`bridge HTTP ${res.status}: ${text.slice(0, 300)}`)
      err.status = res.status
      throw err
    }
    const raw = await res.text()
    let text = ''
    let usage = null
    let failed = null
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data: ')) continue
      let evt
      try {
        evt = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (evt.type === 'response.output_text.delta') text += evt.delta ?? ''
      else if (evt.type === 'response.completed') usage = evt.response?.usage ?? null
      else if (evt.type === 'response.failed') failed = evt.response?.error ?? { message: 'bridge error' }
    }
    if (failed) {
      const err = new Error(`bridge failed: ${failed.message ?? 'unknown'}`)
      err.status = 502
      throw err
    }
    return { text, usage }
  } finally {
    clearTimeout(timer)
  }
}

function toChatCompletion(body, { text, usage }) {
  return {
    id: `chatcmpl-shim-${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: usage?.input_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
      prompt_tokens_details: { cached_tokens: usage?.input_tokens_details?.cached_tokens ?? 0 },
      completion_tokens_details: { reasoning_tokens: usage?.output_tokens_details?.reasoning_tokens ?? 0 },
    },
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, bridge: BRIDGE }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    try {
      const r = await fetch(`${BRIDGE}/models`)
      const data = await r.text()
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      res.end(data)
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: e.message, type: 'bridge_error' } }))
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `请求体解析失败: ${e.message}`, type: 'invalid_request_error' } }))
      return
    }
    try {
      const result = await callBridge(toResponsesBody(body))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(toChatCompletion(body, result)))
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: e.message, type: 'bridge_error' } }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `未知端点 ${req.method} ${url.pathname}` } }))
})

server.listen(PORT, HOST, () => {
  console.log(`codex-chat-shim → http://${HOST}:${PORT}/v1 (bridge ${BRIDGE})`)
})
