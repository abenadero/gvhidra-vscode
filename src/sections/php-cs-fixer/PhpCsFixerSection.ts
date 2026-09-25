import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

const execFileAsync = promisify(execFile);

/**
 * Presenta las operaciones de PHP CS Fixer y comprueba su disponibilidad.
 *
 * La detección prioriza el ejecutable instalado por Composer en el proyecto
 * (vendor/bin/php-cs-fixer), después Composer global y finalmente el comando
 * disponible en PATH.
 * Ningún botón se renderiza hasta localizar una de esas instalaciones.
 */
export class PhpCsFixerSection extends WebviewSection {
    public readonly id = 'php-cs-fixer';

    private executable?: string;

    /**
     * Comprueba la instalación en cada renderizado. De este modo la vista nunca
     * ofrece acciones que no puedan ejecutarse en el entorno local.
     */
    public async render(): Promise<string> {
        this.executable = await this.findExecutable();

        if (!this.executable) {
            return sectionMarkup(
                'PHP CS FIXER',
                '<p class="repository-kind">No se encuentra php-cs-fixer en el entorno local.</p>'
            );
        }

        return sectionMarkup('PHP CS FIXER', [
            WebviewControls.setButton(`${this.id}.fixSelectedFile`, 'Fix selected file'),
            WebviewControls.setButton(`${this.id}.fixProject`, 'Fix project')
        ].join(''));
    }

    /** Despacha exclusivamente las dos acciones publicadas por esta sección. */
    public async handleAction(action: string): Promise<boolean> {
        if (action === 'fixSelectedFile') {
            await this.fixSelectedFile();
            return true;
        }
        if (action === 'fixProject') {
            await this.fixProject();
            return true;
        }
        return false;
    }

    /**
     * Corrige únicamente el documento activo. Los documentos que no sean PHP,
     * no estén en disco o estén fuera del proyecto se ignoran deliberadamente.
     */
    private async fixSelectedFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const root = this.workspaceRoot();
        if (
            !editor
            || !root
            || editor.document.languageId !== 'php'
            || editor.document.uri.scheme !== 'file'
            || !isInside(editor.document.uri, root.uri)
        ) {
            return;
        }

        if (editor.document.isDirty && !await editor.document.save()) {
            return;
        }

        await this.runFixer(
            await this.buildFixArguments(editor.document.uri.fsPath),
            'Fix selected PHP file'
        );
    }

    /**
     * Ejecuta PHP CS Fixer sobre la raíz completa. El propio fixer recorre los
     * directorios y procesa ficheros PHP, respetando las reglas del proyecto.
     */
    private async fixProject(): Promise<void> {
        if (!await vscode.workspace.saveAll(false)) {
            return;
        }
        await this.runFixer(
            await this.buildFixArguments('.'),
            'Fix PHP project'
        );
    }

    /**
     * Evita que PHP CS Fixer abra su asistente interactivo cuando el proyecto
     * no tiene configuración y desactiva la caché para no crear archivos en el
     * proyecto. Sin configuración se declara @PSR12 explícitamente; si existe,
     * se conserva sin sobrescribir sus reglas.
     */
    private async buildFixArguments(path: string): Promise<string[]> {
        const args = ['fix', '--no-interaction', '--using-cache=no'];
        if (!await this.hasProjectConfiguration()) {
            args.push('--rules=@PSR12');
        }
        args.push('--', path);
        return args;
    }

    /** Comprueba los dos nombres de configuración reconocidos por el fixer. */
    private async hasProjectConfiguration(): Promise<boolean> {
        const root = this.workspaceRoot();
        if (!root) {
            return false;
        }

        const configurations = [
            vscode.Uri.joinPath(root.uri, '.php-cs-fixer.php'),
            vscode.Uri.joinPath(root.uri, '.php-cs-fixer.dist.php')
        ];
        return (await Promise.all(configurations.map(exists))).some(Boolean);
    }

    /**
     * Ejecuta mediante una tarea de VS Code para que argumentos y rutas sean
     * gestionados por el shell configurado y el progreso sea visible.
     */
    private async runFixer(args: string[], taskName: string): Promise<void> {
        const root = this.workspaceRoot();
        const executable = this.executable ?? await this.findExecutable();
        if (!root || !executable) {
            return;
        }

        const task = new vscode.Task(
            { type: 'gvhidra-php-cs-fixer' },
            root,
            taskName,
            'GVHidra',
            new vscode.ShellExecution(executable, args, { cwd: root.uri.fsPath })
        );
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Dedicated,
            clear: true
        };
        await vscode.tasks.executeTask(task);
    }

    /**
     * Busca primero las variantes de Composer para Linux/macOS y Windows. Si
     * no existen, revisa Composer global y finalmente consulta el PATH.
     */
    private async findExecutable(): Promise<string | undefined> {
        const root = this.workspaceRoot();
        if (!root) {
            return undefined;
        }

        const localCandidates = process.platform === 'win32'
            ? ['vendor/bin/php-cs-fixer.bat', 'vendor/bin/php-cs-fixer']
            : ['vendor/bin/php-cs-fixer'];

        for (const relativePath of localCandidates) {
            const candidate = vscode.Uri.joinPath(root.uri, ...relativePath.split('/'));
            if (await exists(candidate)) {
                return candidate.fsPath;
            }
        }

        /*
         * Composer no siempre añade su directorio global de binarios al PATH
         * heredado por VS Code. Se comprueban sus ubicaciones habituales para
         * que una instalación global válida también habilite los botones.
         */
        const composerHomes = [
            process.env.COMPOSER_HOME,
            join(homedir(), '.config', 'composer'),
            join(homedir(), '.composer'),
            process.env.APPDATA ? join(process.env.APPDATA, 'Composer') : undefined
        ].filter((path): path is string => Boolean(path));
        const globalExecutable = process.platform === 'win32'
            ? 'php-cs-fixer.bat'
            : 'php-cs-fixer';

        for (const composerHome of composerHomes) {
            const candidate = vscode.Uri.file(join(composerHome, 'vendor', 'bin', globalExecutable));
            if (await exists(candidate)) {
                return candidate.fsPath;
            }
        }

        const locator = process.platform === 'win32' ? 'where.exe' : 'which';
        try {
            await execFileAsync(locator, ['php-cs-fixer'], {
                cwd: root.uri.fsPath,
                timeout: 5000,
                windowsHide: true
            });
            return 'php-cs-fixer';
        } catch {
            return undefined;
        }
    }

    private workspaceRoot(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

function isInside(file: vscode.Uri, folder: vscode.Uri): boolean {
    const separator = folder.fsPath.includes('\\') ? '\\' : '/';
    const folderPath = folder.fsPath.endsWith(separator) ? folder.fsPath : `${folder.fsPath}${separator}`;
    return file.fsPath === folder.fsPath || file.fsPath.startsWith(folderPath);
}
