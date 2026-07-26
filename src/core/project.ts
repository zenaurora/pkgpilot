import fs from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import type { Dependency, JsManager, Lang, ProjectInfo } from './types.ts'

// ---------- manifest parsers (pure, testable) ----------

export function parseCargoToml(text: string): { name: string; dependencies: Dependency[] } {
  const doc = parseToml(text) as any
  const name = doc.package?.name ?? 'unknown'
  const deps: Dependency[] = []
  const collect = (table: any, dev: boolean) => {
    if (!table || typeof table !== 'object') return
    for (const [depName, spec] of Object.entries<any>(table)) {
      if (typeof spec === 'string') {
        deps.push({ name: depName, version: spec, dev: dev || undefined })
      } else if (spec && typeof spec === 'object') {
        deps.push({
          name: depName,
          version: spec.version ?? (spec.path ? `path:${spec.path}` : spec.git ? 'git' : '*'),
          dev: dev || undefined,
          features: Array.isArray(spec.features) && spec.features.length ? spec.features : undefined,
        })
      }
    }
  }
  collect(doc.dependencies, false)
  collect(doc['dev-dependencies'], true)
  return { name, dependencies: deps }
}

/** Extract package name from a PEP 508 requirement string like "numpy>=1.26,<2 ; python_version>'3.9'" */
export function parsePep508Name(req: string): { name: string; version: string } {
  const m = req.trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/)
  if (!m) return { name: req.trim(), version: '' }
  const rest = (m[3] ?? '').split(';')[0].trim()
  return { name: m[1], version: rest }
}

export function parsePyprojectToml(text: string): { name: string; dependencies: Dependency[] } {
  const doc = parseToml(text) as any
  const name = doc.project?.name ?? 'unknown'
  const deps: Dependency[] = []
  for (const req of doc.project?.dependencies ?? []) {
    const { name: n, version } = parsePep508Name(String(req))
    deps.push({ name: n, version })
  }
  // uv-style dev groups
  const groups = doc['dependency-groups'] ?? {}
  for (const reqs of Object.values<any>(groups)) {
    if (!Array.isArray(reqs)) continue
    for (const req of reqs) {
      if (typeof req !== 'string') continue // skip {include-group = ...}
      const { name: n, version } = parsePep508Name(req)
      deps.push({ name: n, version, dev: true })
    }
  }
  return { name, dependencies: deps }
}

export function parsePackageJson(text: string): { name: string; dependencies: Dependency[] } {
  const doc = JSON.parse(text)
  const deps: Dependency[] = []
  for (const [n, v] of Object.entries<string>(doc.dependencies ?? {})) {
    deps.push({ name: n, version: v })
  }
  for (const [n, v] of Object.entries<string>(doc.devDependencies ?? {})) {
    deps.push({ name: n, version: v, dev: true })
  }
  return { name: doc.name ?? 'unknown', dependencies: deps }
}

// ---------- detection ----------

export function detectJsManager(root: string): JsManager {
  if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun'
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function loadProject(lang: Lang, root: string, manifestPath: string): ProjectInfo | null {
  try {
    const text = fs.readFileSync(manifestPath, 'utf8')
    const parsed =
      lang === 'rust' ? parseCargoToml(text) : lang === 'python' ? parsePyprojectToml(text) : parsePackageJson(text)
    return {
      lang,
      root,
      manifestPath,
      name: parsed.name,
      jsManager: lang === 'js' ? detectJsManager(root) : undefined,
      dependencies: parsed.dependencies,
    }
  } catch {
    return null
  }
}

/**
 * Detect projects starting at cwd, walking up until one level with matches is found.
 * A single directory may contain several manifests (e.g. Cargo.toml + package.json).
 */
export function detectProjects(cwd: string): ProjectInfo[] {
  let dir = path.resolve(cwd)
  for (;;) {
    const found: ProjectInfo[] = []
    const cargo = path.join(dir, 'Cargo.toml')
    const pyproject = path.join(dir, 'pyproject.toml')
    const pkgJson = path.join(dir, 'package.json')
    if (fs.existsSync(cargo)) {
      const p = loadProject('rust', dir, cargo)
      if (p) found.push(p)
    }
    if (fs.existsSync(pyproject)) {
      const p = loadProject('python', dir, pyproject)
      if (p) found.push(p)
    }
    if (fs.existsSync(pkgJson)) {
      const p = loadProject('js', dir, pkgJson)
      if (p) found.push(p)
    }
    if (found.length > 0) return found
    const parent = path.dirname(dir)
    if (parent === dir) return []
    dir = parent
  }
}

/** Re-read manifest after add/remove so the dashboard stays fresh */
export function reloadProject(project: ProjectInfo): ProjectInfo {
  return loadProject(project.lang, project.root, project.manifestPath) ?? project
}
