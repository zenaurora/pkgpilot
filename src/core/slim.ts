import fs from 'node:fs/promises'
import nodePath from 'node:path'
import fg from 'fast-glob'
import type { Dependency, Lang, ProjectInfo } from './types.ts'

/**
 * 依赖瘦身：找出声明了却没被引用的依赖。
 * - rust / python：正则档，扫源码里的 use / import 文本。
 * - js / ts：真解析档（思路对齐 cargo-shear）—— Bun.Transpiler 提取 import，
 *   加上 package.json scripts 的 bin 引用、@types 与运行时包配对、
 *   tsconfig paths 别名排除，以及"仅测试代码引用 → 建议移入 dev"检测。
 * 结果只是"候选"——最终由用户在界面上确认后才移除。
 */

/** 无法通过 import 检测的工具类包（配置文件驱动 / 隐式加载） */
const JS_TOOL_PREFIXES = ['@types/', '@typescript-eslint/', '@vitejs/', '@biomejs/', 'eslint-', 'vite-plugin-', 'babel-', '@babel/', 'postcss-', 'prettier-plugin-']
const JS_TOOLS = new Set([
  'typescript', 'eslint', 'prettier', 'vite', 'webpack', 'rollup', 'esbuild', 'tsx', 'ts-node',
  'jest', 'vitest', 'mocha', 'husky', 'lint-staged', 'nodemon', 'concurrently', 'rimraf', 'cross-env',
  'tailwindcss', 'postcss', 'autoprefixer', 'turbo', 'biome',
])
const PY_TOOLS = new Set(['black', 'ruff', 'mypy', 'flake8', 'isort', 'pre-commit', 'tox', 'pip', 'setuptools', 'wheel', 'build', 'twine'])

/** pip 包名和 import 名不一致的常见映射 */
const PY_IMPORT_MAP: Record<string, string[]> = {
  'pillow': ['PIL'],
  'beautifulsoup4': ['bs4'],
  'scikit-learn': ['sklearn'],
  'scikit-image': ['skimage'],
  'pyyaml': ['yaml'],
  'python-dotenv': ['dotenv'],
  'python-dateutil': ['dateutil'],
  'opencv-python': ['cv2'],
  'protobuf': ['google.protobuf', 'google'],
  'grpcio': ['grpc'],
  'pymongo': ['pymongo', 'bson', 'gridfs'],
  'attrs': ['attr', 'attrs'],
}

export function isToolPackage(lang: Lang, name: string): boolean {
  const n = name.toLowerCase()
  if (lang === 'js') return JS_TOOLS.has(n) || JS_TOOL_PREFIXES.some((p) => n.startsWith(p))
  if (lang === 'python') return PY_TOOLS.has(n)
  return false
}

/** 一个依赖在源码里可能出现的 import 名 */
export function moduleNamesFor(lang: Lang, name: string): string[] {
  if (lang === 'rust') return [name.replace(/-/g, '_')]
  if (lang === 'python') {
    const n = name.toLowerCase()
    return PY_IMPORT_MAP[n] ?? [n.replace(/-/g, '_')]
  }
  return [name]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 判断某个依赖是否在源码文本里被引用（正则档；js 分支现仅作兜底） */
export function isReferenced(lang: Lang, depName: string, source: string): boolean {
  for (const mod of moduleNamesFor(lang, depName)) {
    const m = escapeRe(mod)
    let re: RegExp
    if (lang === 'rust') {
      // use serde::…、serde_json::to_string、#[tokio::main]、extern crate
      re = new RegExp(`\\buse\\s+${m}\\b|\\b${m}::|extern\\s+crate\\s+${m}\\b`)
    } else if (lang === 'python') {
      re = new RegExp(`(^|\\n)\\s*(import\\s+${m}\\b|from\\s+${m}\\b)`)
    } else {
      // from 'x' / require('x') / import('x')，含子路径 'x/…'
      re = new RegExp(`['"]${m}(['"]|/)`)
    }
    if (re.test(source)) return true
  }
  return false
}

export interface SlimReport {
  /** 源码里没引用到的依赖（候选，需人工确认） */
  unused: string[]
  /** 只被测试代码引用的非 dev 依赖，建议移入 devDependencies（仅 js） */
  misplaced: string[]
  /** 工具类包，静态扫描测不出来，已跳过（rust/python 档） */
  skipped: string[]
  filesScanned: number
}

/** 对给定源码全文找未引用依赖（正则档，rust/python 用；纯函数可测试） */
export function findUnusedInSource(lang: Lang, deps: Dependency[], source: string): Omit<SlimReport, 'filesScanned' | 'misplaced'> {
  const unused: string[] = []
  const skipped: string[] = []
  for (const d of deps) {
    if (isToolPackage(lang, d.name)) skipped.push(d.name)
    else if (!isReferenced(lang, d.name, source)) unused.push(d.name)
  }
  return { unused, skipped }
}

// ───────────────── js/ts 真解析档 ─────────────────

/** import specifier → npm 包名；相对路径、绝对路径、node:/bun: 协议都不是包 */
export function specifierToPackage(spec: string): string | undefined {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.includes(':')) return undefined
  const parts = spec.split('/')
  if (spec.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
  return parts[0]
}

/** tsconfig paths 里的别名模式（'@/*'、'~/utils'）——命中的 specifier 不算包 */
export function matchesAlias(spec: string, aliases: string[]): boolean {
  return aliases.some((a) => (a.endsWith('*') ? spec.startsWith(a.slice(0, -1)) : spec === a))
}

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|__mocks__)\/|[._](test|spec)\.[cm]?[jt]sx?$/
export function isTestPath(relPath: string): boolean {
  return TEST_PATH_RE.test(relPath)
}

