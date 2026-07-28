import { describe, expect, test } from 'bun:test'
import {
  analyzeJsDeps,
  defaultBinNames,
  extractJsSpecifiers,
  isTestPath,
  matchesAlias,
  referencedInScripts,
  specifierToPackage,
  typesRuntimeFor,
} from '../src/core/slim.ts'

describe('specifierToPackage', () => {
  test('普通包 / 子路径 / scoped 包', () => {
    expect(specifierToPackage('react')).toBe('react')
    expect(specifierToPackage('lodash/get')).toBe('lodash')
    expect(specifierToPackage('@tanstack/react-query/devtools')).toBe('@tanstack/react-query')
  })

  test('相对路径、绝对路径、协议前缀都不是包', () => {
    expect(specifierToPackage('./util.ts')).toBeUndefined()
    expect(specifierToPackage('../x')).toBeUndefined()
    expect(specifierToPackage('/abs/path')).toBeUndefined()
    expect(specifierToPackage('node:fs')).toBeUndefined()
    expect(specifierToPackage('bun:test')).toBeUndefined()
  })
})

describe('matchesAlias / isTestPath / typesRuntimeFor', () => {
  test('tsconfig paths 别名', () => {
    expect(matchesAlias('@/utils/x', ['@/*'])).toBe(true)
    expect(matchesAlias('~config', ['~config'])).toBe(true)
    expect(matchesAlias('@tanstack/react-query', ['@/*'])).toBe(false)
  })

  test('测试路径判定', () => {
    expect(isTestPath('tests/upgrade.test.ts')).toBe(true)
    expect(isTestPath('src/__tests__/x.ts')).toBe(true)
    expect(isTestPath('src/foo.spec.tsx')).toBe(true)
    expect(isTestPath('src/screens/Dashboard.tsx')).toBe(false)
    expect(isTestPath('src/testing-utils.ts')).toBe(false)
  })

  test('@types 与运行时包配对（含 DT 双下划线约定）', () => {
    expect(typesRuntimeFor('@types/react')).toBe('react')
    expect(typesRuntimeFor('@types/babel__core')).toBe('@babel/core')
    expect(typesRuntimeFor('react')).toBeUndefined()
  })
})

describe('referencedInScripts', () => {
  test('词边界命中，前缀串不误判', () => {
    expect(referencedInScripts('tsc --noEmit && bun test', ['tsc'])).toBe(true)
    expect(referencedInScripts('bunx vite build', ['vite'])).toBe(true)
    expect(referencedInScripts('vitest run', ['vite'])).toBe(false)
  })

  test('defaultBinNames：typescript→tsc，scoped 去前缀', () => {
    expect(defaultBinNames('typescript')).toEqual(['tsc', 'tsserver'])
    expect(defaultBinNames('@biomejs/biome')).toEqual(['biome'])
    expect(defaultBinNames('eslint')).toEqual(['eslint'])
  })
})

describe('extractJsSpecifiers（Bun.Transpiler 真解析）', () => {
  test('静态 import / 动态 import / require / export from 都收集', () => {
    const src = [
      "import { useState } from 'react'",
      "export { z } from 'zod'",
      "const p = await import('fuse.js')",
      'const glob = require("fast-glob")',
    ].join('\n')
    const specs = extractJsSpecifiers('src/x.ts', src)
    expect(specs).toContain('react')
    expect(specs).toContain('zod')
    expect(specs).toContain('fuse.js')
    expect(specs).toContain('fast-glob')
  })

  test('字符串里出现包名不算引用（正则档做不到的）', () => {
    const specs = extractJsSpecifiers('src/x.ts', 'const s = "react is cool"; const t = `from \'ink\'`')
    expect(specs).not.toContain('react')
    expect(specs).not.toContain('ink')
  })

  test('type-only import 也算（包在类型层被用到）', () => {
    const specs = extractJsSpecifiers('src/x.ts', "import type { Foo } from 'some-lib'\nexport type { B } from 'other-lib'")
    expect(specs).toContain('some-lib')
    expect(specs).toContain('other-lib')
  })
})

describe('analyzeJsDeps', () => {
  const base = { scriptsText: '', configText: '', aliases: [] as string[] }

  test('真未引用报 unused，字符串提及不救场', () => {
    const r = analyzeJsDeps({
      ...base,
      deps: [
        { name: 'react', version: '^18' },
        { name: 'lodash', version: '^4' },
      ],
      files: [{ path: 'src/a.ts', content: "import React from 'react'\nconst s = 'lodash'" }],
    })
    expect(r.unused).toEqual(['lodash'])
    expect(r.misplaced).toEqual([])
  })

  test('工具包出现在 scripts 里就算在用，否则报 unused', () => {
    const deps = [
      { name: 'typescript', version: '^5', dev: true },
      { name: 'rimraf', version: '^5', dev: true },
    ]
    const withScripts = analyzeJsDeps({
      ...base,
      deps,
      files: [],
      scriptsText: 'tsc --noEmit && bun test',
    })
    expect(withScripts.unused).toEqual(['rimraf'])
  })

  test('工具包在 rc 配置原文里宽松命中也算在用', () => {
    const r = analyzeJsDeps({
      ...base,
      deps: [{ name: 'autoprefixer', version: '^10', dev: true }],
      files: [],
      configText: '{ "plugins": { "autoprefixer": {} } }',
    })
    expect(r.unused).toEqual([])
  })

  test('@types 跟运行时包走：runtime 在用则 @types 在用', () => {
    const r = analyzeJsDeps({
      ...base,
      deps: [
        { name: 'react', version: '^18' },
        { name: '@types/react', version: '^18', dev: true },
        { name: '@types/lodash', version: '^4', dev: true },
        { name: '@types/bun', version: '^1', dev: true },
      ],
      files: [{ path: 'src/a.tsx', content: "import React from 'react'" }],
    })
    expect(r.unused).toEqual(['@types/lodash'])
  })

  test('仅测试引用的非 dev 依赖报 misplaced', () => {
    const r = analyzeJsDeps({
      ...base,
      deps: [
        { name: 'zod', version: '^3' },
        { name: 'msw', version: '^2' },
      ],
      files: [
        { path: 'src/a.ts', content: "import { z } from 'zod'" },
        { path: 'tests/a.test.ts', content: "import { setupServer } from 'msw'" },
      ],
    })
    expect(r.unused).toEqual([])
    expect(r.misplaced).toEqual(['msw'])
  })

  test('tsconfig 别名不当成包', () => {
    const r = analyzeJsDeps({
      ...base,
      aliases: ['@/*'],
      deps: [{ name: 'react', version: '^18' }],
      files: [{ path: 'src/a.ts', content: "import { x } from '@/utils'\nimport R from 'react'" }],
    })
    expect(r.unused).toEqual([])
  })
})
