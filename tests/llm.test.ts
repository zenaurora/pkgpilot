import { describe, expect, test } from 'bun:test'
import { LLM_SETUP_HINT, buildMessages, loadLlmConfig, parseRecommendations } from '../src/core/llm.ts'

describe('loadLlmConfig（注入文件状态，不碰真实 ~/.config）', () => {
  test('文件不存在 → 提示如何配置', () => {
    const res = loadLlmConfig({ state: 'missing' })
    expect(res).toEqual({ ok: false, reason: LLM_SETUP_HINT })
  })

  test('文件存在但无 apiKey → 提示如何配置', () => {
    const res = loadLlmConfig({ state: 'ok', llm: { model: 'x' } })
    expect(res).toEqual({ ok: false, reason: LLM_SETUP_HINT })
  })

  test('文件损坏 → 明确指出格式有误，而不是说没配 key', () => {
    const res = loadLlmConfig({ state: 'invalid', message: 'Unexpected token' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('格式有误')
  })

  test('只配 apiKey → DeepSeek 默认值', () => {
    const res = loadLlmConfig({ state: 'ok', llm: { apiKey: 'sk-test' } })
    expect(res).toEqual({
      ok: true,
      config: { apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    })
  })

  test('全量覆盖 + 尾斜杠剥离', () => {
    const res = loadLlmConfig({
      state: 'ok',
      llm: { apiKey: 'sk-mine', baseUrl: 'https://example.com/v1/', model: 'other-model' },
    })
    expect(res).toEqual({
      ok: true,
      config: { apiKey: 'sk-mine', baseUrl: 'https://example.com/v1', model: 'other-model' },
    })
  })
})

describe('buildMessages', () => {
  test('mentions lang, embeds existing deps into system prompt', () => {
    const msgs = buildMessages('rust', '要一个进度条', ['tokio', 'serde'])
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.role).toBe('system')
    expect(msgs[0]!.content).toContain('Rust')
    expect(msgs[0]!.content).toContain('tokio, serde')
    expect(msgs[1]).toEqual({ role: 'user', content: '要一个进度条' })
  })

  test('no existing deps → no duplicate-avoidance line', () => {
    const msgs = buildMessages('js', 'date library')
    expect(msgs[0]!.content).not.toContain('已有依赖')
  })
})

describe('parseRecommendations', () => {
  test('valid payload', () => {
    const recs = parseRecommendations(
      '{"packages":[{"name":"indicatif","note":"终端进度条"},{"name":"insta","note":"快照测试","dev":true}]}',
    )
    expect(recs.map((r) => r.name)).toEqual(['indicatif', 'insta'])
    expect(recs[1]!.dev).toBe(true)
  })

  test('tolerates markdown code fences', () => {
    const recs = parseRecommendations('```json\n{"packages":[{"name":"rand","note":"随机数"}]}\n```')
    expect(recs).toHaveLength(1)
    expect(recs[0]!.name).toBe('rand')
  })

  test('伪装成 flag 的包名被过滤，正常包（含 scoped）保留', () => {
    const recs = parseRecommendations(
      JSON.stringify({
        packages: [
          { name: '-D', note: '注入' },
          { name: '--registry=https://evil.example', note: '注入' },
          { name: '@tanstack/react-query', note: '正常 scoped 包' },
          { name: 'serde_json', note: '正常包' },
        ],
      }),
    )
    expect(recs.map((r) => r.name)).toEqual(['@tanstack/react-query', 'serde_json'])
  })

  test('带非法 feature 的包整项被过滤', () => {
    const recs = parseRecommendations(
      '{"packages":[{"name":"tokio","note":"ok","features":["--offline"]},{"name":"serde","note":"ok","features":["derive"]}]}',
    )
    expect(recs.map((r) => r.name)).toEqual(['serde'])
  })

  test('超过 8 个截断而不是报错', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `pkg${i}`, note: '' }))
    const recs = parseRecommendations(JSON.stringify({ packages: many }))
    expect(recs).toHaveLength(8)
  })

  test('malformed json throws', () => {
    expect(() => parseRecommendations('not json')).toThrow()
  })

  test('wrong shape throws', () => {
    expect(() => parseRecommendations('{"packages":[{"note":"缺 name"}]}')).toThrow()
  })
})
