import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { formatCommand, runCommands } from '../core/managers/index.ts'
import type { Command } from '../core/types.ts'
import { sym, ui } from '../theme.ts'
import { KeyHints } from './KeyHints.tsx'

interface Props {
  commands: Command[]
  kind: 'add' | 'remove'
  onDone: (success: boolean) => void
  onCancel: () => void
}

type Phase = 'confirm' | 'running' | 'done'

const MAX_OUTPUT_LINES = 12

/** Confirm, run and stream the package-manager commands. */
export function ExecModal({ commands, kind, onDone, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('confirm')
  const [lines, setLines] = useState<string[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)

  const run = async () => {
    setPhase('running')
    const code = await runCommands(commands, (line) => {
      setLines((prev) => [...prev.slice(-200), line])
    })
    setExitCode(code)
    setPhase('done')
  }

  useInput((_input, key) => {
    if (phase === 'confirm') {
      if (key.return) void run()
      else if (key.escape) onCancel()
    } else if (phase === 'done') {
      if (key.return || key.escape) onDone(exitCode === 0)
    }
  })

  const color = phase === 'done' ? (exitCode === 0 ? ui.success : ui.danger) : ui.accent

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Text bold color={color}>
        {phase === 'confirm' && `即将${kind === 'add' ? '安装' : '移除'}，确认一下命令：`}
        {phase === 'running' && `正在${kind === 'add' ? '安装' : '移除'}${sym.more}`}
        {phase === 'done' &&
          (exitCode === 0
            ? `${sym.ok} ${kind === 'add' ? '安装' : '移除'}完成`
            : `${sym.fail} 失败了（exit ${exitCode}），看看下面的输出`)}
      </Text>
      {commands.map((c, i) => (
        <Text key={i}>
          <Text color={ui.success}>$ </Text>
          <Text>{formatCommand(c)}</Text>
        </Text>
      ))}
      {lines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {lines.slice(-MAX_OUTPUT_LINES).map((l, i) => (
            <Text key={i} dimColor wrap="truncate">
              {l}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        {phase === 'confirm' && (
          <KeyHints
            hints={[
              ['↵', '执行'],
              ['esc', '取消'],
            ]}
          />
        )}
        {phase === 'done' && <KeyHints hints={[['↵', '关闭']]} />}
      </Box>
    </Box>
  )
}
