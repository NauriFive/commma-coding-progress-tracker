import { QWERTY_LAYOUT } from '@commma/shared'
import type { KeyboardHeatmap } from '@commma/db'

export type CardAspect = '9:16' | '1:1' | '16:9'

const DIMENSIONS: Record<CardAspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
}

const UNIT = 46
const PAD = 16
const GAP = 3
const RADIUS = 6
const MARGIN = 0.08

const COLD_FILL = '#1a1814'
const HOT_FILL = '#ff4d1a'
const COLD_BORDER = '#2d2922'
const HOT_BORDER = '#ff4d1a'
const COLD_TEXT = '#7a746a'
const HOT_TEXT = '#fff4ec'
const PAPER = '#0c0b08'
const INK = '#efead8'
const INK_MUTE = '#7a746a'

const LOGICAL_W = QWERTY_LAYOUT.cols * UNIT + PAD * 2
const LOGICAL_H = QWERTY_LAYOUT.rows * UNIT + PAD * 2

const CAP_OVERRIDES: Record<string, string> = { '⌘': 'Cmd' }

function serverCap(cap: string): string {
  return CAP_OVERRIDES[cap] ?? cap
}

export function aspectDimensions(aspect: CardAspect) {
  return DIMENSIONS[aspect]
}

export interface CardCacheKeyInput {
  sessionId: string
  aspect: CardAspect
  layout: string
  handle: string | null
  stats: boolean
}

export function heatmapCardCacheKey(input: CardCacheKeyInput): string {
  const h = input.handle ? `h-${input.handle}` : 'H'
  const s = input.stats ? 's' : 'S'
  return `card:v1:${input.sessionId}:${input.aspect}:${input.layout}:${h}:${s}`
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r}, ${g}, ${bl})`
}

const XML_INVALID_CHARS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g

function xmlEscape(value: string): string {
  return value
    .replace(XML_INVALID_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function keyboardKeys(counts: Record<string, number>): string {
  let max = 0
  for (const key of QWERTY_LAYOUT.keys) {
    if (key.label) max = Math.max(max, counts[key.label] ?? 0)
  }

  const parts: string[] = []
  for (const key of QWERTY_LAYOUT.keys) {
    const count = key.label ? (counts[key.label] ?? 0) : 0
    const t = max > 0 && count > 0 ? Math.sqrt(count / max) : 0
    const px = PAD + key.x * UNIT + GAP
    const py = PAD + key.y * UNIT + GAP
    const pw = key.w * UNIT - GAP * 2
    const ph = key.h * UNIT - GAP * 2
    const fill = t > 0 ? lerpColor(COLD_FILL, HOT_FILL, t) : COLD_FILL
    const stroke = t > 0 ? lerpColor(COLD_BORDER, HOT_BORDER, t) : COLD_BORDER

    parts.push(
      `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${RADIUS}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`,
    )

    if (key.cap) {
      const cap = serverCap(key.cap)
      const fontSize = cap.length > 2 ? 11 : 15
      const textFill = t > 0 ? lerpColor(COLD_TEXT, HOT_TEXT, t) : COLD_TEXT
      parts.push(
        `<text x="${px + pw / 2}" y="${py + ph / 2}" font-family="ui-monospace, monospace" font-size="${fontSize}" fill="${textFill}" text-anchor="middle" dominant-baseline="central">${xmlEscape(cap)}</text>`,
      )
    }
  }
  return parts.join('')
}

export interface HeatmapCardOptions {
  heatmap: KeyboardHeatmap
  aspect: CardAspect
  handle?: string
  stats?: string
}

export function renderHeatmapCardSvg(options: HeatmapCardOptions): string {
  const { width, height } = DIMENSIONS[options.aspect]
  const availW = width * (1 - MARGIN * 2)
  const availH = height * (1 - MARGIN * 2)
  const scale = Math.min(availW / LOGICAL_W, availH / LOGICAL_H)
  const kw = LOGICAL_W * scale
  const kh = LOGICAL_H * scale
  const ox = (width - kw) / 2
  const oy = (height - kh) / 2

  const overlays: string[] = []
  if (options.handle) {
    overlays.push(
      `<text x="${width / 2}" y="${height * MARGIN}" font-family="ui-monospace, monospace" font-size="${Math.round(width * 0.034)}" fill="${INK}" text-anchor="middle" dominant-baseline="middle">${xmlEscape(options.handle)}</text>`,
    )
  }
  if (options.stats) {
    overlays.push(
      `<text x="${width / 2}" y="${height * (1 - MARGIN)}" font-family="ui-monospace, monospace" font-size="${Math.round(width * 0.024)}" fill="${INK_MUTE}" text-anchor="middle" dominant-baseline="middle">${xmlEscape(options.stats)}</text>`,
    )
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${PAPER}"/>`,
    `<g transform="translate(${ox} ${oy}) scale(${scale})">`,
    keyboardKeys(options.heatmap.counts),
    `</g>`,
    overlays.join(''),
    `</svg>`,
  ].join('')
}