/** '@types/react' → 'react'，'@types/babel__core' → '@babel/core'（DT 双下划线约定） */
export function typesRuntimeFor(name: string): string | undefined {
  if (!name.startsWith('@types/')) return undefined
  const rest = name.slice('@types/'.length)
  return rest.includes('__') ? `@${rest.replace('__', '/')}` : rest
}

/** 包名和 bin 名不同的常见映射；其余包默认 bin 就叫自己（去掉 scope） */
const KNOWN_BINS: Record<string, string[]> = {
  'typescript': ['tsc', 'tsserver'],
  '@biomejs/biome': ['biome'],
}
export function defaultBinNames(name: string): string[] {
  return KNOWN_BINS[name] ?? [name.startsWith('@') ? (name.split('/')[1] ?? name) : name]
}

/** scripts 命令文本里是否出现某个 bin（词边界，'tsc --noEmit'、'bunx vite build' 都算） */
export function referencedInScripts(scriptsText: string, binNames: string[]): boolean {
  return binNames.some((b) =>
    new RegExp(`(^|[\\s"'&|;(])${escapeRe(b)}($|[\\s"'&|;)])`).test(scriptsText),
  )
}

type JsLoader = 'js' | 'jsx' | 'ts' | 'tsx'
const LOADER_BY_EXT: Record<string, JsLoader> = {
  '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx',
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx',
}
const transpilers = new Map<JsLoader, Bun.Transpiler>()
function transpilerFor(loader: JsLoader): Bun.Transpiler {
  let t = transpilers.get(loader)
  if (!t) {
    t = new Bun.Transpiler({ loader })
    transpilers.set(loader, t)
  }
  return t
}

// scanImports 会擦掉 type-only import，某些 require 形态也可能漏——正则补齐
const TYPE_IMPORT_RE = /(?:import|export)\s+type\b[^'"]*from\s*['"]([^'"]+)['"]/g
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
// 解析失败时的兜底（老正则档）
const FALLBACK_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm

/** 用 Bun.Transpiler 从一个 js/ts 文件里提取全部 import specifier（真解析，字符串里出现包名不算） */
export function extractJsSpecifiers(filePath: string, content: string): string[] {
  const out = new Set<string>()
  const loader = LOADER_BY_EXT[nodePath.extname(filePath)] ?? 'tsx'
  try {
    for (const imp of transpilerFor(loader).scanImports(content)) out.add(imp.path)
  } catch {
    for (const m of content.matchAll(FALLBACK_IMPORT_RE)) out.add(m[1])
  }
  for (const m of content.matchAll(TYPE_IMPORT_RE)) out.add(m[1])
  for (const m of content.matchAll(REQUIRE_RE)) out.add(m[1])
  return [...out]
}

export interface JsSlimInput {
  deps: Dependency[]
  /** path 为相对项目根的路径（测试文件判定用） */
  files: { path: string; content: string }[]
  /** package.json 里所有 scripts 命令拼接（注意：不能混入依赖表，否则自引用） */
  scriptsText: string
  /** .eslintrc / .babelrc 等 rc 原文，工具类包宽松匹配兜底用 */
  configText: string
  /** tsconfig paths 别名模式 */
  aliases: string[]
  /** 包名 → 实际 bin 名（node_modules 里读到的精确值） */
  bins?: Map<string, string[]>
}

/** js/ts 依赖分析（纯函数）：unused=没引用，misplaced=仅测试引用的非 dev 依赖 */
export function analyzeJsDeps(input: JsSlimInput): Omit<SlimReport, 'filesScanned'> {
  const importedAll = new Set<string>()
  const importedProd = new Set<string>()
  for (const f of input.files) {
    const inTest = isTestPath(f.path)
    for (const spec of extractJsSpecifiers(f.path, f.content)) {
      if (matchesAlias(spec, input.aliases)) continue
      const pkg = specifierToPackage(spec)
      if (!pkg) continue
      importedAll.add(pkg)
      if (!inTest) importedProd.add(pkg)
    }
  }

  const inScripts = (name: string) =>
    referencedInScripts(input.scriptsText, input.bins?.get(name) ?? defaultBinNames(name))
  // 工具类包常以字符串 / 对象键出现在配置里（postcss plugins、eslint extends…），宽松词匹配兜底
  const looseCorpus = `${input.configText}\n${input.files.map((f) => f.content).join('\n')}`
  const looseHit = (name: string) =>
    new RegExp(`(^|[^\\w@/-])${escapeRe(name)}([^\\w-]|$)`).test(looseCorpus)

  const unused: string[] = []
  const misplaced: string[] = []
  for (const d of input.deps) {
    // @types/node、@types/bun 跟运行时走，永远算在用
    if (d.name === '@types/node' || d.name === '@types/bun') continue
    // @types/x 的生死跟着 x 走
    const effective = typesRuntimeFor(d.name) ?? d.name
    const imported = importedAll.has(effective)
    const scripted = inScripts(effective) || (effective !== d.name && inScripts(d.name))
    if (!imported && !scripted) {
      // 工具类最后再宽松匹配一次配置原文，还找不到才报
      if (isToolPackage('js', effective) && looseHit(effective)) continue
      unused.push(d.name)
    } else if (!d.dev && imported && !importedProd.has(effective) && !scripted) {
      misplaced.push(d.name)
    }
  }
  return { unused, misplaced, skipped: [] }
}

// ───────────────── 项目级扫描 ─────────────────

const SOURCE_GLOBS: Record<Lang, string[]> = {
  rust: ['src/**/*.rs', 'tests/**/*.rs', 'benches/**/*.rs', 'examples/**/*.rs', 'build.rs'],
  python: ['**/*.py'],
  js: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'],
}
const IGNORE = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.venv/**', '**/venv/**', '**/target/**', '**/.git/**', '**/__pycache__/**']

/** 容忍注释和尾逗号的 JSON 解析（tsconfig 是 jsonc） */
function parseJsonc(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    try {
      return JSON.parse(
        text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/,\s*([}\]])/g, '$1'),
      )
    } catch {
      return undefined
    }
  }
}

