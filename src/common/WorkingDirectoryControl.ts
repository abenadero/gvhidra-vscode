import * as vscode from 'vscode';
import { WebviewControls } from '../webview/components/WebviewControls';

/**
 * Control global que muestra la carpeta de trabajo y permite que cualquier
 * sección lea el mismo valor sin duplicar campos ni identificadores.
 */
export class WorkingDirectoryControl {
    public static readonly inputId = 'working-directory';

    /**
     * Genera el control HTML de solo lectura que muestra el directorio activo.
     *
     * @returns Marcado HTML del control de directorio de trabajo.
     */
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

    /**
     * Obtiene la carpeta de trabajo, priorizando la del editor activo en un workspace multirraíz.
     *
     * @returns URI de la carpeta seleccionada o `undefined` si no hay carpetas abiertas.
     */
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

    /**
     * Resuelve una ruta únicamente cuando coincide con una carpeta abierta en VS Code.
     *
     * @param path Ruta de sistema de archivos que se desea resolver.
     * @returns URI de la carpeta coincidente o `undefined` si la ruta no es válida o no está abierta.
     */
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

/**
 * Normaliza una ruta para comparaciones sensibles a la plataforma.
 *
 * @param path Ruta que se va a comparar.
 * @returns Ruta en minúsculas en Windows o la ruta original en otros sistemas.
 */
function comparablePath(path: string): string {
    return process.platform === 'win32' ? path.toLowerCase() : path;
}
