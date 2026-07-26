export type Lang = 'rust' | 'python' | 'js'

export const LANG_LABEL: Record<Lang, string> = {
  rust: 'Rust (cargo)',
  python: 'Python (uv)',
  js: 'JS/TS',
}

export interface Dependency {
  name: string
  version: string
  dev?: boolean
  features?: string[]
}

export type JsManager = 'bun' | 'pnpm' | 'yarn' | 'npm'

export interface ProjectInfo {
  lang: Lang
  root: string
  manifestPath: string
  name: string
  /** only for lang === 'js' */
  jsManager?: JsManager
  dependencies: Dependency[]
}

/** A package queued in the install cart */
export interface PendingPackage {
  name: string
  lang: Lang
  dev?: boolean
  features?: string[]
  note?: string
}

/** A shell command ready to be executed */
export interface Command {
  bin: string
  args: string[]
  cwd: string
}

export interface BundlePackage {
  name: string
  features?: string[]
  dev?: boolean
  note?: string
  /** 槽位名：同 group 的包互斥，选一个即可（如 "Web 框架"：axum / actix-web） */
  group?: string
  /** 该槽位的推荐默认项 */
  default?: boolean
}

export interface Bundle {
  name: string
  lang: Lang
  tags: string[]
  description?: string
  packages: BundlePackage[]
  /** true when loaded from ~/.config/pkgpilot */
  user?: boolean
}

export interface AliasEntry {
  keywords: string[]
  lang: Lang
  packages: { name: string; note?: string; features?: string[] }[]
}

export interface ScanRule {
  id: string
  lang: Lang
  name: string
  pattern: string
  flags?: string
  minHits: number
  /** empty string means "no package needed", reason explains */
  suggest: string
  reason: string
}

export interface ScanHit {
  file: string
  line: number
  snippet: string
}

export interface ScanFinding {
  rule: ScanRule
  hits: ScanHit[]
}

export interface RegistryResult {
  name: string
  version: string
  description: string
  downloads?: number
}
