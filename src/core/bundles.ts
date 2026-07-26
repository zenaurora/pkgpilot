import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import builtinBundles from '../data/bundles.json'
import type { Bundle, BundlePackage } from './types.ts'

const USER_BUNDLES_PATH = path.join(os.homedir(), '.config', 'pkgpilot', 'bundles.json')

const bundleSchema = z.object({
  name: z.string().min(1),
  lang: z.enum(['rust', 'python', 'js']),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
  packages: z
    .array(
      z.object({
        name: z.string().min(1),
        features: z.array(z.string()).optional(),
        dev: z.boolean().optional(),
        note: z.string().optional(),
        group: z.string().optional(),
        default: z.boolean().optional(),
      }),
    )
    .min(1),
})

export function loadUserBundles(): Bundle[] {
  try {
    const raw = JSON.parse(fs.readFileSync(USER_BUNDLES_PATH, 'utf8'))
    if (!Array.isArray(raw)) return []
    const out: Bundle[] = []
    for (const item of raw) {
      const parsed = bundleSchema.safeParse(item)
      if (parsed.success) out.push({ ...parsed.data, user: true })
    }
    return out
  } catch {
    return []
  }
}

/** builtin + user bundles; a user bundle with the same name overrides the builtin one */
export function loadBundles(): Bundle[] {
  return mergeBundles(builtinBundles as Bundle[], loadUserBundles())
}

export function mergeBundles(builtin: Bundle[], user: Bundle[]): Bundle[] {
  const byName = new Map<string, Bundle>()
  for (const b of builtin) byName.set(b.name, b)
  for (const b of user) byName.set(b.name, b)
  return [...byName.values()]
}

export function saveUserBundle(bundle: Bundle): void {
  const existing = loadUserBundles()
  const next = existing.filter((b) => b.name !== bundle.name)
  next.push({ ...bundle, user: true })
  fs.mkdirSync(path.dirname(USER_BUNDLES_PATH), { recursive: true })
  fs.writeFileSync(
    USER_BUNDLES_PATH,
    JSON.stringify(
      next.map(({ user: _user, ...rest }) => rest),
      null,
      2,
    ),
  )
}

export function allTags(bundles: Bundle[]): string[] {
  const tags = new Set<string>()
  for (const b of bundles) for (const t of b.tags) tags.add(t)
  return [...tags].sort()
}

/** Slot default: the package marked `default`, else the first one in the group. */
export function groupDefault(packages: BundlePackage[], group: string): BundlePackage | undefined {
  const members = packages.filter((p) => p.group === group)
  return members.find((p) => p.default) ?? members[0]
}

/** Recommended selection: every ungrouped package + the default of each slot. */
export function defaultSelection(bundle: Bundle): Set<string> {
  const names = new Set<string>()
  const seenGroups = new Set<string>()
  for (const p of bundle.packages) {
    if (!p.group) {
      names.add(p.name)
    } else if (!seenGroups.has(p.group)) {
      seenGroups.add(p.group)
      const pick = groupDefault(bundle.packages, p.group)
      if (pick) names.add(pick.name)
    }
  }
  return names
}

/** Radio semantics: toggling a grouped package deselects its group siblings. */
export function toggleSelection(bundle: Bundle, selected: Set<string>, name: string): Set<string> {
  const next = new Set(selected)
  const pkg = bundle.packages.find((p) => p.name === name)
  if (!pkg) return next
  if (next.has(name)) {
    next.delete(name)
    return next
  }
  if (pkg.group) {
    for (const p of bundle.packages) {
      if (p.group === pkg.group) next.delete(p.name)
    }
  }
  next.add(name)
  return next
}
