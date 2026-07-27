import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useRef, useState } from 'react'
import { KeyHints } from '../components/KeyHints.tsx'
import { SelectList, type ListItem } from '../components/SelectList.tsx'
import { useAppCtx } from '../context.ts'
import { searchAliases } from '../core/aliases.ts'
import { loadLlmConfig, recommendPackages } from '../core/llm.ts'
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
  const [aiRows, setAiRows] = useState<ResultRow[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  // 同步闸门：同一批按键里连按 a 不会发两次请求（state 在 re-render 前读不到新值）
  const aiBusy = useRef(false)
  // 请求序号：新搜索/新请求会使飞行中的旧响应作废
  const aiReqId = useRef(0)

  const lang = ctx.project.lang

  // entering/leaving this screen toggles keyboard ownership
  useEffect(() => {
    ctx.setInputActive(active && typing)
  }, [active, typing]) // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = async (q: string) => {
    aiReqId.current++
    setAiRows([])
    setSearched(true)
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

  const runAi = async () => {
    if (aiBusy.current || !query.trim()) return
    const cfg = loadLlmConfig()
    if (!cfg.ok) {
      setError(cfg.reason)
      return
    }
    aiBusy.current = true
    const id = ++aiReqId.current
    setAiLoading(true)
    setError('')
    try {
      const existing = ctx.project.dependencies.map((d) => d.name)
      const recs = await recommendPackages(cfg.config, lang, query, existing)
      if (id === aiReqId.current) {
        setAiRows(
          recs.map((r) => ({
            // 非 Rust 的包管理器不支持 features，丢弃以免清单展示与实际命令不一致
            pkg: { name: r.name, lang, features: lang === 'rust' ? r.features : undefined, dev: r.dev, note: r.note },
            label: r.name + (r.dev ? ' (dev)' : ''),
            hint: r.note,
          })),
        )
        if (!recs.length) ctx.setStatus('AI 没有找到合适的包')
      }
    } catch (e: any) {
      if (id === aiReqId.current) setError(`AI 推荐失败: ${e?.message ?? e}`)
    } finally {
      aiBusy.current = false
      setAiLoading(false)
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
      if (key.escape && (rows.length || query.trim())) {
        setTyping(false)
      }
    },
    { isActive: active && typing },
  )

  const rows: (ResultRow & { section?: string })[] = [
    ...aliasRows.map((r, i) => ({ ...r, section: i === 0 ? '本地推荐' : undefined })),
    ...registryRows.map((r, i) => ({ ...r, section: i === 0 ? '注册表' : undefined })),
    ...aiRows.map((r, i) => ({ ...r, section: i === 0 ? 'AI 推荐' : undefined })),
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
      if (input === 'a') void runAi()
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
              ...(rows.length
                ? ([['esc', '回到结果']] as [string, string][])
                : query.trim()
                  ? ([['esc', '去列表问 AI']] as [string, string][])
                  : []),
            ]}
          />
        ) : (
          <KeyHints
            hints={[
              ['↵', '加入清单'],
              ['D', '作为 dev 依赖'],
              ...(lang === 'rust' ? ([['f', '选 features 后加入']] as [string, string][]) : []),
              ...(aiLoading ? [] : ([['a', aiRows.length ? '重新问 AI' : '问 AI 推荐']] as [string, string][])),
              ['/', '重新输入'],
            ]}
          />
        )}
      </Box>
      {searching && <Text dimColor>正在搜索注册表{sym.more}</Text>}
      {aiLoading && <Text color={ui.accent}>{sym.brand} AI 思考中{sym.more}</Text>}
      {error && <Text color={ui.danger}>{sym.fail} {error}</Text>}
      <Box marginTop={1} flexDirection="column">
        <SelectList
          focused={active && !typing}
          maxHeight={14}
          emptyText={
            !query
              ? '输入关键词后按 ↵ 搜索'
              : searched
                ? '没找到结果 — 换个说法、试试英文关键词，或按 a 问 AI'
              : '还没搜索 — 按 / 回去按 ↵ 搜索，或直接按 a 问 AI'
          }
          items={items}
          onHighlight={setHighlight}
          onEnter={(i) => addRow(i, false)}
        />
      </Box>
    </Box>
  )
}
