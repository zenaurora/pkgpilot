import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { KeyHints } from '../components/KeyHints.tsx'
import { SelectList } from '../components/SelectList.tsx'
import { useAppCtx } from '../context.ts'
import { scanProject } from '../core/scanner.ts'
import type { ScanFinding } from '../core/types.ts'
import { sym, ui } from '../theme.ts'

interface Props {
  active: boolean
}

/** Rule-based code scan: spots hand-rolled logic that a well-known package solves. */
export function ScanScreen({ active }: Props) {
  const ctx = useAppCtx()
  const [findings, setFindings] = useState<ScanFinding[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const installed = new Set(ctx.project.dependencies.map((d) => d.name))

  const run = async () => {
    setScanning(true)
    setFindings(await scanProject(ctx.project.root, ctx.project.lang))
    setScanning(false)
    setHighlight(0)
  }

  useInput(
    (input) => {
      if (input === 's') void run()
    },
    { isActive: active },
  )

  const current = findings?.[highlight]

  return (
    <Box flexDirection="column">
      <KeyHints
        hints={[
          ['s', findings === null ? '扫描当前项目' : '重新扫描'],
          ...(findings?.length ? ([['↵', '把推荐包加入清单']] as [string, string][]) : []),
        ]}
      />
      {findings === null && !scanning && (
        <Box marginTop={1}>
          <Text dimColor>扫描会检查代码里手写的重复逻辑，看看能不能用现成的包替换。按 s 开始。</Text>
        </Box>
      )}
      {scanning && (
        <Box marginTop={1}>
          <Text color={ui.warn}>扫描中{sym.more}</Text>
        </Box>
      )}
      {findings !== null && !scanning && findings.length === 0 && (
        <Box marginTop={1}>
          <Text color={ui.success}>{sym.ok} 没有命中任何规则，代码看起来不错</Text>
        </Box>
      )}
      {findings !== null && findings.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <SelectList
            focused={active}
            maxHeight={8}
            items={findings.map((f) => ({
              key: f.rule.id,
              label: `${f.rule.name}（${f.hits.length} 处）`,
              hint: f.rule.suggest
                ? `${sym.arrow} ${f.rule.suggest}${installed.has(f.rule.suggest) ? '（已安装）' : ''}`
                : `${sym.arrow} 标准库即可`,
            }))}
            onHighlight={setHighlight}
            onEnter={(i) => {
              const f = findings[i]
              if (!f.rule.suggest) {
                ctx.setStatus('该建议无需安装包，参考理由说明即可')
              } else if (installed.has(f.rule.suggest)) {
                ctx.setStatus(`${f.rule.suggest} 已在依赖中`)
              } else {
                ctx.addToCart({ name: f.rule.suggest, lang: ctx.project.lang })
                ctx.setStatus(`已加入清单: ${f.rule.suggest}`)
              }
            }}
          />
          {current && (
            <Box flexDirection="column" borderStyle="round" borderColor={ui.border} paddingX={1} marginTop={1}>
              <Text wrap="wrap">{current.rule.reason}</Text>
              {current.hits.slice(0, 5).map((h, i) => (
                <Text key={i} dimColor wrap="truncate">
                  {h.file}:{h.line}  {h.snippet}
                </Text>
              ))}
              {current.hits.length > 5 && <Text dimColor>{sym.more} 共 {current.hits.length} 处</Text>}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}
