/**
 * 批量采集脚本：把 aliases.json + bundles.json 里所有精选包的资料
 * 从官方注册表（crates.io / npm / PyPI）抓下来，落地成 src/data/packages.json。
 *
 * 用法：bun run collect-docs
 * 规则：
 *  - 已有条目里标了 "curated": true 的（人工审校/手写）永不覆盖
 *  - 抓取失败的包保留旧数据（如果有），并在结尾汇总报告
 */
import fs from 'node:fs'
import path from 'node:path'
import { fetchPackageDoc, type PackageDoc } from '../src/core/docs.ts'
import type { AliasEntry, Bundle, Lang } from '../src/core/types.ts'

const ROOT = path.resolve(import.meta.dir, '..')
const OUT_FILE = path.join(ROOT, 'src', 'data', 'packages.json')

const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/aliases.json'), 'utf8')) as AliasEntry[]
const bundles = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/bundles.json'), 'utf8')) as Bundle[]
const existing = (fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : []) as PackageDoc[]
const existingByKey = new Map(existing.map((d) => [`${d.lang}:${d.name}`, d]))

// 去重收集所有 (lang, name)
const targets = new Map<string, { lang: Lang; name: string }>()
for (const e of aliases) for (const p of e.packages) targets.set(`${e.lang}:${p.name}`, { lang: e.lang, name: p.name })
for (const b of bundles) for (const p of b.packages) targets.set(`${b.lang}:${p.name}`, { lang: b.lang, name: p.name })

const list = [...targets.values()].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
console.log(`共 ${list.length} 个包（rust ${list.filter((t) => t.lang === 'rust').length} / python ${list.filter((t) => t.lang === 'python').length} / js ${list.filter((t) => t.lang === 'js').length}）`)

const results = new Map<string, PackageDoc>()
const failures: { key: string; error: string }[] = []
let done = 0

async function worker(queue: { lang: Lang; name: string }[]) {
  for (;;) {
    const t = queue.shift()
    if (!t) return
    const key = `${t.lang}:${t.name}`
    const old = existingByKey.get(key)
    if (old?.curated) {
      results.set(key, old) // 人工条目不动
    } else {
      try {
        const doc = await fetchPackageDoc(t.lang, t.name)
        results.set(key, doc)
      } catch (e: any) {
        failures.push({ key, error: String(e?.message ?? e) })
        if (old) results.set(key, old) // 失败时保留旧数据
      }
    }
    done++
    if (done % 20 === 0 || done === list.length) console.log(`  ${done}/${list.length}`)
  }
}

const queue = [...list]
await Promise.all(Array.from({ length: 4 }, () => worker(queue)))

const out = [...results.values()].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n')

const withQs = out.filter((d) => d.quickstart).length
console.log(`\n写入 ${OUT_FILE}`)
console.log(`  ${out.length} 条资料，其中 ${withQs} 条带 quickstart 代码（${out.length - withQs} 条只有摘要/链接）`)
if (failures.length) {
  console.log(`\n抓取失败 ${failures.length} 个：`)
  for (const f of failures) console.log(`  ${f.key}: ${f.error}`)
}
