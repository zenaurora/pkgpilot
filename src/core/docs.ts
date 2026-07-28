import packagesData from '../data/packages.json'
import { cachedFetchJson, cachedFetchText } from './registry/cache.ts'
import type { Lang } from './types.ts'

/** 一个包的落地资料：来自官方注册表 + README 提取，不经过 LLM */
export interface PackageDoc {
  name: string
  lang: Lang
  version: string
  summary: string
  docsUrl: string
  repoUrl?: string
  /** README 里提取的快速上手代码（不含围栏），供 TUI 直接展示 */
  quickstart?: string
  /** 抓取日期 YYYY-MM-DD */
  fetchedAt: string
  /** 人工审校/手写过的条目，采集脚本不会覆盖 */
  curated?: boolean
}

// ---------- README 解析（纯函数，可测试） ----------

interface FencedBlock {
  lang: string
  code: string
  /** 该代码块所属的最近一个标题 */
  heading: string
}

/** 把 markdown 里的围栏代码块连同其所属标题一起解析出来 */
export function parseFencedBlocks(md: string): FencedBlock[] {
  const blocks: FencedBlock[] = []
  let heading = ''
  let fence: string | null = null
  let blockLang = ''
  let buf: string[] = []
  for (const line of md.split(/\r?\n/)) {
    if (fence === null) {
      const h = /^#{1,6}\s+(.*)/.exec(line)
      if (h) {
        heading = h[1].trim()
        continue
      }
      const open = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line)
      if (open) {
        fence = open[1]
        blockLang = open[2].toLowerCase()
        buf = []
      }
    } else if (line.trimStart().startsWith(fence)) {
      blocks.push({ lang: blockLang, code: buf.join('\n'), heading })
      fence = null
    } else {
      buf.push(line)
    }
  }
  return blocks
}

const USAGE_HEADING = /usage|quick\s*start|getting\s*started|example|tutorial|用法|使用|示例|快速/i
const INSTALL_LINE =
  /^\s*(\$\s*)?(cargo\s+(add|install)|npm\s+(i|install)|pnpm\s+(add|i)\b|yarn\s+add|bun\s+(add|i)\b|pip3?\s+install|uv\s+(add|pip)|poetry\s+add|brew\s+install|apt(-get)?\s+install|git\s+clone)\b/
/** 这些语言的代码块多半是安装/配置说明，不是用法 */
const CONFIG_LANGS = new Set(['sh', 'bash', 'shell', 'console', 'zsh', 'cmd', 'powershell', 'toml', 'ini', 'yaml', 'yml', 'json', 'text', 'txt', 'diff', 'html'])
const LANG_HINT: Record<Lang, RegExp> = {
  rust: /^(rust|rs)$/,
  python: /^(python|py|python3|pycon)$/,
  js: /^(js|javascript|ts|typescript|jsx|tsx|mjs|cjs)$/,
}
const MAX_QUICKSTART_LINES = 24

/**
 * 从 README（markdown）里挑一段最像"快速上手"的代码。
 * 优先级：目标语言 + Usage 类标题 > 目标语言 > 无标注语言；纯安装命令块直接跳过。
 */
