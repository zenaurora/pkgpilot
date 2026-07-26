import Fuse from 'fuse.js'
import aliasesData from '../data/aliases.json'
import type { AliasEntry, Lang } from './types.ts'

export interface AliasMatch {
  entry: AliasEntry
  score: number
}

const entries = aliasesData as AliasEntry[]

const fuseByLang = new Map<Lang, Fuse<AliasEntry>>()

function getFuse(lang: Lang): Fuse<AliasEntry> {
  let fuse = fuseByLang.get(lang)
  if (!fuse) {
    fuse = new Fuse(
      entries.filter((e) => e.lang === lang),
      {
        keys: [
          { name: 'keywords', weight: 2 },
          { name: 'packages.name', weight: 1 },
        ],
        includeScore: true,
        threshold: 0.35,
        ignoreLocation: true,
      },
    )
    fuseByLang.set(lang, fuse)
  }
  return fuse
}

/** Fuzzy-match feature keywords (Chinese or English) or package names against the alias table. */
export function searchAliases(lang: Lang, query: string, limit = 6): AliasMatch[] {
  const q = query.trim()
  if (!q) return []
  return getFuse(lang)
    .search(q, { limit })
    .map((r) => ({ entry: r.item, score: r.score ?? 1 }))
}
