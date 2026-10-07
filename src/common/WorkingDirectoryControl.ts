import * as vscode from 'vscode';
import { WebviewControls } from '../webview/components/WebviewControls';

/**
 * Control global que muestra la carpeta de trabajo y permite que cualquier
 * sección lea el mismo valor sin duplicar campos ni identificadores.
 */
export class WorkingDirectoryControl {
    public static readonly inputId = 'working-directory';

    public static render(): string {
        return `<div class="common-working-directory panel">
            ${WebviewControls.setLabelledInput(
                'Directorio de trabajo',
                this.inputId,
                this.current()?.fsPath ?? '',
                'Abre una carpeta de proyecto en VS Code',
                true
            )}
        </div>`;
    }

    /** Prioriza la carpeta del editor activo en espacios de trabajo múltiples. */
    public static current(): vscode.Uri | undefined {
        const activeDocument = vscode.window.activeTextEditor?.document.uri;
        if (activeDocument) {
            const activeFolder = vscode.workspace.getWorkspaceFolder(activeDocument);
            if (activeFolder) {
                return activeFolder.uri;
            }
        }
        return vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    /** Resuelve exclusivamente rutas correspondientes a carpetas abiertas. */
    public static resolveOpenFolder(path?: string): vscode.Uri | undefined {
        const trimmedPath = path?.trim();
        if (!trimmedPath) {
            return undefined;
        }

        const requestedPath = comparablePath(vscode.Uri.file(trimmedPath).fsPath);
        return vscode.workspace.workspaceFolders
            ?.find(folder => comparablePath(folder.uri.fsPath) === requestedPath)
            ?.uri;
    }
}

function comparablePath(path: string): string {
    return process.platform === 'win32' ? path.toLowerCase() : path;
}
