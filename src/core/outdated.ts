import { cachedFetchJson } from './registry/cache.ts'
import type { Lang, ProjectInfo } from './types.ts'

export type BumpLevel = 'major' | 'minor' | 'patch' | 'current' | 'unknown'

export const LEVEL_LABEL: Record<BumpLevel, string> = {
  major: '大版本',
  minor: '次版本',
  patch: '补丁',
  current: '最新',
  unknown: '未知',
}

/** 从版本约束里抠出第一组 x.y.z 数字（"^1.2.3" ">=2,<3" "~=1.4" "1" 都行） */
export function parseVersionParts(spec: string): [number, number, number] | undefined {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(spec)
  if (!m) return undefined
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

/** 比较 manifest 里的版本约束和注册表最新版，给出升级级别 */
export function bumpLevel(currentSpec: string, latest: string): BumpLevel {
  const a = parseVersionParts(currentSpec)
  const b = parseVersionParts(latest)
  if (!a || !b) return 'unknown'
  if (b[0] > a[0]) return 'major'
  if (b[0] === a[0] && b[1] > a[1]) return 'minor'
  if (b[0] === a[0] && b[1] === a[1] && b[2] > a[2]) return 'patch'
  return 'current'
}

export function isUpgradable(level: BumpLevel): boolean {
  return level === 'major' || level === 'minor' || level === 'patch'
}

async function fetchLatest(lang: Lang, name: string): Promise<string> {
  if (lang === 'rust') {
    const d = await cachedFetchJson<{ crate: { max_stable_version: string | null; max_version: string } }>(
      `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
    )
    return d.crate.max_stable_version ?? d.crate.max_version
  }
  if (lang === 'python') {
    const d = await cachedFetchJson<{ info: { version: string } }>(
      `https://pypi.org/pypi/${encodeURIComponent(name.toLowerCase())}/json`,
    )
    return d.info.version
  }
  const escaped = encodeURIComponent(name).replace('%40', '@')
  try {
    const d = await cachedFetchJson<{ version: string }>(`https://registry.npmjs.org/${escaped}/latest`)
    return d.version
  } catch {
    // scoped 包在部分镜像上不支持 /latest，退回完整元数据
    const d = await cachedFetchJson<{ 'dist-tags'?: { latest?: string } }>(`https://registry.npmjs.org/${escaped}`)
    const v = d['dist-tags']?.latest
    if (!v) throw new Error('no latest tag')
    return v
  }
}

export interface OutdatedResult {
  /** 依赖名 → 注册表最新版本号 */
  latest: Map<string, string>
  failed: string[]
}

/** 并发查询项目所有依赖的最新版本（带磁盘缓存，TTL 1 天） */
export async function checkOutdated(project: ProjectInfo, concurrency = 6): Promise<OutdatedResult> {
  const latest = new Map<string, string>()
  const failed: string[] = []
  const queue = [...project.dependencies]
  const worker = async () => {
    for (;;) {
      const dep = queue.shift()
      if (!dep) return
      try {
        latest.set(dep.name, await fetchLatest(project.lang, dep.name))
      } catch {
        failed.push(dep.name)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker))
  return { latest, failed }
}
