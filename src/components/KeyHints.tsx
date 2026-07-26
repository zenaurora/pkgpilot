import { Text } from 'ink'
import React from 'react'
import { ui } from '../theme.ts'

export type Hint = [key: string, label: string]

/**
 * A single consistent hint bar: `↵ 加入 · 空格 勾选 · esc 返回`.
 * Keys are highlighted, labels dimmed — only show what applies right now.
 */
export function KeyHints({ hints }: { hints: Hint[] }) {
  return (
    <Text>
      {hints.map(([key, label], i) => (
        <React.Fragment key={i}>
          {i > 0 && <Text dimColor>{'  ·  '}</Text>}
          <Text color={ui.accent}>{key}</Text>
          <Text dimColor> {label}</Text>
        </React.Fragment>
      ))}
    </Text>
  )
}
