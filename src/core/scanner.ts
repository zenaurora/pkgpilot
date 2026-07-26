import fs from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'
import rulesData from '../data/scan-rules.json'
import type { Lang, ScanFinding, ScanHit, ScanRule } from './types.ts'

const GLOB_BY_LANG: Record<Lang, string> = {
  rust: '**/*.rs',
  python: '**/*.py',
  js: '**/*.{js,jsx,ts,tsx,mjs,cjs}',
}

const IGNORE = [
  '**/node_modules/**',
  '**/target/**',
  '**/dist/**',
  '**/build/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.git/**',
  '**/.next/**',
  '**/site-packages/**',
  '**/.uv-cache/**',
  '**/*.min.js',
  '**/*.d.ts',
]

const MAX_FILE_BYTES = 1024 * 1024
const MAX_HITS_PER_RULE = 50

export function loadRules(): ScanRule[] {
  return rulesData as ScanRule[]
}

/** Run rules of one lang against pre-read file contents. Pure, testable. */
export function applyRules(
  rules: ScanRule[],
  files: { path: string; content: string }[],
): ScanFinding[] {
  const findings: ScanFinding[] = []
  for (const rule of rules) {
    let re: RegExp
    try {
      re = new RegExp(rule.pattern, rule.flags ?? '')
    } catch {
      continue
    }
    const hits: ScanHit[] = []
    for (const file of files) {
      const lines = file.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= MAX_HITS_PER_RULE) break
        if (re.test(lines[i])) {
          hits.push({ file: file.path, line: i + 1, snippet: lines[i].trim().slice(0, 100) })
        }
      }
    }
    if (hits.length >= rule.minHits) {
      findings.push({ rule, hits })
    }
  }
  return findings
}

export async function scanProject(root: string, lang: Lang): Promise<ScanFinding[]> {
  const paths = await fg(GLOB_BY_LANG[lang], {
    cwd: root,
    ignore: IGNORE,
    absolute: false,
    onlyFiles: true,
    suppressErrors: true,
  })
  const files: { path: string; content: string }[] = []
  for (const rel of paths) {
    try {
      const abs = path.join(root, rel)
      if (fs.statSync(abs).size > MAX_FILE_BYTES) continue
      files.push({ path: rel, content: fs.readFileSync(abs, 'utf8') })
    } catch {
      // unreadable file, skip
    }
  }
  const rules = loadRules().filter((r) => r.lang === lang)
  return applyRules(rules, files)
}
