import * as vscode from 'vscode'

export type ConnectionState =
  | 'signedOut'
  | 'tracking'
  | 'offline'
  | 'paused'
  | 'disabled'

export class StatusBar {
  private readonly item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    )
    this.set('signedOut')
    this.item.show()
  }

  set(state: ConnectionState): void {
    switch (state) {
      case 'signedOut':
        this.item.text = '$(circle-slash) commma'
        this.item.tooltip = 'commma: click to sign in'
        this.item.command = 'commma.signIn'
        break
      case 'tracking':
        this.item.text = '$(record) commma'
        this.item.tooltip = 'commma: tracking — click to pause'
        this.item.command = 'commma.toggleTracking'
        break
      case 'offline':
        this.item.text = '$(warning) commma'
        this.item.tooltip = 'commma: offline — retrying (click to pause)'
        this.item.command = 'commma.toggleTracking'
        break
      case 'paused':
        this.item.text = '$(debug-pause) commma'
        this.item.tooltip = 'commma: paused — click to resume'
        this.item.command = 'commma.toggleTracking'
        break
      case 'disabled':
        this.item.text = '$(circle-slash) commma'
        this.item.tooltip = 'commma: tracking off (privacy)'
        this.item.command = {
          command: 'workbench.action.openSettings',
          title: 'Open commma settings',
          arguments: ['commma.privacy'],
        }
        break
    }
  }

  dispose(): void {
    this.item.dispose()
  }
}
