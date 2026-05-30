import type { KeyboardHeatmap } from '@commma/db'
import type { EventRow } from './types.js'

export interface LangDraft {
  lang: string
  durationS: number
  pct: number
}

export interface FileDraft {
  path: string
  changes: number
}

export interface SessionDraft {
  startedAt: Date
  endedAt: Date
  durationS: number
  linesDelta: number
  paceCpm: number
  peakCpm: number
  peakAt: Date
  keyboardHeatmap: KeyboardHeatmap
  langs: LangDraft[]
  files: FileDraft[]
  activeDates: string[]
}

const BUCKET_MS = 60 * 1000

export function buildSession(rows: EventRow[]): SessionDraft {
  const startedAt = rows[0].ts
  const endedAt = rows[rows.length - 1].ts
  const durationS = Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  )

  const totalKeystrokes = rows.reduce((sum, r) => sum + r.keystrokes, 0)
  const linesDelta = rows.reduce((sum, r) => sum + r.lines, 0)
  const paceCpm = Math.round(totalKeystrokes / Math.max(1, durationS / 60))

  const buckets = new Map<number, number>()
  for (const r of rows) {
    const bucket = Math.floor(r.ts.getTime() / BUCKET_MS)
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + r.keystrokes)
  }
  let peakCpm = 0
  let peakBucket = Math.floor(startedAt.getTime() / BUCKET_MS)
  for (const [bucket, value] of buckets) {
    if (value > peakCpm) {
      peakCpm = value
      peakBucket = bucket
    }
  }
  const peakAt = new Date(peakBucket * BUCKET_MS)

  const counts: Record<string, number> = {}
  for (const r of rows) {
    if (!r.keyFreq) continue
    for (const [label, value] of Object.entries(r.keyFreq)) {
      counts[label] = (counts[label] ?? 0) + value
    }
  }
  const total = Object.values(counts).reduce((sum, v) => sum + v, 0)
  const freq: Record<string, number> = {}
  if (total > 0) {
    for (const [label, value] of Object.entries(counts)) {
      freq[label] = value / total
    }
  }
  const keyboardHeatmap: KeyboardHeatmap = { counts, freq, total }

  const langKeystrokes = new Map<string, number>()
  for (const r of rows) {
    const lang = r.lang && r.lang.length > 0 ? r.lang : 'unknown'
    langKeystrokes.set(lang, (langKeystrokes.get(lang) ?? 0) + r.keystrokes)
  }
  const langTotal = [...langKeystrokes.values()].reduce((sum, v) => sum + v, 0)
  const langs: LangDraft[] = [...langKeystrokes.entries()].map(([lang, ks]) => {
    const ratio = langTotal > 0 ? ks / langTotal : 0
    return {
      lang,
      durationS: Math.round(durationS * ratio),
      pct: Math.round(ratio * 10000) / 100,
    }
  })

  const fileChanges = new Map<string, number>()
  for (const r of rows) {
    if (!r.file) continue
    fileChanges.set(r.file, (fileChanges.get(r.file) ?? 0) + r.keystrokes)
  }
  const files: FileDraft[] = [...fileChanges.entries()].map(
    ([path, changes]) => ({ path, changes }),
  )

  return {
    startedAt,
    endedAt,
    durationS,
    linesDelta,
    paceCpm,
    peakCpm,
    peakAt,
    keyboardHeatmap,
    langs,
    files,
    activeDates: utcDateRange(startedAt, endedAt),
  }
}

function utcDateRange(start: Date, end: Date): string[] {
  const dates: string[] = []
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  )
  const endDay = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  )
  while (cursor.getTime() <= endDay) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}
