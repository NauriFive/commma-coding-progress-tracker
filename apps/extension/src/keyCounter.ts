import { isKeyLabel, type KeyFreq, type KeyLabel } from '@commma/shared'

export interface ChangeTally {
  keystrokes: number
  lines: number
  keyFreq: KeyFreq
}

function charToLabel(ch: string): KeyLabel {
  if (ch === '\n' || ch === '\r') return 'Enter'
  if (ch === '\t') return 'Tab'
  const lower = ch.toLowerCase()
  return isKeyLabel(lower) ? lower : 'Other'
}

export function tallyChange(input: {
  text: string
  rangeLength: number
  removedLineCount: number
}): ChangeTally {
  const addedLineCount = (input.text.match(/\n/g) ?? []).length
  const lines = addedLineCount - input.removedLineCount
  const keyFreq: KeyFreq = {}

  if (input.text.length === 1) {
    keyFreq[charToLabel(input.text)] = 1
    return { keystrokes: 1, lines, keyFreq }
  }
  if (input.text.length === 0 && input.rangeLength > 0) {
    keyFreq.Backspace = 1
    return { keystrokes: 1, lines, keyFreq }
  }
  return { keystrokes: 0, lines, keyFreq }
}

export function addKeyFreq(into: KeyFreq, delta: KeyFreq): void {
  for (const key of Object.keys(delta) as KeyLabel[]) {
    into[key] = (into[key] ?? 0) + (delta[key] ?? 0)
  }
}
