import { describe, expect, test } from 'bun:test'
import { buildUpgradeCommands } from '../src/core/managers/index.ts'
import { bumpLevel, isUpgradable, parseVersionParts } from '../src/core/outdated.ts'
import { findUnusedInSource, isReferenced, isToolPackage, moduleNamesFor } from '../src/core/slim.ts'
import type { ProjectInfo } from '../src/core/types.ts'

describe('parseVersionParts', () => {
  test('各种约束风格都能抠出数字', () => {
    expect(parseVersionParts('^1.2.3')).toEqual([1, 2, 3])
    expect(parseVersionParts('>=2,<3')).toEqual([2, 0, 0])
    expect(parseVersionParts('~=1.4')).toEqual([1, 4, 0])
    expect(parseVersionParts('1')).toEqual([1, 0, 0])
    expect(parseVersionParts('workspace:*')).toBeUndefined()
  })
})

describe('bumpLevel', () => {
  test('major / minor / patch / current', () => {
    expect(bumpLevel('^1.2.3', '2.0.0')).toBe('major')
    expect(bumpLevel('^1.2.3', '1.3.0')).toBe('minor')
    expect(bumpLevel('^1.2.3', '1.2.9')).toBe('patch')
    expect(bumpLevel('^1.2.3', '1.2.3')).toBe('current')
    expect(bumpLevel('^2.0.0', '1.9.9')).toBe('current')
    expect(bumpLevel('workspace:*', '1.0.0')).toBe('unknown')
  })

  test('cargo 简写 "1" 补齐成 1.0.0 再比较', () => {
    expect(bumpLevel('1', '1.0.230')).toBe('patch')
    expect(bumpLevel('0.12', '0.13.1')).toBe('minor')
  })

  test('isUpgradable 只认 major/minor/patch', () => {
    expect(isUpgradable('major')).toBe(true)
    expect(isUpgradable('current')).toBe(false)
    expect(isUpgradable('unknown')).toBe(false)
  })
})

function proj(lang: ProjectInfo['lang'], deps: ProjectInfo['dependencies']): ProjectInfo {
  return { lang, root: '/tmp/x', manifestPath: '/tmp/x/m', name: 'x', dependencies: deps, jsManager: lang === 'js' ? 'bun' : undefined }
}

describe('buildUpgradeCommands', () => {
  test('cargo：name@ver，features 保留，dev 拆开', () => {
    const cmds = buildUpgradeCommands(proj('rust', []), [
      { name: 'serde', latest: '1.0.230', features: ['derive'] },
      { name: 'anyhow', latest: '1.0.100' },
      { name: 'insta', latest: '1.43.0', dev: true },
    ])
    const flat = cmds.map((c) => `${c.bin} ${c.args.join(' ')}`)
    expect(flat).toContain('cargo add anyhow@1.0.100')
    expect(flat).toContain('cargo add serde@1.0.230 --features derive')
    expect(flat).toContain('cargo add --dev insta@1.43.0')
  })

  test('uv：用 name>=ver', () => {
    const cmds = buildUpgradeCommands(proj('python', []), [{ name: 'httpx', latest: '0.28.1' }])
    expect(cmds[0].args).toEqual(['add', 'httpx>=0.28.1'])
  })

  test('js：mgr add name@ver', () => {
    const cmds = buildUpgradeCommands(proj('js', []), [{ name: 'zod', latest: '4.4.3' }])
    expect(cmds[0].bin).toBe('bun')
    expect(cmds[0].args).toEqual(['add', 'zod@4.4.3'])
  })
})

describe('isReferenced', () => {
  test('rust：use / 路径调用 / 属性宏都算引用，连字符转下划线', () => {
    expect(isReferenced('rust', 'serde', 'use serde::Serialize;')).toBe(true)
    expect(isReferenced('rust', 'serde_json', 'let s = serde_json::to_string(&x);')).toBe(true)
    expect(isReferenced('rust', 'tokio', '#[tokio::main]\nasync fn main() {}')).toBe(true)
    expect(isReferenced('rust', 'fast-glob', 'use fast_glob::glob;')).toBe(true)
    expect(isReferenced('rust', 'rand', 'fn random_pick() {}')).toBe(false)
  })

  test('python：import / from，包名映射（pillow→PIL）', () => {
    expect(isReferenced('python', 'requests', 'import requests\n')).toBe(true)
    expect(isReferenced('python', 'pillow', 'from PIL import Image')).toBe(true)
    expect(isReferenced('python', 'scikit-learn', 'from sklearn.cluster import KMeans')).toBe(true)
    expect(isReferenced('python', 'numpy', 'x = "numpy is cool"')).toBe(false)
  })

  test('js：import/require 字符串匹配，含子路径与 scoped 包', () => {
    expect(isReferenced('js', 'react', "import { useState } from 'react'")).toBe(true)
    expect(isReferenced('js', 'lodash', 'const get = require("lodash/get")')).toBe(true)
    expect(isReferenced('js', '@tanstack/react-query', "from '@tanstack/react-query'")).toBe(true)
    expect(isReferenced('js', 'react', "import x from 'react-dom'")).toBe(false)
  })
})

describe('findUnusedInSource', () => {
  test('工具类进 skipped，未引用进 unused', () => {
    const deps = [
      { name: 'react', version: '^18' },
      { name: 'lodash', version: '^4' },
      { name: 'typescript', version: '^5', dev: true },
      { name: '@types/react', version: '^18', dev: true },
    ]
    const src = "import React from 'react'\n"
    const r = findUnusedInSource('js', deps, src)
    expect(r.unused).toEqual(['lodash'])
    expect(r.skipped).toEqual(['typescript', '@types/react'])
  })

  test('isToolPackage 前缀匹配', () => {
    expect(isToolPackage('js', 'eslint-config-foo')).toBe(true)
    expect(isToolPackage('js', 'express')).toBe(false)
    expect(isToolPackage('python', 'ruff')).toBe(true)
    expect(isToolPackage('rust', 'serde')).toBe(false)
  })

  test('moduleNamesFor 映射', () => {
    expect(moduleNamesFor('rust', 'tracing-subscriber')).toEqual(['tracing_subscriber'])
    expect(moduleNamesFor('python', 'python-dotenv')).toEqual(['dotenv'])
    expect(moduleNamesFor('js', '@scope/pkg')).toEqual(['@scope/pkg'])
  })
})
