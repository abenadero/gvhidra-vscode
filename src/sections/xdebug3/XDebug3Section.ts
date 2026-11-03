import { sep } from 'node:path';
import * as vscode from 'vscode';
import { WorkingDirectoryControl } from '../../common/WorkingDirectoryControl';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

/** Crea la configuración de escucha de Xdebug 3 para el proyecto abierto. */
export class XDebug3Section extends WebviewSection {
    public readonly id = 'xdebug3';

    /**
     * Genera los controles para iniciar el depurador o crear su configuración.
     *
     * @returns Marcado HTML de la sección Xdebug 3.
     */
    public render(): string {
        return sectionMarkup('XDebug3', [
            WebviewControls.setButton(`${this.id}.startDebug`, 'Iniciar Debug', {
                variant: 'primary',
                icon: 'play'
            }),
            WebviewControls.setButtonWithInput(
                `${this.id}.initialize`,
                'Reconfigurar XDebug3',
                WorkingDirectoryControl.inputId,
                { icon: 'bug' }
            )
        ].join(''), { icon: 'bug' });
    }

    /**
     * Ejecuta una acción de inicialización o arranque del depurador.
     *
     * @param action Nombre local de la acción solicitada.
     * @param value Ruta opcional recibida desde el control de directorio.
     * @returns `true` si la acción fue reconocida; en caso contrario, `false`.
     */
    public async handleAction(action: string, value?: string): Promise<boolean> {
        if (action === 'initialize') {
            await this.initialize(value);
            return true;
        }
        if (action === 'startDebug') {
            await vscode.commands.executeCommand('workbench.action.debug.start');
            return true;
        }
        return false;
    }

    /**
     * Crea el fichero `.vscode/launch.json` para el proyecto seleccionado.
     *
     * @param workingDirectoryPath Ruta de una carpeta abierta que contiene el proyecto.
     * @returns Promesa que finaliza al crear la configuración o cancelar la operación.
     */
    private async initialize(workingDirectoryPath?: string): Promise<void> {
        const trimmedPath = workingDirectoryPath?.trim();
        if (!trimmedPath) {
            void vscode.window.showWarningMessage('Abre una carpeta de proyecto antes de inicializar Xdebug3.');
            return;
        }

        const workingDirectory = WorkingDirectoryControl.resolveOpenFolder(trimmedPath);
        if (!workingDirectory) {
            void vscode.window.showErrorMessage('El directorio de trabajo no corresponde a una carpeta abierta en VS Code.');
            return;
        }
        if (!await isDirectory(workingDirectory)) {
            void vscode.window.showErrorMessage(`El directorio de trabajo no existe: ${trimmedPath}`);
            return;
        }

        const projectName = projectNameAfterHtdocs(workingDirectory.fsPath);
        if (!projectName) {
            void vscode.window.showErrorMessage(
                'El directorio de trabajo debe estar dentro de htdocs para calcular pathMappings.'
            );
            return;
        }

        const configurationDirectory = vscode.Uri.joinPath(workingDirectory, '.vscode');
        const launchFile = vscode.Uri.joinPath(configurationDirectory, 'launch.json');

        if (await exists(launchFile)) {
            const choice = await vscode.window.showWarningMessage(
                `Ya existe ${launchFile.fsPath}. ¿Quieres sustituirlo?`,
                { modal: true },
                'Sustituir'
            );
            if (choice !== 'Sustituir') {
                return;
            }
        }

        await vscode.workspace.fs.createDirectory(configurationDirectory);
        await vscode.workspace.fs.writeFile(
            launchFile,
            new TextEncoder().encode(createLaunchConfiguration(projectName))
        );
        void vscode.window.showInformationMessage(`Xdebug3 inicializado en ${launchFile.fsPath}.`);
    }

}

/**
 * Obtiene el nombre del proyecto, definido como el primer segmento tras `htdocs`.
 *
 * @param path Ruta del proyecto que se desea analizar.
 * @returns Nombre del proyecto o `undefined` si no existe un segmento válido.
 */
function projectNameAfterHtdocs(path: string): string | undefined {
    const segments = path.split(sep).filter(Boolean);
    const htdocsIndex = segments.map(segment => segment.toLowerCase()).lastIndexOf('htdocs');
    return htdocsIndex >= 0 ? segments[htdocsIndex + 1] : undefined;
}

/**
 * Construye el contenido de `launch.json` con los mapeos de rutas de Xdebug.
 *
 * @param projectName Nombre del proyecto bajo el `htdocs` remoto.
 * @returns Configuración JSON con comentarios lista para escribirse en disco.
 */
function createLaunchConfiguration(projectName: string): string {
    const serverProjectPath = JSON.stringify(`/var/www/htdocs/${projectName}`);

    return `{
    // Use IntelliSense to learn about possible attributes.
    // Hover to view descriptions of existing attributes.
    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Listen for Xdebug",
            "type": "php",
            "request": "launch",
            "port": 9003,
            "stopOnEntry": false,
            "log": true,
            "ignore": [
                "**/vendor/**/*.php"
            ],
            "pathMappings": {
                ${serverProjectPath}: "\${workspaceFolder}"
            }
        },
        {
            "name": "Xdebug every line",
            "type": "php",
            "request": "launch",
            "port": 9003,
            "stopOnEntry": true,
            "log": true,
            "ignore": [
                "**/vendor/**/*.php"
            ],
            "pathMappings": {
                ${serverProjectPath}: "\${workspaceFolder}"
            }
        }
    ]
}
`;
}

/**
 * Comprueba si una URI existe en el sistema de archivos del workspace.
 *
 * @param uri Recurso que se desea consultar.
 * @returns `true` si puede obtenerse su estado; en caso contrario, `false`.
 */
async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Comprueba si una URI existente representa un directorio.
 *
 * @param uri Recurso que se desea consultar.
 * @returns `true` si el recurso es un directorio; en caso contrario, `false`.
 */
async function isDirectory(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.Directory) !== 0;
    } catch {
        return false;
    }
}
