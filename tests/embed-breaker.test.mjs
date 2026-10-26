import { test } from 'node:test'
import assert from 'node:assert/strict'

const { CircuitBreakerEmbedProvider, EmbedCircuitOpenError } = await import('../lib/store/embed.js')

test('embed breaker: opens after threshold, skips calls, recovers after cooldown', async () => {
  let calls = 0
  let failing = true
  let now = 0
  const inner = {
    async embedOne() {
      calls += 1
      if (failing) throw new Error('ollama down')
      return new Float32Array([1, 0])
    },
    async embedBatch(texts) {
      calls += 1
      if (failing) throw new Error('ollama down')
      return texts.map(() => new Float32Array([1, 0]))
    },
  }
  const breaker = new CircuitBreakerEmbedProvider(inner, {
    failureThreshold: 2,
    cooldownMs: 1000,
    now: () => now,
  })
  await assert.rejects(() => breaker.embedOne('a'), /ollama down/)
  await assert.rejects(() => breaker.embedOne('b'), /ollama down/)
  assert.equal(calls, 2)
  await assert.rejects(
    () => breaker.embedOne('c'),
    (e) => e instanceof EmbedCircuitOpenError && e.retryAfterMs === 1000,
  )
  assert.equal(calls, 2, 'open circuit must not call the backend')
  await assert.rejects(() => breaker.embedBatch(['x']), EmbedCircuitOpenError)
  assert.equal(calls, 2)

  now = 1001
  failing = false
  const v = await breaker.embedOne('d')
  assert.equal(v.length, 2)
  assert.equal(calls, 3, 'half-open probe reaches the backend')
  await breaker.embedOne('e')
  assert.equal(calls, 4, 'success closes the circuit')
})
