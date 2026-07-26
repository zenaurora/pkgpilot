import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { fetchCrateFeatures, type CrateFeature } from '../core/registry/index.ts'
import type { PendingPackage } from '../core/types.ts'
import { sym, ui } from '../theme.ts'
import { KeyHints } from './KeyHints.tsx'
import { SelectList } from './SelectList.tsx'

interface Props {
  pkg: PendingPackage
  onConfirm: (pkg: PendingPackage) => void
  onCancel: () => void
}

/** Pick optional crate features fetched from crates.io. */
export function FeaturesModal({ pkg, onConfirm, onCancel }: Props) {
  const [features, setFeatures] = useState<CrateFeature[] | null>(null)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set(pkg.features ?? []))

  useEffect(() => {
    let alive = true
    fetchCrateFeatures(pkg.name)
      .then((f) => alive && setFeatures(f))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [pkg.name])

  useInput((input, key) => {
    if (key.escape) onCancel()
    if (input === 'c' || (key.return && features?.length === 0)) {
      onConfirm({ ...pkg, features: checked.size ? [...checked] : undefined })
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ui.accent} paddingX={1}>
      <Text bold>
        <Text color={ui.accent}>{sym.brand} </Text>
        {pkg.name}
        <Text dimColor> {sym.dot} 选择 features</Text>
      </Text>
      {error ? (
        <Text color={ui.danger}>
          {sym.fail} 获取失败: {error}。离线？可按 c 直接确认，不选 feature
        </Text>
      ) : features === null ? (
        <Text dimColor>正在从 crates.io 获取 features{sym.more}</Text>
      ) : features.length === 0 ? (
        <Text dimColor>该 crate 没有可选 features，按 ↵ 确认</Text>
      ) : (
        <SelectList
          focused
          maxHeight={12}
          items={features.map((f) => ({
            key: f.name,
            label: f.name + (f.isDefault ? '（默认）' : ''),
            hint: f.enables.length ? `${sym.arrow} ${f.enables.slice(0, 4).join(', ')}` : undefined,
            checked: checked.has(f.name),
          }))}
          onToggle={(i) => {
            const name = features[i].name
            setChecked((prev) => {
              const next = new Set(prev)
              next.has(name) ? next.delete(name) : next.add(name)
              return next
            })
          }}
          onEnter={() => onConfirm({ ...pkg, features: checked.size ? [...checked] : undefined })}
        />
      )}
      <Box marginTop={1} justifyContent="space-between">
        <KeyHints
          hints={[
            ['空格', '勾选'],
            ['↵/c', '确认加入清单'],
            ['esc', '取消'],
          ]}
        />
        <Text dimColor>{checked.size ? `已选 ${[...checked].join(', ')}` : '不选则用默认 features'}</Text>
      </Box>
    </Box>
  )
}
