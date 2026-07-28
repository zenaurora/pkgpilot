import { Box, Text, useApp as useInkApp, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { ExecModal } from './components/ExecModal.tsx'
import { DocModal } from './components/DocModal.tsx'
import { FeaturesModal } from './components/FeaturesModal.tsx'
import { KeyHints } from './components/KeyHints.tsx'
import { AppContext, type AppCtx } from './context.ts'
import { buildAddCommands, formatCommand } from './core/managers/index.ts'
import { reloadProject } from './core/project.ts'
import { LANG_LABEL, type Command, type PendingPackage, type ProjectInfo } from './core/types.ts'
import { BundlesScreen } from './screens/Bundles.tsx'
import { DashboardScreen } from './screens/Dashboard.tsx'
import { ScanScreen } from './screens/Scan.tsx'
import { SearchScreen } from './screens/Search.tsx'
import { sym, ui } from './theme.ts'

const SCREENS = [
  { id: 'dashboard', num: '1', label: '依赖' },
  { id: 'search', num: '2', label: '搜索' },
  { id: 'bundles', num: '3', label: 'Bundles' },
  { id: 'scan', num: '4', label: '扫描' },
] as const

type ScreenId = (typeof SCREENS)[number]['id']

interface Props {
  initialProjects: ProjectInfo[]
}

export function App({ initialProjects }: Props) {
  const { exit } = useInkApp()
  const [projects, setProjects] = useState(initialProjects)
  const [projectIdx, setProjectIdx] = useState(0)
  const [screen, setScreen] = useState<ScreenId>('dashboard')
  const [cart, setCart] = useState<PendingPackage[]>([])
  const [inputActive, setInputActive] = useState(false)
  const [status, setStatus] = useState('')
  const [featuresPkg, setFeaturesPkg] = useState<PendingPackage | null>(null)
  const [docPkg, setDocPkg] = useState<PendingPackage | null>(null)
  const [exec, setExec] = useState<{ commands: Command[]; kind: 'add' | 'remove' | 'upgrade' } | null>(null)

  const project = projects[projectIdx]
  const modalOpen = featuresPkg !== null || docPkg !== null || exec !== null

  const ctx: AppCtx = useMemo(
    () => ({
      project,
      projects,
      cycleProject: () => setProjectIdx((i) => (i + 1) % projects.length),
      refreshProject: () =>
        setProjects((prev) => prev.map((p, i) => (i === projectIdx ? reloadProject(p) : p))),
      cart,
      addToCart: (pkg) =>
        setCart((prev) => (prev.some((p) => p.name === pkg.name && p.lang === pkg.lang) ? prev : [...prev, pkg])),
      clearCart: () => setCart([]),
      inputActive,
      setInputActive,
      openFeatures: (pkg) => setFeaturesPkg(pkg),
      openDoc: (pkg) => setDocPkg(pkg),
      openExec: (commands, kind) => {
        if (commands.length) setExec({ commands, kind })
      },
      status,
      setStatus,
    }),
    [project, projects, projectIdx, cart, inputActive, status],
  )

  // Tab always switches screens, even while a TextInput owns the keyboard
  // (ink-text-input ignores Tab, so it never lands in the input box)
  useInput(
    (_input, key) => {
      if (key.tab) {
        const idx = SCREENS.findIndex((s) => s.id === screen)
        setScreen(SCREENS[(idx + 1) % SCREENS.length].id)
        setInputActive(false)
      }
    },
    { isActive: !modalOpen },
  )

  useInput(
    (input, key) => {
      if (input === 'q') exit()
      else if (input === '1') setScreen('dashboard')
      else if (input === '2') setScreen('search')
      else if (input === '3') setScreen('bundles')
      else if (input === '4') setScreen('scan')
      else if (input === 'p' && projects.length > 1) {
        setProjectIdx((i) => (i + 1) % projects.length)
      } else if (input === 'i' && cart.length) {
        const commands = buildAddCommands(project, cart)
        if (commands.length) setExec({ commands, kind: 'add' })
        else setStatus(`清单里没有 ${LANG_LABEL[project.lang]} 的包（p 切换项目）`)
      } else if (input === 'x') {
        setCart([])
        setStatus('已清空清单')
      }
    },
    { isActive: !inputActive && !modalOpen },
  )

  const screenActive = (id: ScreenId) => screen === id && !modalOpen

  const cartMine = cart.filter((p) => p.lang === project.lang)
  const previewCmds = buildAddCommands(project, cart)

  return (
    <AppContext.Provider value={ctx}>
      <Box flexDirection="column" paddingX={1}>
      {/* header: brand + tab pills + project chip */}
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={ui.accent}>
            {sym.brand} pkgpilot
          </Text>
          <Text> </Text>
          {SCREENS.map((s) =>
            screen === s.id ? (
              <Text key={s.id} bold backgroundColor={ui.accent} color={ui.onAccent}>
                {` ${s.num} ${s.label} `}
              </Text>
            ) : (
              <Text key={s.id} dimColor>
                {` ${s.num} ${s.label} `}
              </Text>
            ),
          )}
        </Box>
        <Text dimColor wrap="truncate">
          {LANG_LABEL[project.lang]}
          {project.jsManager ? ` ${sym.dot} ${project.jsManager}` : ''}
          {projects.length > 1 ? `  (p 切换)` : ''}
        </Text>
      </Box>

      {/* body */}
      <Box flexDirection="column" marginTop={1} minHeight={16}>
        {screen === 'dashboard' && <DashboardScreen active={screenActive('dashboard')} />}
        {screen === 'search' && <SearchScreen active={screenActive('search')} />}
        {screen === 'bundles' && <BundlesScreen active={screenActive('bundles')} />}
        {screen === 'scan' && <ScanScreen active={screenActive('scan')} />}
      </Box>

      {/* modals */}
      {featuresPkg && (
        <FeaturesModal
          pkg={featuresPkg}
          onConfirm={(pkg) => {
            ctx.addToCart(pkg)
            setStatus(`已加入清单: ${pkg.name}${pkg.features?.length ? ` [${pkg.features.join(',')}]` : ''}`)
            setFeaturesPkg(null)
          }}
          onCancel={() => setFeaturesPkg(null)}
        />
      )}
      {docPkg && (
        <DocModal
          pkg={docPkg}
          onAdd={(pkg) => {
            ctx.addToCart(pkg)
            setStatus(`已加入清单: ${pkg.name}`)
            setDocPkg(null)
          }}
          onCancel={() => setDocPkg(null)}
        />
      )}
      {exec && (
        <ExecModal
          commands={exec.commands}
          kind={exec.kind}
          onCancel={() => setExec(null)}
          onDone={(success) => {
            if (success) {
              if (exec.kind === 'add') setCart((prev) => prev.filter((p) => p.lang !== project.lang))
              ctx.refreshProject()
              setStatus(exec.kind === 'add' ? '安装完成 ✓' : exec.kind === 'upgrade' ? '升级完成 ✓' : '移除完成 ✓')
            }
            setExec(null)
          }}
        />
      )}

      {/* cart + status bar */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={cartMine.length ? ui.accent : ui.border}
        paddingX={1}
      >
        <Text wrap="truncate">
          <Text bold color={cart.length ? ui.accent : undefined} dimColor={!cart.length}>
            ◇ 清单
          </Text>
          {cart.length ? (
            <>
              <Text dimColor> {cart.length} 个包{'  '}</Text>
              <Text>
                {cart
                  .map(
                    (p) =>
                      `${p.name}${p.features?.length ? `[${p.features.join(',')}]` : ''}${
                        p.lang !== project.lang ? `(${p.lang})` : ''
                      }`,
                  )
                  .join(`  ${sym.dot}  `)}
              </Text>
            </>
          ) : (
            <Text dimColor>{'  '}空 — 在搜索 / Bundles / 扫描里按 ↵ 把包加进来</Text>
          )}
        </Text>
        {previewCmds.length > 0 && (
          <Text wrap="truncate">
            <Text color={ui.success}>$ </Text>
            <Text dimColor>{previewCmds.map(formatCommand).join(' && ')}</Text>
          </Text>
        )}
      </Box>

      {/* status + global keys */}
      <Box justifyContent="space-between" paddingX={1}>
        <KeyHints
          hints={[
            ['tab', '切换页'],
            ...(cart.length ? ([['i', '安装清单'], ['x', '清空']] as [string, string][]) : []),
            ['q', '退出'],
          ]}
        />
        {status ? <Text color={ui.success}>{status}</Text> : null}
      </Box>
      </Box>
    </AppContext.Provider>
  )
}
