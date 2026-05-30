import * as vscode from 'vscode'
import { Auth } from './auth.js'
import { IngestClient } from './client.js'
import { Tracker } from './tracker.js'
import { StatusBar } from './statusBar.js'
import { getPrivacyMode } from './privacy.js'

export async function activate(context: vscode.ExtensionContext) {
  const auth = new Auth(context)
  const client = new IngestClient(auth)
  const statusBar = new StatusBar()
  const tracker = new Tracker(client, (state) => statusBar.set(state))

  let paused = false

  const refreshState = async () => {
    if (getPrivacyMode() === 'off') {
      tracker.stop()
      statusBar.set('disabled')
      return
    }
    if (!(await auth.isSignedIn()) || !(await auth.getAccessToken())) {
      tracker.stop()
      statusBar.set('signedOut')
      return
    }
    if (paused) {
      tracker.stop()
      statusBar.set('paused')
      return
    }
    tracker.start()
    statusBar.set('tracking')
  }

  const signIn = vscode.commands.registerCommand('commma.signIn', async () => {
    try {
      const ok = await auth.signIn()
      if (ok) {
        vscode.window.showInformationMessage('commma: signed in')
        await refreshState()
      } else {
        vscode.window.showWarningMessage('commma: sign-in cancelled')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      vscode.window.showErrorMessage(`commma: sign-in failed (${message})`)
    }
  })

  const signOut = vscode.commands.registerCommand('commma.signOut', async () => {
    await auth.signOut()
    paused = false
    tracker.stop()
    statusBar.set('signedOut')
    vscode.window.showInformationMessage('commma: signed out')
  })

  const toggleTracking = vscode.commands.registerCommand(
    'commma.toggleTracking',
    async () => {
      paused = !paused
      await refreshState()
      vscode.window.showInformationMessage(
        paused ? 'commma: tracking paused' : 'commma: tracking resumed',
      )
    },
  )

  const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('commma')) void refreshState()
  })

  context.subscriptions.push(signIn, signOut, toggleTracking, statusBar, configSub, {
    dispose: () => tracker.stop(),
  })

  await refreshState()
}

export function deactivate() {}
