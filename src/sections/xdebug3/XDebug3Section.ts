import { sep } from 'node:path';
import * as vscode from 'vscode';
import { WorkingDirectoryControl } from '../../common/WorkingDirectoryControl';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

/** Crea la configuración de escucha de Xdebug 3 para el proyecto abierto. */
export class XDebug3Section extends WebviewSection {
    public readonly id = 'xdebug3';

    public render(): string {
        return sectionMarkup('XDebug3', [
            WebviewControls.setButtonWithInput(
                `${this.id}.initialize`,
                'Inicializar Xdebug3',
                WorkingDirectoryControl.inputId,
                { icon: 'bug' }
            ),
            WebviewControls.setButton(`${this.id}.startDebug`, 'Iniciar Debug', {
                variant: 'primary',
                icon: 'play'
            })
        ].join(''), { icon: 'bug' });
    }

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

/** Devuelve el nombre del proyecto, es decir, el primer segmento tras htdocs. */
function projectNameAfterHtdocs(path: string): string | undefined {
    const segments = path.split(sep).filter(Boolean);
    const htdocsIndex = segments.map(segment => segment.toLowerCase()).lastIndexOf('htdocs');
    return htdocsIndex >= 0 ? segments[htdocsIndex + 1] : undefined;
}

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

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.Directory) !== 0;
    } catch {
        return false;
    }
}