export function extractQuickstart(markdown: string, lang: Lang): string | undefined {
  const blocks = parseFencedBlocks(markdown).filter((b) => {
    const nonEmpty = b.code.split('\n').filter((l) => l.trim())
    return nonEmpty.length > 0 && !nonEmpty.every((l) => INSTALL_LINE.test(l))
  })
  if (!blocks.length) return undefined
  const langRe = LANG_HINT[lang]
  const score = (b: FencedBlock) =>
    (langRe.test(b.lang) ? 4 : b.lang === '' ? 1 : CONFIG_LANGS.has(b.lang) ? -3 : 0) +
    (USAGE_HEADING.test(b.heading) ? 2 : 0)
  let best = blocks[0]
  let bestScore = score(best)
  for (const b of blocks.slice(1)) {
    const s = score(b)
    if (s > bestScore) {
      best = b
      bestScore = s
    }
  }
  if (bestScore < 0) return undefined
  const lines = best.code.split('\n')
  const clipped = lines.length > MAX_QUICKSTART_LINES ? [...lines.slice(0, MAX_QUICKSTART_LINES), '…'] : lines
  const text = clipped.join('\n').trim()
  return text || undefined
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** crates.io 的 readme 接口返回渲染后的 HTML，转成够用的 markdown（标题 + 围栏代码块） */
export function htmlToMarkdownish(html: string): string {
  let s = html.replace(
    /<pre[^>]*>\s*(?:<code([^>]*)>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi,
    (_m, attrs: string | undefined, code: string) => {
      const lang = /language-([\w+#.-]+)/.exec(attrs ?? '')?.[1] ?? ''
      return `\n\`\`\`${lang}\n${code.replace(/<[^>]+>/g, '').replace(/\s+$/, '')}\n\`\`\`\n`
    },
  )
  s = s.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, n: string, text: string) => `\n${'#'.repeat(Number(n))} ${text.replace(/<[^>]+>/g, '').trim()}\n`,
  )
  s = s.replace(/<[^>]+>/g, ' ')
  return decodeEntities(s)
}

/** PyPI 有些包的 description 是 reStructuredText：把 code-block 指令和下划线标题转成 markdown */
export function rstToMarkdownish(rst: string): string {
  const lines = rst.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const dir = /^\.\.\s+(?:code-block|sourcecode|code)::\s*(\S*)/.exec(lines[i])
    if (dir) {
      let j = i + 1
      while (j < lines.length && (/^\s*:\S+:/.test(lines[j]) || !lines[j].trim())) j++
      const buf: string[] = []
      while (j < lines.length && (!lines[j].trim() || /^\s/.test(lines[j]))) {
        buf.push(lines[j])
        j++
      }
      while (buf.length && !buf[buf.length - 1].trim()) buf.pop()
      const nonEmpty = buf.filter((l) => l.trim())
      if (nonEmpty.length) {
        const indent = Math.min(...nonEmpty.map((l) => /^\s*/.exec(l)![0].length))
        out.push('```' + (dir[1] || ''), ...buf.map((l) => l.slice(indent)), '```')
      }
      i = j - 1
    } else if (
      i + 1 < lines.length &&
      lines[i].trim() &&
      !/^\s/.test(lines[i]) &&
      /^([=\-~^"'#*+])\1{2,}\s*$/.test(lines[i + 1]) &&
      lines[i + 1].trim().length >= lines[i].trim().length
    ) {
      out.push(`## ${lines[i].trim()}`)
      i++
    } else {
      out.push(lines[i])
    }
  }
  return out.join('\n')
}

// ---------- 官方源抓取 ----------

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function fetchRustDoc(name: string): Promise<PackageDoc> {
  const data = await cachedFetchJson<{
    crate: {
      max_stable_version: string | null
      max_version: string
      description: string | null
      documentation: string | null
      repository: string | null
    }
  }>(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`)
  const c = data.crate
  const version = c.max_stable_version ?? c.max_version
  let quickstart: string | undefined
  try {
    const html = await cachedFetchText(
      `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}/readme`,
    )
    quickstart = extractQuickstart(htmlToMarkdownish(html), 'rust')
  } catch {
    // 没有 README 不算失败
  }
  return {
    name,
    lang: 'rust',
    version,
    summary: c.description?.trim() ?? '',
    docsUrl: c.documentation ?? `https://docs.rs/${name}`,
    repoUrl: c.repository ?? undefined,
    quickstart,
    fetchedAt: today(),
  }
}

function normalizeRepoUrl(repo?: { url?: string } | string): string | undefined {
  const raw = typeof repo === 'string' ? repo : repo?.url
  if (!raw) return undefined
  return raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
}

async function fetchJsDoc(name: string): Promise<PackageDoc> {
  const data = await cachedFetchJson<{
    'dist-tags'?: { latest?: string }
    description?: string
    readme?: string
    homepage?: string
    repository?: { url?: string } | string
  }>(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`)
  return {
    name,
    lang: 'js',
    version: data['dist-tags']?.latest ?? '',
    summary: data.description?.trim() ?? '',
    docsUrl: data.homepage ?? `https://www.npmjs.com/package/${name}`,
    repoUrl: normalizeRepoUrl(data.repository),
    quickstart: data.readme ? extractQuickstart(data.readme, 'js') : undefined,
    fetchedAt: today(),
  }
}

async function fetchPyDoc(name: string): Promise<PackageDoc> {
  const data = await cachedFetchJson<{
    info: {
      version: string
      summary: string | null
      description: string | null
      description_content_type: string | null
      home_page: string | null
      project_urls: Record<string, string> | null
    }
  }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)
  const info = data.info
  const desc = info.description ?? ''
  const isRst = (info.description_content_type ?? '').includes('rst') || (!desc.includes('```') && /^\.\.\s|\n\.\.\s+code/.test(desc))
  const md = isRst ? rstToMarkdownish(desc) : desc
  const urls = info.project_urls ?? {}
  const docsKey = Object.keys(urls).find((k) => /doc/i.test(k))
  return {
    name,
    lang: 'python',
    version: info.version,
    summary: info.summary?.trim() ?? '',
    docsUrl: (docsKey && urls[docsKey]) || info.home_page || `https://pypi.org/project/${name}/`,
    repoUrl: Object.entries(urls).find(([k]) => /source|repo|github/i.test(k))?.[1],
    quickstart: extractQuickstart(md, 'python'),
    fetchedAt: today(),
  }
}

/** 从官方注册表在线抓取一个包的资料（带磁盘缓存） */
export function fetchPackageDoc(lang: Lang, name: string): Promise<PackageDoc> {
  if (lang === 'rust') return fetchRustDoc(name)
  if (lang === 'python') return fetchPyDoc(name)
  return fetchJsDoc(name)
}

// ---------- 内置资料查询 ----------

const localDocs = packagesData as PackageDoc[]
const localIndex = new Map(localDocs.map((d) => [`${d.lang}:${d.name}`, d]))

export function getLocalDoc(lang: Lang, name: string): PackageDoc | undefined {
  return localIndex.get(`${lang}:${name}`)
}

export interface DocLookup {
  doc: PackageDoc
  source: 'local' | 'live'
}

/** 内置资料优先（人工审校过、离线可用），没有再去官方源抓 */
export async function getPackageDoc(lang: Lang, name: string): Promise<DocLookup> {
  const local = getLocalDoc(lang, name)
  if (local) return { doc: local, source: 'local' }
  return { doc: await fetchPackageDoc(lang, name), source: 'live' }
}
