import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { LANG_LABEL, type Lang } from './types.ts'

const USER_CONFIG_PATH = path.join(os.homedir(), '.config', 'pkgpilot', 'config.json')

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
}

const userConfigSchema = z.object({
  llm: z
    .object({
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
})

/** 配置文件的三种状态：不存在 / 存在但坏了 / 读取成功 */
export type ConfigFileState =
  | { state: 'missing' }
  | { state: 'invalid'; message: string }
  | { state: 'ok'; llm?: { apiKey?: string; baseUrl?: string; model?: string } }

export function readConfigFile(): ConfigFileState {
  let raw: string
  try {
    raw = fs.readFileSync(USER_CONFIG_PATH, 'utf8')
  } catch {
    return { state: 'missing' }
  }
  try {
    return { state: 'ok', llm: userConfigSchema.parse(JSON.parse(raw)).llm }
  } catch (e: any) {
    return { state: 'invalid', message: e?.message?.split('\n')[0] ?? String(e) }
  }
}

export const LLM_SETUP_HINT =
  '未配置 API key：在 ~/.config/pkgpilot/config.json 写入 {"llm":{"apiKey":"sk-…"}}，可选 baseUrl/model 换其他 OpenAI 兼容服务'

export type LlmConfigResult = { ok: true; config: LlmConfig } | { ok: false; reason: string }

/**
 * Resolve LLM config — 只读 ~/.config/pkgpilot/config.json，不读环境变量。
 * file 参数可注入，便于测试。
 */
export function loadLlmConfig(file: ConfigFileState = readConfigFile()): LlmConfigResult {
  if (file.state === 'invalid') {
    return { ok: false, reason: `~/.config/pkgpilot/config.json 格式有误: ${file.message}` }
  }
  const llm = file.state === 'ok' ? file.llm : undefined
  if (!llm?.apiKey) return { ok: false, reason: LLM_SETUP_HINT }
  return {
    ok: true,
    config: {
      apiKey: llm.apiKey,
      baseUrl: (llm.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, ''),
      model: llm.model ?? 'deepseek-chat',
    },
  }
}

export interface LlmRecommendation {
  name: string
  note: string
  features?: string[]
  dev?: boolean
}

// 包名/feature 白名单：LLM 输出会直接进入 cargo/npm/uv 的 spawn 参数，拒绝 "-D"、"--registry=…" 这类伪装成包名的 flag
const SAFE_NAME = /^[a-zA-Z0-9@][a-zA-Z0-9@/_.-]*$/
const SAFE_FEATURE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

const recSchema = z.object({
  packages: z
    .array(
      z.object({
        name: z.string().min(1),
        note: z.string().default(''),
        features: z.array(z.string()).optional(),
        dev: z.boolean().optional(),
      }),
    )
    // 过滤可疑项、截断超长回复，而不是整包拒绝
    .transform((pkgs) =>
      pkgs
        .filter((p) => SAFE_NAME.test(p.name) && (p.features ?? []).every((f) => SAFE_FEATURE.test(f)))
        .slice(0, 8),
    ),
})

/** Build chat messages for a package recommendation request. Pure, testable. */
export function buildMessages(lang: Lang, query: string, existing: string[] = []) {
  const system = [
    `你是 ${LANG_LABEL[lang]} 生态的包推荐专家。用户描述一个需求，你推荐最主流、维护良好的包。`,
    '只返回 JSON 对象，格式：{"packages":[{"name":"包名","note":"一句话中文说明为什么选它","features":["可选"],"dev":true}]}',
    '规则：最多 5 个包；note 不超过 30 字；features 只在 Rust 且确实需要非默认 feature 时给出；',
    'dev 只在明确属于开发期依赖（测试/构建工具）时为 true；不确定的包宁可不推荐，不要编造包名。',
    existing.length ? `项目已有依赖（不要重复推荐）：${existing.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: query },
  ]
}

/** Parse and validate the model's JSON reply. Pure, testable. Throws on malformed output. */
export function parseRecommendations(text: string): LlmRecommendation[] {
  // tolerate ```json fences some models add despite json mode
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  return recSchema.parse(JSON.parse(cleaned)).packages
}

/** Ask the LLM (OpenAI-compatible chat completions) for package recommendations. */
export async function recommendPackages(
  cfg: LlmConfig,
  lang: Lang,
  query: string,
  existing: string[] = [],
): Promise<LlmRecommendation[]> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: buildMessages(lang, query, existing),
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 800,
    }),
  }).catch((e: any) => {
    if (e?.name === 'TimeoutError') throw new Error('请求超时（30 秒），检查网络或稍后重试')
    throw e
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM 请求失败 ${res.status}: ${body.slice(0, 120)}`)
  }
  const data: any = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('LLM 返回缺少 content')
  return parseRecommendations(content)
}
