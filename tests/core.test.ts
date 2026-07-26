import { describe, expect, test } from 'bun:test'
import { searchAliases } from '../src/core/aliases.ts'
import { allTags, defaultSelection, mergeBundles, toggleSelection } from '../src/core/bundles.ts'
import { applyRules, loadRules } from '../src/core/scanner.ts'
import type { Bundle, ScanRule } from '../src/core/types.ts'

describe('searchAliases', () => {
  test('finds rust bytes crate by Chinese keyword', () => {
    const matches = searchAliases('rust', '字节')
    const names = matches.flatMap((m) => m.entry.packages.map((p) => p.name))
    expect(names).toContain('bytes')
  })

  test('finds tqdm by 进度条', () => {
    const matches = searchAliases('python', '进度条')
    expect(matches.flatMap((m) => m.entry.packages.map((p) => p.name))).toContain('tqdm')
  })

  test('finds motion by 动画 (js only)', () => {
    const matches = searchAliases('js', '动画')
    expect(matches.flatMap((m) => m.entry.packages.map((p) => p.name))).toContain('motion')
    // rust has no animation entry
    expect(searchAliases('rust', '动画')).toHaveLength(0)
  })

  test('empty query returns nothing', () => {
    expect(searchAliases('rust', '  ')).toHaveLength(0)
  })
})

describe('mergeBundles', () => {
  test('user bundle overrides builtin with same name', () => {
    const builtin: Bundle[] = [
      { name: 'a', lang: 'rust', tags: ['x'], packages: [{ name: 'p1' }] },
      { name: 'b', lang: 'rust', tags: ['y'], packages: [{ name: 'p2' }] },
    ]
    const user: Bundle[] = [{ name: 'a', lang: 'rust', tags: ['z'], packages: [{ name: 'p9' }], user: true }]
    const merged = mergeBundles(builtin, user)
    expect(merged).toHaveLength(2)
    expect(merged.find((b) => b.name === 'a')!.packages[0].name).toBe('p9')
    expect(allTags(merged)).toEqual(['y', 'z'])
  })
})

describe('bundle slots', () => {
  const bundle: Bundle = {
    name: 'web',
    lang: 'rust',
    tags: [],
    packages: [
      { name: 'tokio' },
      { name: 'axum', group: 'Web 框架', default: true },
      { name: 'actix-web', group: 'Web 框架' },
      { name: 'sqlx', group: '数据库' }, // no explicit default -> first member wins
      { name: 'sea-orm', group: '数据库' },
      { name: 'serde' },
    ],
  }

  test('defaultSelection picks ungrouped + slot defaults', () => {
    const sel = defaultSelection(bundle)
    expect([...sel].sort()).toEqual(['axum', 'serde', 'sqlx', 'tokio'])
  })

  test('toggleSelection swaps within a slot (radio)', () => {
    let sel = defaultSelection(bundle)
    sel = toggleSelection(bundle, sel, 'actix-web')
    expect(sel.has('actix-web')).toBe(true)
    expect(sel.has('axum')).toBe(false)
    // ungrouped packages untouched
    expect(sel.has('tokio')).toBe(true)
  })

  test('toggleSelection allows deselecting a slot entirely', () => {
    let sel = defaultSelection(bundle)
    sel = toggleSelection(bundle, sel, 'axum')
    expect(sel.has('axum')).toBe(false)
    expect(sel.has('actix-web')).toBe(false)
  })

  test('toggleSelection keeps plain checkbox behavior for ungrouped', () => {
    let sel = defaultSelection(bundle)
    sel = toggleSelection(bundle, sel, 'serde')
    expect(sel.has('serde')).toBe(false)
    sel = toggleSelection(bundle, sel, 'serde')
    expect(sel.has('serde')).toBe(true)
  })
})

describe('applyRules', () => {
  const rules = loadRules()

  test('rust manual byte parsing triggers bytes suggestion', () => {
    const rule = rules.find((r) => r.id === 'rust-manual-byte-parsing')!
    const content = `
let a = u64::from_le_bytes(buf[0..8].try_into().unwrap());
let b = u32::from_le_bytes(buf[8..12].try_into().unwrap());
let c = u16::from_be_bytes(buf[12..14].try_into().unwrap());
`
    const findings = applyRules([rule], [{ path: 'src/main.rs', content }])
    expect(findings).toHaveLength(1)
    expect(findings[0].rule.suggest).toBe('bytes')
    expect(findings[0].hits).toHaveLength(3)
  })

  test('below minHits does not report', () => {
    const rule = rules.find((r) => r.id === 'rust-manual-byte-parsing')!
    const content = 'let a = u64::from_le_bytes(x);'
    expect(applyRules([rule], [{ path: 'a.rs', content }])).toHaveLength(0)
  })

  test('js deep clone rule', () => {
    const rule = rules.find((r) => r.id === 'js-json-deepclone')!
    const findings = applyRules([rule], [{ path: 'a.ts', content: 'const b = JSON.parse(JSON.stringify(a))' }])
    expect(findings).toHaveLength(1)
  })

  test('python tqdm rule matches \\r progress print', () => {
    const rule = rules.find((r) => r.id === 'py-manual-progress')!
    const content = `print(f"{i}/{total}", end="\\r")`
    expect(applyRules([rule], [{ path: 'a.py', content }])).toHaveLength(1)
  })

  test('all rule patterns compile', () => {
    for (const rule of rules as ScanRule[]) {
      expect(() => new RegExp(rule.pattern, rule.flags ?? '')).not.toThrow()
    }
  })
})
