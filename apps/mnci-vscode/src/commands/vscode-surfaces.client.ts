import { join } from 'node:path'
import * as vscode from 'vscode'
import type { DoctorSurface } from '../doctor-check'
import type { UpdateSurface } from '../cli-update'
import { runCommandInTerminal } from '../invocation'

/**
 * Shows doctor results in the Problems panel and as a message.
 *
 * @remarks
 * The findings are about the workspace, not a line of code, so they are attached to the first
 * line of `nx.json`, where mnci keeps its settings. Each carries the CLI's own remedy as
 * related information. The message offers to open the Problems panel.
 *
 * @param workspaceRoot - The workspace folder.
 * @param collection - The diagnostic collection to fill.
 * @returns A surface for {@link runDoctorCheck}.
 * @throws Never - showing is best effort.
 * @typeParam None - this function has no generic type parameters.
 */
export function createDoctorSurface (workspaceRoot: string | undefined, collection: vscode.DiagnosticCollection): DoctorSurface {
  return {
    showProblems (problems) {
      collection.clear()
      if (workspaceRoot === undefined || problems.length === 0) {
        return
      }
      const uri = vscode.Uri.file(join(workspaceRoot, 'nx.json'))
      const range = new vscode.Range(0, 0, 0, 1)
      collection.set(uri, problems.map(problem => {
        const diagnostic = new vscode.Diagnostic(range, problem.message, vscode.DiagnosticSeverity.Warning)
        diagnostic.source = 'mnci doctor'
        if (problem.remedy) {
          diagnostic.relatedInformation = [new vscode.DiagnosticRelatedInformation(new vscode.Location(uri, range), `Fix: ${problem.remedy}`)]
        }

        return diagnostic
      }))
    },
    tell (message, kind) {
      const show = kind === 'info' ? vscode.window.showInformationMessage : vscode.window.showWarningMessage
      void show(message, 'Open Problems').then(choice => {
        if (choice === 'Open Problems') {
          void vscode.commands.executeCommand('workbench.actions.view.problems')
        }
      })
    },
  }
}

/**
 * Confirms, runs and reports an update of the CLI.
 *
 * @remarks
 * Confirmation is modal, because the command it runs changes the machine or the workspace.
 *
 * @returns A surface for {@link updateCli}.
 * @throws Never - showing is best effort.
 * @typeParam None - this function has no generic type parameters.
 * @param None - this function takes no parameters.
 */
export function createUpdateSurface (): UpdateSurface {
  return {
    confirm: async message => (await vscode.window.showWarningMessage(message, { modal: true }, 'Run')) === 'Run',
    run:     (command, arguments_, cwd) => { runCommandInTerminal(command, arguments_, cwd) },
    tell:    message => { void vscode.window.showInformationMessage(message) },
  }
}
