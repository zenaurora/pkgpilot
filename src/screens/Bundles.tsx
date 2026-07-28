import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useMemo, useState } from 'react'
import { KeyHints } from '../components/KeyHints.tsx'
import { SelectList } from '../components/SelectList.tsx'
import { useAppCtx } from '../context.ts'
import { allTags, defaultSelection, loadBundles, saveUserBundle, toggleSelection } from '../core/bundles.ts'
import type { Bundle, BundlePackage } from '../core/types.ts'
import { sym, ui } from '../theme.ts'

interface Props {
  active: boolean
}

type Pane = 'left' | 'right'

/** Browse curated bundles, cherry-pick packages, save the cart as a new bundle. */
export function BundlesScreen({ active }: Props) {
  const ctx = useAppCtx()
  const [bundles, setBundles] = useState<Bundle[]>(() => loadBundles())
  const [pane, setPane] = useState<Pane>('left')
  const [tagIdx, setTagIdx] = useState(-1) // -1 = all tags
  const [highlight, setHighlight] = useState(0)
  const [rightHighlight, setRightHighlight] = useState(0)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')

  const langBundles = useMemo(() => bundles.filter((b) => b.lang === ctx.project.lang), [bundles, ctx.project.lang])
  const tags = useMemo(() => allTags(langBundles), [langBundles])
  const tag = tagIdx >= 0 ? tags[tagIdx] : null
  const visible = tag ? langBundles.filter((b) => b.tags.includes(tag)) : langBundles
  const current: Bundle | undefined = visible[Math.min(highlight, Math.max(0, visible.length - 1))]

  // group members rendered adjacently; slot header on the first member of each group
  const displayPackages = useMemo(() => {
    if (!current) return []
    const out: (BundlePackage & { section?: string })[] = []
    const done = new Set<string>()
    for (const p of current.packages) {
      if (done.has(p.name)) continue
      if (p.group) {
        let first = true
        for (const m of current.packages) {
          if (m.group === p.group && !done.has(m.name)) {
            out.push(first ? { ...m, section: `${m.group}（选一个）` } : m)
            done.add(m.name)
            first = false
          }
        }
      } else {
        // separate the plain block that follows a slot group
        const prev = out[out.length - 1]
        out.push(prev?.group ? { ...p, section: '通用' } : p)
        done.add(p.name)
      }
    }
    return out
  }, [current])

  const addPackages = (bundle: Bundle, names?: Set<string>) => {
    const pick = names ?? defaultSelection(bundle)
    let n = 0
    for (const p of bundle.packages) {
      if (!pick.has(p.name)) continue
      ctx.addToCart({ name: p.name, lang: bundle.lang, dev: p.dev, features: p.features, note: p.note })
      n++
    }
    ctx.setStatus(`已从 ${bundle.name} 加入 ${n} 个包`)
  }

  useInput(
    (input, key) => {
      if (input === 't') {
        setTagIdx((prev) => (prev + 2 > tags.length ? -1 : prev + 1))
        setHighlight(0)
      } else if (input === 'w') {
        if (ctx.cart.length) {
          setSaving(true)
          ctx.setInputActive(true)
        } else {
          ctx.setStatus('清单为空，先加入一些包再保存 bundle')
        }
      } else if (pane === 'left') {
        if ((key.rightArrow || input === 'l') && current) {
          setPane('right')
          setChecked(defaultSelection(current))
        } else if (input === 'a' && current) {
          addPackages(current)
        }
      } else if (pane === 'right') {
        if (key.leftArrow || input === 'h' || key.escape) {
          setPane('left')
        } else if (input === 'a' && current) {
          setChecked(defaultSelection(current))
        } else if (input === 'v' && current) {
          const p = displayPackages[rightHighlight]
          if (p) ctx.openDoc({ name: p.name, lang: current.lang, dev: p.dev, features: p.features, note: p.note })
        } else if (input === 'c' && current) {
          addPackages(current, checked)
          setPane('left')
        }
      }
    },
    { isActive: active && !saving },
  )

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Text>
          <Text dimColor>标签 </Text>
          {tag ? <Text color={ui.accent}>{tag}</Text> : <Text dimColor>全部</Text>}
        </Text>
        {pane === 'left' ? (
          <KeyHints
            hints={[
              ['↵/→', '看包含的包'],
              ['a', '按推荐组合加入'],
              ['t', '切换标签'],
              ...(ctx.cart.length ? ([['w', '把清单存为 bundle']] as [string, string][]) : []),
            ]}
          />
        ) : (
          <KeyHints
            hints={[
              ['空格', '选择/换同组'],
              ['↵', '加入选中的'],
              ['v', '看用法'],
              ['a', '重置为推荐'],
              ['esc/←', '返回'],
            ]}
          />
        )}
      </Box>
      {saving && (
        <Box marginTop={1}>
          <Text color={ui.accent}>{sym.cursor} 新 bundle 叫什么名字？ </Text>
          <TextInput
            value={saveName}
            onChange={setSaveName}
            onSubmit={(v) => {
              const name = v.trim()
              if (name) {
                saveUserBundle({
                  name,
                  lang: ctx.project.lang,
                  tags: ['自定义'],
                  packages: ctx.cart
                    .filter((p) => p.lang === ctx.project.lang)
                    .map((p) => ({ name: p.name, features: p.features, dev: p.dev, note: p.note })),
                })
                setBundles(loadBundles())
                ctx.setStatus(`已保存 bundle: ${name}`)
              }
              setSaving(false)
              setSaveName('')
              ctx.setInputActive(false)
            }}
          />
        </Box>
      )}
      <Box gap={2} marginTop={1}>
        <Box flexDirection="column" width="45%">
          <Text bold color={pane === 'left' ? ui.accent : undefined} dimColor={pane !== 'left'}>
            Bundles（{visible.length}）
          </Text>
          <SelectList
            focused={active && !saving && pane === 'left'}
            maxHeight={12}
            emptyText="该标签下没有 bundle — 按 t 换个标签"
            items={visible.map((b) => ({
              key: b.name,
              label: b.name + (b.user ? ' ✱' : ''),
              hint: b.tags.join('/'),
            }))}
            onHighlight={setHighlight}
            onEnter={() => {
              if (current) {
                setPane('right')
                setChecked(defaultSelection(current))
              }
            }}
          />
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color={pane === 'right' ? ui.accent : undefined} dimColor={pane !== 'right'}>
            {current ? `${current.name}${current.description ? ` — ${current.description}` : ''}` : ''}
          </Text>
          {current && (
            <SelectList
              focused={active && !saving && pane === 'right'}
              maxHeight={12}
              items={displayPackages.map((p) => ({
                key: p.name,
                label:
                  p.name +
                  (p.default ? '（推荐）' : '') +
                  (p.dev ? ' (dev)' : '') +
                  (p.features?.length ? ` [${p.features.join(',')}]` : ''),
                hint: p.note,
                checked: checked.has(p.name),
                section: p.section,
              }))}
              onHighlight={setRightHighlight}
              onToggle={(i) => {
                setChecked((prev) => toggleSelection(current, prev, displayPackages[i].name))
              }}
              onEnter={() => {
                addPackages(current, checked)
                setPane('left')
              }}
            />
          )}
        </Box>
      </Box>
    </Box>
  )
}
