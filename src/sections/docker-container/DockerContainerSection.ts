import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

export class DockerContainerSection extends WebviewSection {
    public readonly id = 'docker-container';

    /** @returns Panel de control de los contenedores de gvhidradev. */
    public render(): string {
        return sectionMarkup('Docker Container', [
            WebviewControls.setButton(`${this.id}.up`, 'Levantar Contenedores', {
                variant: 'primary',
                icon: 'play',
                tooltip: 'Ejecutar docker compose up -d en ~/gvhidra/gvhidradev'
            }),
            WebviewControls.setButton(`${this.id}.down`, 'Bajar Contenedores', {
                icon: 'trash',
                tooltip: 'Ejecutar docker compose down en ~/gvhidra/gvhidradev'
            })
        ].join(''), { icon: 'docker' });
    }

    /**
     * Ejecuta únicamente las operaciones Compose ofrecidas por los botones.
     *
     * @param action Operación solicitada.
     * @returns `true` si la acción es conocida; en caso contrario, `false`.
     */
    public async handleAction(action: string): Promise<boolean> {
        if (action !== 'up' && action !== 'down') {
            return false;
        }

        const directory = join(homedir(), 'gvhidra', 'gvhidradev');
        try {
            if (!(await stat(directory)).isDirectory()) {
                throw new Error(`La ruta no es un directorio: ${directory}`);
            }

            const args = action === 'up' ? ['compose', 'up', '-d'] : ['compose', 'down'];
            const task = new vscode.Task(
                { type: 'gvhidra.docker-compose', action },
                vscode.TaskScope.Workspace,
                `Docker Compose ${action}`,
                'GVHidra',
                new vscode.ProcessExecution('docker', args, { cwd: directory })
            );
            task.presentationOptions = {
                reveal: vscode.TaskRevealKind.Always,
                panel: vscode.TaskPanelKind.Dedicated,
                focus: true
            };
            await vscode.tasks.executeTask(task);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(
                `No se pudo ejecutar Docker Compose en ${directory}: ${detail}`
            );
        }
        return true;
    }
}
