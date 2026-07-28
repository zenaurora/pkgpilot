import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useEffect, useRef, useState } from 'react'
import { KeyHints } from '../components/KeyHints.tsx'
import { SelectList } from '../components/SelectList.tsx'
import { useAppCtx } from '../context.ts'
import { buildRemoveCommands, buildUpgradeCommands } from '../core/managers/index.ts'
import { bumpLevel, checkOutdated, isUpgradable, LEVEL_LABEL } from '../core/outdated.ts'
import { findUnusedDeps } from '../core/slim.ts'
import { sym, ui } from '../theme.ts'

interface Props {
  active: boolean
}

/** Current project dependencies: filter, remove, check updates (u/U), slim scan (s). */
export function DashboardScreen({ active }: Props) {
  const ctx = useAppCtx()
  const [filter, setFilter] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [latest, setLatest] = useState<Map<string, string> | null>(null)
  const [checking, setChecking] = useState(false)
  const [slimming, setSlimming] = useState(false)
  // 同步闸门：连按 u/s 不重复触发（state 在 re-render 前读不到新值）
  const busy = useRef(false)

  // 切换项目后旧的版本信息/选中项作废
  useEffect(() => {
    setLatest(null)
    setMarked(new Set())
  }, [ctx.project.root])

  const deps = ctx.project.dependencies.filter(
    (d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()),
  )

  const levelOf = (name: string, spec: string) => {
    const l = latest?.get(name)
    return l ? { latest: l, level: bumpLevel(spec, l) } : undefined
  }

  const upgradable = ctx.project.dependencies.filter((d) => {
    const info = levelOf(d.name, d.version)
    return info && isUpgradable(info.level)
  })
  const markedUpgradable = upgradable.filter((d) => marked.has(d.name))

  const runCheck = async () => {
    if (busy.current) return
    busy.current = true
    setChecking(true)
    try {
      const res = await checkOutdated(ctx.project)
      setLatest(res.latest)
      const n = ctx.project.dependencies.filter((d) => {
        const l = res.latest.get(d.name)
        return l && isUpgradable(bumpLevel(d.version, l))
      }).length
      ctx.setStatus(
        n
          ? `${n} 个可升级 — 空格勾选后按 U 升级${res.failed.length ? `（${res.failed.length} 个查询失败）` : ''}`
          : '依赖都已是最新 ✓',
      )
    } catch (e: any) {
      ctx.setStatus(`检查失败: ${e?.message ?? e}`)
    } finally {
      busy.current = false
      setChecking(false)
    }
  }

  const runSlim = async () => {
    if (busy.current) return
    busy.current = true
    setSlimming(true)
    try {
      const r = await findUnusedDeps(ctx.project)
      setMarked(new Set(r.unused))
      const parts: string[] = []
      if (r.unused.length) parts.push(`${r.unused.length} 个依赖源码未引用已选中，人工确认后按 d 移除`)
      if (r.misplaced.length) parts.push(`${r.misplaced.length} 个仅测试引用，建议移入 dev：${r.misplaced.join(', ')}`)
      if (r.skipped.length) parts.push(`跳过工具类 ${r.skipped.length}`)
      ctx.setStatus(
        parts.length
          ? `${parts.join('；')}（扫描 ${r.filesScanned} 个文件）`
          : `没发现未引用的依赖（扫描 ${r.filesScanned} 个文件）`,
      )
    } finally {
      busy.current = false
      setSlimming(false)
    }
  }

  const runUpgrade = () => {
    if (!markedUpgradable.length) return
    const targets = markedUpgradable.map((d) => ({
      name: d.name,
      latest: latest!.get(d.name)!,
      dev: d.dev,
      features: d.features,
    }))
    ctx.openExec(buildUpgradeCommands(ctx.project, targets), 'upgrade')
    setMarked(new Set())
  }

  useInput(
    (input, key) => {
      if (input === '/') {
        setFiltering(true)
        ctx.setInputActive(true)
      } else if (input === 'u') {
        void runCheck()
      } else if (input === 's') {
        void runSlim()
      } else if (input === 'U') {
        runUpgrade()
      } else if (input === 'd' && marked.size) {
        ctx.openExec(buildRemoveCommands(ctx.project, [...marked]), 'remove')
        setMarked(new Set())
      } else if (key.escape && filter) {
        setFilter('')
      }
    },
    { isActive: active && !filtering },
  )

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text bold>{ctx.project.name}</Text>
        <Text dimColor>
          {'  '}
          {ctx.project.dependencies.length} 个依赖 {sym.dot} {ctx.project.root}
        </Text>
        {latest && (
          <Text color={upgradable.length ? ui.warn : ui.success}>
            {'  '}
            {upgradable.length ? `${upgradable.length} 个可升级` : '全部最新 ✓'}
          </Text>
        )}
      </Text>
      {filtering ? (
        <Box marginTop={1}>
          <Text color={ui.accent}>{sym.cursor} 筛选 </Text>
          <TextInput
            value={filter}
            onChange={setFilter}
            onSubmit={() => {
              setFiltering(false)
              ctx.setInputActive(false)
            }}
          />
        </Box>
      ) : (
        <Box marginTop={1}>
          <KeyHints
            hints={[
              ['空格', '选中'],
              ['u', latest ? '重新检查更新' : '检查更新'],
              ...(markedUpgradable.length
                ? ([['U', `升级选中的 ${markedUpgradable.length} 个`]] as [string, string][])
                : []),
              ['s', '瘦身扫描'],
              ...(marked.size ? ([['d', `移除选中的 ${marked.size} 个`]] as [string, string][]) : []),
              ['/', '筛选'],
              ...(filter ? ([['esc', `清除筛选“${filter}”`]] as [string, string][]) : []),
            ]}
          />
        </Box>
      )}
      {checking && <Text dimColor>正在查询注册表最新版本{sym.more}</Text>}
      {slimming && <Text dimColor>正在扫描源码引用{sym.more}</Text>}
      <Box marginTop={1} flexDirection="column">
        <SelectList
          focused={active && !filtering}
          maxHeight={14}
          emptyText={filter ? `没有匹配“${filter}”的依赖` : '还没有依赖 — 按 2 去搜索，或按 3 挑个 bundle'}
          items={deps.map((d) => {
            const info = levelOf(d.name, d.version)
            const canUp = info && isUpgradable(info.level)
            return {
              key: d.name,
              label:
                `${d.name} ${d.version}` +
                (info ? (canUp ? ` ${sym.arrow} ${info.latest}` : ` ${sym.ok}`) : ''),
              hint: [
                canUp ? `可升级 · ${LEVEL_LABEL[info.level]}` : '',
                d.dev ? 'dev' : '',
                d.features?.length ? `features: ${d.features.join(',')}` : '',
              ]
                .filter(Boolean)
                .join(` ${sym.dot} `),
              checked: marked.has(d.name),
            }
          })}
          onToggle={(i) => {
            const name = deps[i].name
            setMarked((prev) => {
              const next = new Set(prev)
              next.has(name) ? next.delete(name) : next.add(name)
              return next
            })
          }}
        />
      </Box>
      {marked.size > 0 && (
        <Text color={markedUpgradable.length ? ui.warn : ui.danger} wrap="truncate">
          已选 {[...marked].join(', ')}{' '}
          <Text dimColor>
            （{markedUpgradable.length ? `U 升级 ${markedUpgradable.length} 个 / ` : ''}d 移除全部选中）
          </Text>
        </Text>
      )}
    </Box>
  )
}
