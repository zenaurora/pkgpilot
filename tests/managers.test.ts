import { describe, expect, test } from 'bun:test'
import { cargoAddCommands } from '../src/core/managers/cargo.ts'
import { buildAddCommands, buildRemoveCommands, formatCommand } from '../src/core/managers/index.ts'
import type { PendingPackage, ProjectInfo } from '../src/core/types.ts'

const rustProject: ProjectInfo = {
  lang: 'rust',
  root: '/tmp/demo',
  manifestPath: '/tmp/demo/Cargo.toml',
  name: 'demo',
  dependencies: [],
}

const jsProject: ProjectInfo = { ...rustProject, lang: 'js', jsManager: 'pnpm' }
const pyProject: ProjectInfo = { ...rustProject, lang: 'python' }

describe('cargoAddCommands', () => {
  test('groups plain packages, separates featured packages', () => {
    const pkgs: PendingPackage[] = [
      { name: 'anyhow', lang: 'rust' },
      { name: 'thiserror', lang: 'rust' },
      { name: 'tokio', lang: 'rust', features: ['macros', 'rt-multi-thread'] },
      { name: 'insta', lang: 'rust', dev: true },
    ]
    const cmds = cargoAddCommands('/tmp/demo', pkgs)
    expect(cmds.map(formatCommand)).toEqual([
      'cargo add anyhow thiserror',
      'cargo add tokio --features macros,rt-multi-thread',
      'cargo add --dev insta',
    ])
  })
})

describe('buildAddCommands', () => {
  test('filters cart by project lang', () => {
    const cart: PendingPackage[] = [
      { name: 'tokio', lang: 'rust' },
      { name: 'tqdm', lang: 'python' },
    ]
    expect(buildAddCommands(rustProject, cart).map(formatCommand)).toEqual(['cargo add tokio'])
    expect(buildAddCommands(pyProject, cart).map(formatCommand)).toEqual(['uv add tqdm'])
  })

  test('js manager verbs and dev flag', () => {
    const cart: PendingPackage[] = [
      { name: 'motion', lang: 'js' },
      { name: 'vitest', lang: 'js', dev: true },
    ]
    expect(buildAddCommands(jsProject, cart).map(formatCommand)).toEqual([
      'pnpm add motion',
      'pnpm add -D vitest',
    ])
    expect(buildAddCommands({ ...jsProject, jsManager: 'npm' }, cart).map(formatCommand)).toEqual([
      'npm install motion',
      'npm install -D vitest',
    ])
  })
})

describe('buildRemoveCommands', () => {
  test('per-lang remove verbs', () => {
    expect(buildRemoveCommands(rustProject, ['serde']).map(formatCommand)).toEqual(['cargo remove serde'])
    expect(buildRemoveCommands(pyProject, ['tqdm']).map(formatCommand)).toEqual(['uv remove tqdm'])
    expect(buildRemoveCommands({ ...jsProject, jsManager: 'npm' }, ['ky']).map(formatCommand)).toEqual([
      'npm uninstall ky',
    ])
    expect(buildRemoveCommands(rustProject, [])).toEqual([])
  })
})
