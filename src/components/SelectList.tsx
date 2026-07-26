import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import { sym, ui } from '../theme.ts'

export interface ListItem {
  key: string
  label: string
  hint?: string
  checked?: boolean
  dim?: boolean
  /** 渲染在该行上方的小节标题（如槽位分组） */
  section?: string
}

interface Props {
  items: ListItem[]
  focused: boolean
  maxHeight?: number
  emptyText?: string
  onEnter?: (index: number) => void
  onToggle?: (index: number) => void
  onHighlight?: (index: number) => void
}

/** Generic scrollable list with cursor and optional checkboxes. */
export function SelectList({ items, focused, maxHeight = 10, emptyText = '(空)', onEnter, onToggle, onHighlight }: Props) {
  const [cursor, setCursor] = useState(0)

  // keep cursor valid when items change
  useEffect(() => {
    if (cursor >= items.length) setCursor(Math.max(0, items.length - 1))
  }, [items.length, cursor])

  useInput(
    (input, key) => {
      if (!items.length) return
      if (key.upArrow || input === 'k') {
        const next = (cursor - 1 + items.length) % items.length
        setCursor(next)
        onHighlight?.(next)
      } else if (key.downArrow || input === 'j') {
        const next = (cursor + 1) % items.length
        setCursor(next)
        onHighlight?.(next)
      } else if (key.return) {
        onEnter?.(cursor)
      } else if (input === ' ') {
        onToggle?.(cursor)
      }
    },
    { isActive: focused },
  )

  if (!items.length) {
    return (
      <Text dimColor>
        {'  '}
        {emptyText}
      </Text>
    )
  }

  const start = Math.max(0, Math.min(cursor - Math.floor(maxHeight / 2), items.length - maxHeight))
  const visible = items.slice(start, start + maxHeight)

  return (
    <Box flexDirection="column">
      {start > 0 && <Text dimColor>  ↑ 上面还有 {start} 项</Text>}
      {visible.map((item, i) => {
        const idx = start + i
        const isCursor = idx === cursor && focused
        return (
          <Box key={item.key} flexDirection="column">
            {item.section && (
              <Text dimColor>
                {'  '}─ {item.section} ─
              </Text>
            )}
            <Text>
              <Text color={ui.accent}>{isCursor ? `${sym.cursor} ` : '  '}</Text>
              {onToggle ? (
                <Text color={item.checked ? ui.accent : undefined} dimColor={!item.checked}>
                  {item.checked ? sym.on : sym.off}{' '}
                </Text>
              ) : null}
              <Text bold={isCursor} color={isCursor ? ui.accent : undefined} dimColor={item.dim && !isCursor}>
                {item.label}
              </Text>
              {item.hint ? <Text dimColor>  {item.hint}</Text> : null}
            </Text>
          </Box>
        )
      })}
      {start + maxHeight < items.length && <Text dimColor>  ↓ 下面还有 {items.length - start - maxHeight} 项</Text>}
    </Box>
  )
}
