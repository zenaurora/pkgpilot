import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useState } from 'react'
import { KeyHints } from '../components/KeyHints.tsx'
import { SelectList, type ListItem } from '../components/SelectList.tsx'
import { useAppCtx } from '../context.ts'
import { searchAliases } from '../core/aliases.ts'
import { searchRegistry } from '../core/registry/index.ts'
import type { PendingPackage, RegistryResult } from '../core/types.ts'
import { sym, ui } from '../theme.ts'

interface Props {
  active: boolean
}

interface ResultRow {
  pkg: PendingPackage
  label: string
  hint?: string
}

function fmtDownloads(n?: number): string {
  if (!n) return ''
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)}M↓`
  if (n > 1_000) return `${(n / 1_000).toFixed(0)}K↓`
  return `${n}↓`
}

/** Find packages by feature keyword (alias table) or by name (registry). */
export function SearchScreen({ active }: Props) {
  const ctx = useAppCtx()
  const [query, setQuery] = useState('')
  const [typing, setTyping] = useState(true)
  const [aliasRows, setAliasRows] = useState<ResultRow[]>([])
  const [registryRows, setRegistryRows] = useState<ResultRow[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  const lang = ctx.project.lang

  // entering/leaving this screen toggles keyboard ownership
  useEffect(() => {
    ctx.setInputActive(active && typing)
  }, [active, typing]) // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = async (q: string) => {
    const matches = searchAliases(lang, q)
    setAliasRows(
      matches.flatMap((m) =>
        m.entry.packages.map((p) => ({
          pkg: { name: p.name, lang, features: p.features, note: p.note },
          label: p.name,
          hint: `${p.note ?? ''}  [${m.entry.keywords[0]}]`,
        })),
      ),
    )
    setSearching(true)
    setError('')
    try {
      const results: RegistryResult[] = await searchRegistry(lang, q)
      setRegistryRows(
        results.map((r) => ({
          pkg: { name: r.name, lang },
          label: `${r.name} ${r.version}`,
          hint: [r.description.slice(0, 60), fmtDownloads(r.downloads)].filter(Boolean).join('  '),
        })),
      )
    } catch (e: any) {
      setRegistryRows([])
      setError(`注册表搜索失败: ${e?.message ?? e}`)
    } finally {
      setSearching(false)
    }
  }

  useInput(
    (input, key) => {
      if (input === '/' || key.escape) {
        setTyping(true)
      }
    },
    { isActive: active && !typing },
  )

  // Esc while typing returns to the result list (TextInput ignores escape)
  useInput(
    (_input, key) => {
      if (key.escape && (aliasRows.length || registryRows.length)) {
        setTyping(false)
      }
    },
    { isActive: active && typing },
  )

  const rows: (ResultRow & { section?: string })[] = [
    ...aliasRows.map((r, i) => ({ ...r, section: i === 0 ? '本地推荐' : undefined })),
    ...registryRows.map((r, i) => ({ ...r, section: i === 0 ? '注册表' : undefined })),
  ]

  const items: ListItem[] = rows.map((r, i) => ({
    key: `${i}-${r.pkg.name}`,
    label: (r.section ? `[${r.section}] ` : '') + r.label,
    hint: r.hint,
  }))

  const addRow = (i: number, withFeatures: boolean) => {
    const row = rows[i]
    if (!row) return
    if (withFeatures && lang === 'rust') {
      ctx.openFeatures(row.pkg)
    } else {
      ctx.addToCart(row.pkg)
      ctx.setStatus(`已加入清单: ${row.pkg.name}`)
    }
  }

  const [highlight, setHighlight] = useState(0)
  useInput(
    (input) => {
      if (input === 'f') addRow(highlight, true)
      if (input === 'D') {
        const row = rows[highlight]
        if (row) {
          ctx.addToCart({ ...row.pkg, dev: true })
          ctx.setStatus(`已加入清单(dev): ${row.pkg.name}`)
        }
      }
    },
    { isActive: active && !typing },
  )

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={typing ? ui.accent : undefined} dimColor={!typing}>
          {sym.cursor} 搜索{' '}
        </Text>
        {typing ? (
          <TextInput
            value={query}
            onChange={setQuery}
            onSubmit={(v) => {
              setTyping(false)
              void runSearch(v)
            }}
            placeholder="想要什么功能？中文也行：加密 / 进度条 / 动画，或直接输包名"
          />
        ) : (
          <Text>{query}</Text>
        )}
      </Box>
      <Box marginTop={1}>
        {typing ? (
          <KeyHints
            hints={[
              ['↵', '搜索'],
              ...(rows.length ? ([['esc', '回到结果']] as [string, string][]) : []),
            ]}
          />
        ) : (
          <KeyHints
            hints={[
              ['↵', '加入清单'],
              ['D', '作为 dev 依赖'],
              ...(lang === 'rust' ? ([['f', '选 features 后加入']] as [string, string][]) : []),
              ['/', '重新输入'],
            ]}
          />
        )}
      </Box>
      {searching && <Text dimColor>正在搜索注册表{sym.more}</Text>}
      {error && <Text color={ui.danger}>{sym.fail} {error}</Text>}
      <Box marginTop={1} flexDirection="column">
        <SelectList
          focused={active && !typing}
          maxHeight={14}
          emptyText={query ? '没找到结果 — 换个说法或试试英文关键词' : '输入关键词后按 ↵ 搜索'}
          items={items}
          onHighlight={setHighlight}
          onEnter={(i) => addRow(i, false)}
        />
      </Box>
    </Box>
  )
}
