import { randomUUID } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';

/** Solicita un nombre y reserva una carpeta nueva dentro del htdocs de desarrollo. */
export async function createProjectDirectory(title: string): Promise<vscode.Uri | undefined> {
    const projectsRoot = join(homedir(), 'gvhidra', 'gvhidradev', 'htdocs');
    const name = await vscode.window.showInputBox({
        title,
        prompt: `Nombre del proyecto que se creará en ${projectsRoot}`,
        ignoreFocusOut: true,
        validateInput: validateProjectName
    });
    if (name === undefined) {
        return undefined;
    }
    const validation = validateProjectName(name);
    if (validation) {
        void vscode.window.showWarningMessage(validation);
        return undefined;
    }

    const directory = join(projectsRoot, name.trim());
    try {
        await mkdir(projectsRoot, { recursive: true });
        // Sin recursive: no se reutilizan carpetas ni enlaces que ya existan.
        await mkdir(directory);
        return vscode.Uri.file(directory);
    } catch (error) {
        const message = (error as NodeJS.ErrnoException).code === 'EEXIST'
            ? `Ya existe ${directory}. Introduce otro nombre de proyecto.`
            : `No se pudo crear la carpeta del proyecto: ${errorMessage(error)}`;
        void vscode.window.showErrorMessage(message);
        return undefined;
    }
}

/** Solo elimina una carpeta vacía reservada por una operación cancelada o fallida. */
export async function discardEmptyProjectDirectory(directory: vscode.Uri): Promise<void> {
    try {
        await rmdir(directory.fsPath);
    } catch {
        // Una descarga parcial o un fichero creado por el usuario se conservan.
    }
}

/** Ejecuta la descarga en una terminal de tareas y abre el proyecto tras un exit code 0. */
export async function runProjectCheckout(
    command: string,
    args: string[],
    directory: vscode.Uri,
    label: string
): Promise<void> {
    const runId = randomUUID();
    const task = new vscode.Task(
        { type: 'gvhidra.checkout', runId },
        vscode.TaskScope.Workspace,
        `${label}: ${basename(directory.fsPath)}`,
        'GVHidra',
        new vscode.ProcessExecution(command, args, { cwd: directory.fsPath })
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, echo: false };

    let finish!: (exitCode: number | undefined) => void;
    const completion = new Promise<number | undefined>(resolve => { finish = resolve; });
    // Se registran antes de ejecutar para no perder la finalización de tareas muy rápidas.
    const subscriptions = [
        vscode.tasks.onDidEndTaskProcess(event => {
            if (event.execution.task.definition.runId === runId) {
                finish(event.exitCode);
            }
        }),
        vscode.tasks.onDidEndTask(event => {
            if (event.execution.task.definition.runId === runId) {
                finish(undefined);
            }
        })
    ];

    let exitCode: number | undefined;
    try {
        await vscode.tasks.executeTask(task);
        exitCode = await completion;
    } catch (error) {
        void vscode.window.showErrorMessage(`No se pudo iniciar ${label}: ${errorMessage(error)}`);
        await discardEmptyProjectDirectory(directory);
        return;
    } finally {
        subscriptions.forEach(subscription => subscription.dispose());
    }

    if (exitCode !== 0) {
        void vscode.window.showErrorMessage(
            `${label} no ha finalizado correctamente. Revisa la terminal de la tarea.`
        );
        await discardEmptyProjectDirectory(directory);
        return;
    }

    try {
        await vscode.commands.executeCommand('vscode.openFolder', directory);
    } catch (error) {
        void vscode.window.showErrorMessage(
            `El proyecto está descargado en ${directory.fsPath}, pero no se pudo abrir: ${errorMessage(error)}`
        );
    }
}

function validateProjectName(value: string): string | undefined {
    const name = value.trim();
    if (!name) {
        return 'Introduce el nombre del proyecto.';
    }
    if (name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name.endsWith('.')) {
        return 'Introduce un nombre de carpeta válido, sin rutas ni barras.';
    }
    return undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
