import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { getPackageDoc, type DocLookup } from '../core/docs.ts'
import type { PendingPackage } from '../core/types.ts'
import { sym, ui } from '../theme.ts'
import { KeyHints } from './KeyHints.tsx'

interface Props {
  pkg: PendingPackage
  onAdd: (pkg: PendingPackage) => void
  onCancel: () => void
}

const MAX_CODE_LINES = 14

/** 展示一个包的落地资料：摘要、文档链接、README 提取的快速上手代码。内置资料优先，不经过 LLM。 */
export function DocModal({ pkg, onAdd, onCancel }: Props) {
  const [lookup, setLookup] = useState<DocLookup | null>(null)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    let alive = true
    getPackageDoc(pkg.lang, pkg.name)
      .then((r) => alive && setLookup(r))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [pkg.lang, pkg.name])

  const codeLines = lookup?.doc.quickstart?.split('\n') ?? []
  const maxOffset = Math.max(0, codeLines.length - MAX_CODE_LINES)

  useInput((input, key) => {
    if (key.escape || input === 'q') onCancel()
    else if (key.return) onAdd(pkg)
    else if (key.downArrow || input === 'j') setOffset((o) => Math.min(o + 1, maxOffset))
    else if (key.upArrow || input === 'k') setOffset((o) => Math.max(o - 1, 0))
  })

  const doc = lookup?.doc
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ui.accent} paddingX={1}>
      <Text bold wrap="truncate">
        <Text color={ui.accent}>{sym.brand} </Text>
        {pkg.name}
        {doc?.version ? <Text dimColor> {doc.version}</Text> : null}
        {lookup ? (
          <Text dimColor>
            {'  '}
            {lookup.source === 'local' ? '内置资料' : '在线抓取'}
            {doc?.curated ? ' ✓已审校' : ''}
            {doc?.fetchedAt ? ` ${sym.dot} ${doc.fetchedAt}` : ''}
          </Text>
        ) : null}
      </Text>
      {error ? (
        <Text color={ui.danger}>
          {sym.fail} 获取资料失败: {error}
        </Text>
      ) : !doc ? (
        <Text dimColor>正在读取资料{sym.more}</Text>
      ) : (
        <>
          {doc.summary ? <Text wrap="wrap">{doc.summary}</Text> : null}
          <Text dimColor wrap="truncate">
            文档 {doc.docsUrl}
            {doc.repoUrl && doc.repoUrl !== doc.docsUrl ? `  仓库 ${doc.repoUrl}` : ''}
          </Text>
          {doc.quickstart ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>
                ── 快速上手（README 提取）
                {codeLines.length > MAX_CODE_LINES ? ` ${offset + 1}-${Math.min(offset + MAX_CODE_LINES, codeLines.length)}/${codeLines.length} 行 ↑↓ 滚动` : ''}
              </Text>
              {codeLines.slice(offset, offset + MAX_CODE_LINES).map((l, i) => (
                <Text key={offset + i} color={ui.success} wrap="truncate">
                  {'  '}
                  {l || ' '}
                </Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>（README 里没提取到用法代码，去上面的文档链接看）</Text>
          )}
        </>
      )}
      <Box marginTop={1}>
        <KeyHints
          hints={[
            ['↵', '加入清单'],
            ...(maxOffset > 0 ? ([['↑↓', '滚动代码']] as [string, string][]) : []),
            ['esc', '关闭'],
          ]}
        />
      </Box>
    </Box>
  )
}
