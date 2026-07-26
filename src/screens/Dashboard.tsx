import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useState } from 'react'
import { KeyHints } from '../components/KeyHints.tsx'
import { SelectList } from '../components/SelectList.tsx'
import { useAppCtx } from '../context.ts'
import { buildRemoveCommands } from '../core/managers/index.ts'
import { sym, ui } from '../theme.ts'

interface Props {
  active: boolean
}

/** Current project dependencies: filter with /, mark with space, remove with d. */
export function DashboardScreen({ active }: Props) {
  const ctx = useAppCtx()
  const [filter, setFilter] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [marked, setMarked] = useState<Set<string>>(new Set())

  const deps = ctx.project.dependencies.filter(
    (d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()),
  )

  useInput(
    (input, key) => {
      if (input === '/') {
        setFiltering(true)
        ctx.setInputActive(true)
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
              ...(marked.size ? ([['d', `移除选中的 ${marked.size} 个`]] as [string, string][]) : []),
              ['/', '筛选'],
              ...(filter ? ([['esc', `清除筛选“${filter}”`]] as [string, string][]) : []),
            ]}
          />
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <SelectList
          focused={active && !filtering}
          maxHeight={14}
          emptyText={filter ? `没有匹配“${filter}”的依赖` : '还没有依赖 — 按 2 去搜索，或按 3 挑个 bundle'}
          items={deps.map((d) => ({
            key: d.name,
            label: `${d.name} ${d.version}`,
            hint: [d.dev ? 'dev' : '', d.features?.length ? `features: ${d.features.join(',')}` : '']
              .filter(Boolean)
              .join(` ${sym.dot} `),
            checked: marked.has(d.name),
          }))}
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
        <Text color={ui.danger}>
          待移除：{[...marked].join(', ')} <Text dimColor>（按 d 确认）</Text>
        </Text>
      )}
    </Box>
  )
}
