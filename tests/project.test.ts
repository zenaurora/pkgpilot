import { describe, expect, test } from 'bun:test'
import { parseCargoToml, parsePackageJson, parsePep508Name, parsePyprojectToml } from '../src/core/project.ts'

describe('parseCargoToml', () => {
  test('parses string and table deps with features', () => {
    const { name, dependencies } = parseCargoToml(`
[package]
name = "demo"
version = "0.1.0"

[dependencies]
anyhow = "1"
tokio = { version = "1.40", features = ["macros", "rt-multi-thread"] }
local = { path = "../local" }

[dev-dependencies]
insta = "1"
`)
    expect(name).toBe('demo')
    expect(dependencies).toHaveLength(4)
    const tokio = dependencies.find((d) => d.name === 'tokio')!
    expect(tokio.version).toBe('1.40')
    expect(tokio.features).toEqual(['macros', 'rt-multi-thread'])
    expect(dependencies.find((d) => d.name === 'local')!.version).toBe('path:../local')
    expect(dependencies.find((d) => d.name === 'insta')!.dev).toBe(true)
  })
})

describe('parsePep508Name', () => {
  test('plain name', () => {
    expect(parsePep508Name('numpy')).toEqual({ name: 'numpy', version: '' })
  })
  test('version specifier and marker', () => {
    expect(parsePep508Name("numpy>=1.26,<2 ; python_version>'3.9'")).toEqual({
      name: 'numpy',
      version: '>=1.26,<2',
    })
  })
  test('extras', () => {
    expect(parsePep508Name('httpx[http2]>=0.27').name).toBe('httpx')
  })
})

describe('parsePyprojectToml', () => {
  test('parses project deps and dev groups', () => {
    const { name, dependencies } = parsePyprojectToml(`
[project]
name = "myproj"
dependencies = ["torch>=2.0", "tqdm"]

[dependency-groups]
dev = ["pytest>=8"]
`)
    expect(name).toBe('myproj')
    expect(dependencies.map((d) => d.name)).toEqual(['torch', 'tqdm', 'pytest'])
    expect(dependencies.find((d) => d.name === 'pytest')!.dev).toBe(true)
  })
})

describe('parsePackageJson', () => {
  test('parses deps and devDeps', () => {
    const { dependencies } = parsePackageJson(
      JSON.stringify({ name: 'x', dependencies: { vue: '^3.5.0' }, devDependencies: { vite: '^6.0.0' } }),
    )
    expect(dependencies).toHaveLength(2)
    expect(dependencies.find((d) => d.name === 'vite')!.dev).toBe(true)
  })
})
