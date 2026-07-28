import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { KeyboardHeatmap } from '@commma/db'
import {
  aspectDimensions,
  heatmapCardCacheKey,
  renderHeatmapCardSvg,
} from '../../src/lib/heatmapCard.js'

const heatmap: KeyboardHeatmap = {
  counts: { a: 10, e: 5, Space: 20 },
  freq: { a: 0.285, e: 0.143, Space: 0.571 },
  total: 35,
}

describe('aspectDimensions', () => {
  it('maps each aspect to its pixel size', () => {
    expect(aspectDimensions('16:9')).toEqual({ width: 1920, height: 1080 })
    expect(aspectDimensions('1:1')).toEqual({ width: 1080, height: 1080 })
    expect(aspectDimensions('9:16')).toEqual({ width: 1080, height: 1920 })
  })
})

describe('renderHeatmapCardSvg', () => {
  it('produces an svg sized to the requested aspect', () => {
    const svg = renderHeatmapCardSvg({ heatmap, aspect: '16:9' })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('width="1920"')
    expect(svg).toContain('height="1080"')
    expect(svg).toContain('viewBox="0 0 1920 1080"')
  })

  it('draws a rounded rect for every layout key', () => {
    const svg = renderHeatmapCardSvg({ heatmap, aspect: '1:1' })
    const rects = svg.match(/<rect /g) ?? []
    expect(rects.length).toBeGreaterThan(60)
  })

  it('includes the handle and stats overlays when provided', () => {
    const svg = renderHeatmapCardSvg({
      heatmap,
      aspect: '16:9',
      handle: '@octocat',
      stats: '60 cpm  ·  TypeScript',
    })
    expect(svg).toContain('@octocat')
    expect(svg).toContain('60 cpm')
  })

  it('omits overlays when not provided', () => {
    const svg = renderHeatmapCardSvg({ heatmap, aspect: '16:9' })
    expect(svg).not.toContain('@')
  })

  it('renders the Meta key as ASCII so it survives any server font', () => {
    const svg = renderHeatmapCardSvg({ heatmap, aspect: '16:9' })
    expect(svg).toContain('Cmd')
    expect(svg).not.toContain('⌘')
  })

  it('xml-escapes overlay text', () => {
    const svg = renderHeatmapCardSvg({
      heatmap,
      aspect: '16:9',
      stats: 'a & b < c',
    })
    expect(svg).toContain('a &amp; b &lt; c')
  })

  it('strips control characters that xml cannot represent', () => {
    const svg = renderHeatmapCardSvg({
      heatmap,
      aspect: '16:9',
      handle: '@oct\u0000ocat',
      stats: '60 cpm  ·  ts\u000bx',
    })
    expect(svg).toContain('@octocat')
    expect(svg).toContain('tsx')
    expect(svg).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
  })

  it('stays parseable by the png renderer for hostile language names', async () => {
    const svg = renderHeatmapCardSvg({
      heatmap,
      aspect: '16:9',
      handle: '@octocat',
      stats: '60 cpm  ·  ts\u0000\u000b<script>',
    })
    await expect(sharp(Buffer.from(svg)).png().toBuffer()).resolves.toBeTruthy()
  })
})

describe('heatmapCardCacheKey', () => {
  it('encodes every input that changes the rendered image', () => {
    expect(
      heatmapCardCacheKey({
        sessionId: 'abc',
        aspect: '16:9',
        layout: 'qwerty',
        handle: 'octocat',
        stats: true,
      }),
    ).toBe('card:v1:abc:16:9:qwerty:h-octocat:s')
  })

  it('distinguishes a hidden handle from a drawn one', () => {
    const base = {
      sessionId: 'abc',
      aspect: '1:1',
      layout: 'qwerty',
    } as const
    const shown = heatmapCardCacheKey({ ...base, handle: 'octocat', stats: true })
    const hidden = heatmapCardCacheKey({ ...base, handle: null, stats: true })
    const noStats = heatmapCardCacheKey({
      ...base,
      handle: 'octocat',
      stats: false,
    })
    expect(new Set([shown, hidden, noStats]).size).toBe(3)
    expect(hidden).toContain(':H:')
  })

  it('busts the key when the handle changes so a rename never serves stale', () => {
    const base = {
      sessionId: 'abc',
      aspect: '16:9',
      layout: 'qwerty',
      stats: true,
    } as const
    expect(heatmapCardCacheKey({ ...base, handle: 'before' })).not.toBe(
      heatmapCardCacheKey({ ...base, handle: 'after' }),
    )
  })

  it('separates aspects and sessions', () => {
    const a = heatmapCardCacheKey({
      sessionId: 'one',
      aspect: '9:16',
      layout: 'qwerty',
      handle: 'octocat',
      stats: true,
    })
    const b = heatmapCardCacheKey({
      sessionId: 'two',
      aspect: '9:16',
      layout: 'qwerty',
      handle: 'octocat',
      stats: true,
    })
    expect(a).not.toBe(b)
  })
})
