import * as vscode from 'vscode'
import type { PrivacyMode } from '@commma/shared'

export function getPrivacyMode(): PrivacyMode {
  const value = vscode.workspace
    .getConfiguration('commma')
    .get<string>('privacy', 'full')
  if (value === 'summary' || value === 'off') return value
  return 'full'
}

export function getApiBaseUrl(): string {
  return vscode.workspace
    .getConfiguration('commma')
    .get<string>('apiBaseUrl', 'http://localhost:3000')
    .replace(/\/+$/, '')
}
