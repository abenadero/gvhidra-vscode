import { lstat, readdir, truncate, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

/** Carpetas ignoradas al borrar Zone.Identifier, con todo su contenido y a cualquier profundidad. */
const ZONE_IDENTIFIER_IGNORED_DIRECTORIES = new Set([
    'templates_c'
]);

export class UtilsSection extends WebviewSection {
    public readonly id = 'utils';

    private deletingZoneIdentifiers = false;

    /** @returns Marcado HTML de las utilidades del entorno gvhidradev. */
    public render(): string {
        return sectionMarkup('Utils', [
            `<div class="button-row">${[
                WebviewControls.setButton(`${this.id}.openPhp74ErrorLog`, 'Abrir log de errores PHP 7.4', {
                    icon: 'file',
                    tooltip: 'Abrir ~/gvhidra/gvhidradev/logs/php74/error.log en VS Code'
                }),
                WebviewControls.setButton(`${this.id}.clearPhp74ErrorLog`, 'Limpiar log de errores PHP 7.4', {
                    icon: 'trash',
                    tooltip: 'Vaciar ~/gvhidra/gvhidradev/logs/php74/error.log sin eliminar el fichero'
                })
            ].join('')}</div>`,
            `<div class="button-row">${[
                WebviewControls.setButton(`${this.id}.openPhp84ErrorLog`, 'Abrir log de errores PHP 8.4', {
                    icon: 'file',
                    tooltip: 'Abrir ~/gvhidra/gvhidradev/logs/php84/error.log en VS Code'
                }),
                WebviewControls.setButton(`${this.id}.clearPhp84ErrorLog`, 'Limpiar log de errores PHP 8.4', {
                    icon: 'trash',
                    tooltip: 'Vaciar ~/gvhidra/gvhidradev/logs/php84/error.log sin eliminar el fichero'
                })
            ].join('')}</div>`,
            WebviewControls.setButton(`${this.id}.deleteZoneIdentifiers`, 'Delete zone identifiers', {
                icon: 'trash',
                tooltip: 'Eliminar ficheros *:Zone.Identifier de ~/gvhidra y sus subdirectorios, salvo las carpetas ignoradas'
            })
        ].join(''), { icon: 'tools' });
    }

    /**
     * Procesa únicamente las utilidades publicadas por la sección.
     *
     * @param action Nombre local de la acción solicitada.
     * @returns `true` si la acción es conocida; en caso contrario, `false`.
     */
    public async handleAction(action: string): Promise<boolean> {
        switch (action) {
            case 'deleteZoneIdentifiers':
                await this.deleteZoneIdentifiers();
                return true;
            case 'openPhp74ErrorLog':
                await this.openPhpErrorLog('php74');
                return true;
            case 'openPhp84ErrorLog':
                await this.openPhpErrorLog('php84');
                return true;
            case 'clearPhp74ErrorLog':
                await this.clearPhpErrorLog('php74');
                return true;
            case 'clearPhp84ErrorLog':
                await this.clearPhpErrorLog('php84');
                return true;
            default:
                return false;
        }
    }

    /**
     * Elimina los identificadores de zona del árbol de ~/gvhidra e informa del resultado.
     * Evita lanzar varios recorridos simultáneos desde la misma vista.
     */
    private async deleteZoneIdentifiers(): Promise<void> {
        if (this.deletingZoneIdentifiers) {
            return;
        }

        this.deletingZoneIdentifiers = true;
        const root = join(homedir(), 'gvhidra');
        try {
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Eliminando ficheros *:Zone.Identifier de ~/gvhidra'
            }, async () => {
                if (!(await lstat(root)).isDirectory()) {
                    throw new Error(`La ruta no es un directorio: ${root}`);
                }
                return deleteZoneIdentifierFiles(root);
            });

            if (result.failed > 0) {
                void vscode.window.showErrorMessage(
                    `Eliminados ${result.deleted} ficheros *:Zone.Identifier de ${root}. `
                    + `No se pudieron completar ${result.failed} operaciones: ${result.firstError}`
                );
            } else {
                void vscode.window.showInformationMessage(result.deleted === 0
                    ? `No se encontraron ficheros *:Zone.Identifier en ${root}.`
                    : `Eliminados ${result.deleted} ficheros *:Zone.Identifier de ${root}.`);
            }
        } catch (error) {
            void vscode.window.showErrorMessage(
                `No se pudieron eliminar los ficheros *:Zone.Identifier de ${root}: ${errorMessage(error)}`
            );
        } finally {
            this.deletingZoneIdentifiers = false;
        }
    }

    /**
     * Abre el log existente en una pestaña fija del editor de VS Code.
     *
     * @param version Directorio de logs de la versión de PHP solicitada.
     */
    private async openPhpErrorLog(version: 'php74' | 'php84'): Promise<void> {
        const log = vscode.Uri.file(join(homedir(), 'gvhidra', 'gvhidradev', 'logs', version, 'error.log'));
        try {
            const document = await vscode.workspace.openTextDocument(log);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
            void vscode.window.showErrorMessage(`No se pudo abrir ${log.fsPath}: ${errorMessage(error)}`);
        }
    }

    /**
     * Vacía el log existente conservando el fichero y los descriptores abiertos por PHP.
     *
     * @param version Directorio de logs de la versión de PHP solicitada.
     */
    private async clearPhpErrorLog(version: 'php74' | 'php84'): Promise<void> {
        const log = join(homedir(), 'gvhidra', 'gvhidradev', 'logs', version, 'error.log');
        try {
            await truncate(log, 0);
            void vscode.window.showInformationMessage(`Log de errores vaciado: ${log}.`);
        } catch (error) {
            void vscode.window.showErrorMessage(`No se pudo vaciar ${log}: ${errorMessage(error)}`);
        }
    }
}

interface CleanupResult {
    deleted: number;
    failed: number;
    firstError?: string;
}

/**
 * Recorre los subdirectorios, incluidos los ocultos, omitiendo las carpetas ignoradas
 * y sin seguir enlaces simbólicos.
 * Solo elimina ficheros con el sufijo exacto y continúa si una operación falla.
 *
 * @param root Directorio raíz del recorrido.
 * @returns Número de ficheros eliminados y errores encontrados.
 */
async function deleteZoneIdentifierFiles(root: string): Promise<CleanupResult> {
    const result: CleanupResult = { deleted: 0, failed: 0 };
    const directories = [root];
    const recordFailure = (error: unknown): void => {
        result.failed += 1;
        result.firstError ??= errorMessage(error);
    };

    while (directories.length > 0) {
        const directory = directories.pop()!;
        try {
            const entries = await readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) {
                    if (!ZONE_IDENTIFIER_IGNORED_DIRECTORIES.has(entry.name)) {
                        directories.push(path);
                    }
                } else if (entry.isFile() && entry.name.endsWith(':Zone.Identifier')) {
                    try {
                        await unlink(path);
                        result.deleted += 1;
                    } catch (error) {
                        recordFailure(error);
                    }
                }
            }
        } catch (error) {
            recordFailure(error);
        }
    }
    return result;
}

/** @returns Descripción legible de un error de las utilidades. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