async function readScriptsText(manifestPath: string): Promise<string> {
  try {
    const pkg = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    // 只取 scripts 的命令——manifest 的依赖表不能算引用源
    return Object.values(pkg.scripts ?? {}).join('\n')
  } catch {
    return ''
  }
}

async function readTsconfigAliases(root: string): Promise<string[]> {
  try {
    const cfg = parseJsonc(await fs.readFile(nodePath.join(root, 'tsconfig.json'), 'utf8'))
    return Object.keys(cfg?.compilerOptions?.paths ?? {})
  } catch {
    return []
  }
}

async function readConfigText(root: string): Promise<string> {
  const files = await fg(['.eslintrc*', '.babelrc*', '.prettierrc*', '.stylelintrc*', '.postcssrc*'], {
    cwd: root, dot: true, onlyFiles: true, absolute: true, deep: 1, suppressErrors: true,
  })
  const chunks = await Promise.all(files.map((f) => fs.readFile(f, 'utf8').catch(() => '')))
  return chunks.join('\n')
}

/** 从 node_modules 里读每个依赖真实的 bin 名（没装 node_modules 时用默认映射） */
async function readBinNames(root: string, deps: Dependency[]): Promise<Map<string, string[]>> {
  const bins = new Map<string, string[]>()
  await Promise.all(
    deps.map(async (d) => {
      try {
        const pkg = JSON.parse(
          await fs.readFile(nodePath.join(root, 'node_modules', d.name, 'package.json'), 'utf8'),
        )
        if (typeof pkg.bin === 'string') bins.set(d.name, defaultBinNames(d.name))
        else if (pkg.bin && typeof pkg.bin === 'object') bins.set(d.name, Object.keys(pkg.bin))
      } catch {
        /* 未安装则走 defaultBinNames */
      }
    }),
  )
  return bins
}

/** 扫描项目源码，返回未引用依赖候选 */
export async function findUnusedDeps(project: ProjectInfo): Promise<SlimReport> {
  const files = await fg(SOURCE_GLOBS[project.lang], {
    cwd: project.root,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
  })
  const chunks = await Promise.all(files.map((f) => fs.readFile(f, 'utf8').catch(() => '')))

  if (project.lang !== 'js') {
    // 注意：manifest 本身不能算引用源，否则每个依赖都会被自己的声明"引用"到
    const source = chunks.join('\n')
    return {
      ...findUnusedInSource(project.lang, project.dependencies, source),
      misplaced: [],
      filesScanned: files.length,
    }
  }

  const [scriptsText, aliases, configText, bins] = await Promise.all([
    readScriptsText(project.manifestPath),
    readTsconfigAliases(project.root),
    readConfigText(project.root),
    readBinNames(project.root, project.dependencies),
  ])
  const jsFiles = files.map((f, i) => ({
    path: nodePath.relative(project.root, f),
    content: chunks[i],
  }))
  return {
    ...analyzeJsDeps({
      deps: project.dependencies,
      files: jsFiles,
      scriptsText,
      configText,
      aliases,
      bins,
    }),
    filesScanned: files.length,
  }
}
