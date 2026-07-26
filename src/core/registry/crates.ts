import type { RegistryResult } from '../types.ts'
import { cachedFetchJson } from './cache.ts'

const BASE = 'https://crates.io/api/v1'

interface CrateSearchResponse {
  crates: { name: string; max_stable_version: string | null; max_version: string; description: string | null; downloads: number }[]
}

export async function searchCrates(query: string, limit = 10): Promise<RegistryResult[]> {
  if (!query.trim()) return []
  const data = await cachedFetchJson<CrateSearchResponse>(
    `${BASE}/crates?q=${encodeURIComponent(query)}&per_page=${limit}`,
  )
  return data.crates.map((c) => ({
    name: c.name,
    version: c.max_stable_version ?? c.max_version,
    description: c.description ?? '',
    downloads: c.downloads,
  }))
}

interface CrateDetailResponse {
  crate: { name: string; max_stable_version: string | null; max_version: string }
  versions: { num: string; yanked: boolean; features: Record<string, string[]> }[]
}

export interface CrateFeature {
  name: string
  /** feature names this one enables, for display */
  enables: string[]
  isDefault: boolean
}

/** Fetch the feature list of the latest stable version of a crate. */
export async function fetchCrateFeatures(name: string): Promise<CrateFeature[]> {
  const data = await cachedFetchJson<CrateDetailResponse>(`${BASE}/crates/${encodeURIComponent(name)}`)
  const target = data.crate.max_stable_version ?? data.crate.max_version
  const version = data.versions.find((v) => v.num === target && !v.yanked) ?? data.versions.find((v) => !v.yanked)
  if (!version) return []
  const features = version.features ?? {}
  const defaults = new Set(features.default ?? [])
  return Object.entries(features)
    .filter(([n]) => n !== 'default')
    .map(([n, enables]) => ({ name: n, enables, isDefault: defaults.has(n) }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
}
