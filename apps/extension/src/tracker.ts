import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type { HeartbeatEvent, KeyFreq } from '@commma/shared'
import { addKeyFreq, tallyChange } from './keyCounter.js'
import type { IngestClient } from './client.js'
import { getPrivacyMode } from './privacy.js'

const FLUSH_INTERVAL_MS = 60 * 1000

interface FileAccumulator {
  lang: string
  file: string
  project: string | undefined
  keystrokes: number
  lines: number
  keyFreq: KeyFreq
}

type TrackerState = 'tracking' | 'offline'

export class Tracker {
  private readonly accumulators = new Map<string, FileAccumulator>()
  private changeSub: vscode.Disposable | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly client: IngestClient,
    private readonly onState?: (state: TrackerState) => void,
  ) {}

  start(): void {
    if (this.changeSub) return
    this.changeSub = vscode.workspace.onDidChangeTextDocument((e) =>
      this.onChange(e),
    )
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
  }

  stop(): void {
    this.changeSub?.dispose()
    this.changeSub = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.accumulators.clear()
  }

  private onChange(e: vscode.TextDocumentChangeEvent): void {
    if (getPrivacyMode() === 'off') return
    const doc = e.document
    if (doc.uri.scheme !== 'file' || e.contentChanges.length === 0) return

    const key = doc.uri.toString()
    const acc: FileAccumulator = this.accumulators.get(key) ?? {
      lang: doc.languageId,
      file: vscode.workspace.asRelativePath(doc.uri, false),
      project: vscode.workspace.getWorkspaceFolder(doc.uri)?.name,
      keystrokes: 0,
      lines: 0,
      keyFreq: {},
    }

    for (const change of e.contentChanges) {
      const tally = tallyChange({
        text: change.text,
        rangeLength: change.rangeLength,
        removedLineCount: change.range.end.line - change.range.start.line,
      })
      acc.keystrokes += tally.keystrokes
      acc.lines += tally.lines
      addKeyFreq(acc.keyFreq, tally.keyFreq)
    }

    this.accumulators.set(key, acc)
  }

  private async flush(): Promise<void> {
    const mode = getPrivacyMode()
    if (mode === 'off' || this.accumulators.size === 0) {
      this.accumulators.clear()
      return
    }

    const ts = Date.now()
    const events: HeartbeatEvent[] = []
    for (const acc of this.accumulators.values()) {
      if (acc.keystrokes === 0 && acc.lines === 0) continue
      const event: HeartbeatEvent = {
        id: randomUUID(),
        ts,
        lang: acc.lang,
        keystrokes: acc.keystrokes,
        lines: acc.lines,
      }
      if (mode === 'full') {
        event.file = acc.file
        if (acc.project) event.project = acc.project
        event.key_freq = acc.keyFreq
      }
      events.push(event)
    }
    this.accumulators.clear()
    if (events.length === 0) return

    const ok = await this.client.send(events)
    this.onState?.(ok ? 'tracking' : 'offline')
  }
}
