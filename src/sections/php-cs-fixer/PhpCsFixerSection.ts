import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { WorkingDirectoryControl } from '../../common/WorkingDirectoryControl';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';
import { PHP_CS_FIXER_CONFIGURATION } from './PhpCsFixerConfiguration';

const execFileAsync = promisify(execFile);

/**
 * Presenta las operaciones de PHP CS Fixer y comprueba su disponibilidad.
 *
 * La detección prioriza el ejecutable instalado por Composer en el proyecto
 * (vendor/bin/php-cs-fixer), después Composer global y finalmente el comando
 * disponible en PATH.
 * Las acciones de fix solo se renderizan tras localizar una instalación; la
 * creación de la configuración permanece disponible en todo momento.
 */
export class PhpCsFixerSection extends WebviewSection {
    public readonly id = 'php-cs-fixer';

    private executable?: string;

    /**
     * Comprueba la instalación en cada renderizado. De este modo la vista nunca
     * ofrece acciones que no puedan ejecutarse en el entorno local.
     *
     * @returns Marcado HTML de la sección según la disponibilidad del ejecutable.
     */
    public async render(): Promise<string> {
        this.executable = await this.findExecutable();

        if (!this.executable) {
            return sectionMarkup(
                'PHP CS Fixer',
                [
                    '<p class="repository-kind">No se encuentra php-cs-fixer en el entorno local.</p>',
                    this.createConfigurationButton()
                ].join(''),
                { icon: 'tools', status: 'No disponible', statusTone: 'warning' }
            );
        }

        return sectionMarkup('PHP CS Fixer', [
            WebviewControls.setButton(`${this.id}.fixSelectedFile`, 'Fix selected file', {
                variant: 'primary',
                icon: 'tools'
            }),
            WebviewControls.setButton(`${this.id}.fixProject`, 'Fix project', {
                icon: 'folder'
            }),
            this.createConfigurationButton()
        ].join(''), { icon: 'tools', status: 'Ready', statusTone: 'success' });
    }

    /**
     * Despacha exclusivamente las acciones publicadas por esta sección.
     *
     * @param action Nombre local de la acción solicitada.
     * @returns `true` si la acción es conocida; en caso contrario, `false`.
     */
    public async handleAction(action: string): Promise<boolean> {
        if (action === 'fixSelectedFile') {
            await this.fixSelectedFile();
            return true;
        }
        if (action === 'fixProject') {
            await this.fixProject();
            return true;
        }
        if (action === 'createConfiguration') {
            await this.createConfiguration();
            return true;
        }
        return false;
    }

    /**
     * Genera el botón que permite crear la configuración del proyecto.
     *
     * @returns Marcado HTML del botón de configuración.
     */
    private createConfigurationButton(): string {
        return WebviewControls.setButton(
            `${this.id}.createConfiguration`,
            'Crear fichero configuración',
            { icon: 'file' }
        );
    }

    /**
     * Corrige únicamente el documento activo. Los documentos que no sean PHP,
     * no estén en disco o estén fuera del proyecto se ignoran deliberadamente.
     *
     * @returns Promesa que finaliza después de lanzar la tarea o descartar el documento.
     */
    private async fixSelectedFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const root = WorkingDirectoryControl.current();
        if (
            !editor
            || !root
            || editor.document.languageId !== 'php'
            || editor.document.uri.scheme !== 'file'
            || !isInside(editor.document.uri, root)
        ) {
            return;
        }

        const configuration = await this.requireProjectConfiguration(root);
        if (!configuration) {
            return;
        }

        if (editor.document.isDirty && !await editor.document.save()) {
            return;
        }

        await this.runFixer(
            this.buildFixArguments(configuration, editor.document.uri.fsPath),
            'Fix selected PHP file',
            root
        );
    }

    /**
     * Ejecuta PHP CS Fixer sobre la raíz completa. El propio fixer recorre los
     * directorios y procesa ficheros PHP, respetando las reglas del proyecto.
     *
     * @returns Promesa que finaliza después de lanzar la tarea o cancelar la operación.
     */
    private async fixProject(): Promise<void> {
        const root = WorkingDirectoryControl.current();
        if (!root) {
            return;
        }
        const configuration = await this.requireProjectConfiguration(root);
        if (!configuration) {
            return;
        }
        if (!await vscode.workspace.saveAll(false)) {
            return;
        }
        await this.runFixer(
            this.buildFixArguments(configuration),
            'Fix PHP project',
            root
        );
    }

    /**
     * Construye los argumentos con configuración explícita y sin interacción.
     * Si no se indica un fichero, el Finder del proyecto decide qué rutas procesar.
     * Si se indica, se intersecta con el Finder para respetar sus exclusiones.
     *
     * @param configuration URI del fichero de configuración del proyecto.
     * @param path Fichero que debe procesar PHP CS Fixer, si se limita la ejecución.
     * @returns Argumentos listos para pasarlos al ejecutable.
     */
    private buildFixArguments(configuration: vscode.Uri, path?: string): string[] {
        const args = ['fix', `--config=${configuration.fsPath}`, '--no-interaction'];
        return path === undefined ? args : [...args, '--path-mode=intersection', '--', path];
    }

    /**
     * Localiza la configuración requerida e informa de su ausencia en una terminal.
     *
     * @param root Raíz del proyecto en la que buscar `.php-cs-fixer.php`.
     * @returns URI de la configuración o `undefined` si todavía no existe.
     */
    private async requireProjectConfiguration(root: vscode.Uri): Promise<vscode.Uri | undefined> {
        const configuration = vscode.Uri.joinPath(root, '.php-cs-fixer.php');
        if (await exists(configuration)) {
            return configuration;
        }

        showTerminalMessage(
            `No existe el fichero ${configuration.fsPath}. `
            + 'Puedes crearlo con el botón "Crear fichero configuración" de la sección PHP CS Fixer.'
        );
        return undefined;
    }

    /**
     * Crea la configuración proporcionada por la extensión sin sobrescribir cambios del usuario.
     *
     * @returns Promesa que finaliza cuando el fichero se crea o la operación se descarta.
     */
    private async createConfiguration(): Promise<void> {
        const root = WorkingDirectoryControl.current();
        if (!root) {
            void vscode.window.showWarningMessage('Abre una carpeta de proyecto antes de crear la configuración de PHP CS Fixer.');
            return;
        }

        const configuration = vscode.Uri.joinPath(root, '.php-cs-fixer.php');
        if (await exists(configuration)) {
            void vscode.window.showWarningMessage(`El fichero ya existe: ${configuration.fsPath}`);
            return;
        }

        await vscode.workspace.fs.writeFile(configuration, Buffer.from(PHP_CS_FIXER_CONFIGURATION, 'utf8'));
        void vscode.window.showInformationMessage(`Configuración de PHP CS Fixer creada en ${configuration.fsPath}.`);
    }

    /**
     * Ejecuta mediante una tarea de VS Code para que argumentos y rutas sean
     * gestionados por el shell configurado y el progreso sea visible.
     *
     * @param args Argumentos que se pasarán al ejecutable.
     * @param taskName Nombre visible de la tarea.
     * @param root Directorio de trabajo de la ejecución.
     * @returns Promesa que finaliza cuando VS Code acepta la tarea.
     */
    private async runFixer(args: string[], taskName: string, root: vscode.Uri): Promise<void> {
        const executable = await this.findExecutable(root);
        if (!executable) {
            return;
        }

        const taskScope = vscode.workspace.getWorkspaceFolder(root) ?? vscode.TaskScope.Workspace;

        const task = new vscode.Task(
            { type: 'gvhidra-php-cs-fixer' },
            taskScope,
            taskName,
            'GVHidra',
            new vscode.ShellExecution(executable, args, { cwd: root.fsPath })
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
     *
     * @param root Raíz del proyecto desde la que buscar y ejecutar el localizador.
     * @returns Ruta o nombre del ejecutable, o `undefined` si no está disponible.
     */
    private async findExecutable(root = WorkingDirectoryControl.current()): Promise<string | undefined> {
        if (!root) {
            return undefined;
        }

        const localCandidates = process.platform === 'win32'
            ? ['vendor/bin/php-cs-fixer.bat', 'vendor/bin/php-cs-fixer']
            : ['vendor/bin/php-cs-fixer'];

        for (const relativePath of localCandidates) {
            const candidate = vscode.Uri.joinPath(root, ...relativePath.split('/'));
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
                cwd: root.fsPath,
                timeout: 5000,
                windowsHide: true
            });
            return 'php-cs-fixer';
        } catch {
            return undefined;
        }
    }
}

/**
 * Muestra un mensaje informativo en una pseudoterminal que se cierra al pulsar una tecla.
 *
 * @param message Texto que se escribirá en la terminal.
 * @returns No devuelve ningún valor.
 */
function showTerminalMessage(message: string): void {
    const writeEmitter = new vscode.EventEmitter<string>();
    const terminal = vscode.window.createTerminal({
        name: 'GVHidra — PHP CS Fixer',
        pty: {
            onDidWrite: writeEmitter.event,
            open: () => writeEmitter.fire(`${message}\r\n\r\nPulsa cualquier tecla para cerrar esta terminal.\r\n`),
            close: () => writeEmitter.dispose(),
            handleInput: () => terminal.dispose()
        }
    });
    terminal.show();
}

/**
 * Comprueba si una URI corresponde a un fichero existente.
 *
 * @param uri Recurso que se desea consultar.
 * @returns `true` si existe y es un fichero; en caso contrario, `false`.
 */
async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}

/**
 * Determina si un fichero está contenido en una carpeta o coincide con ella.
 *
 * @param file URI del recurso que se desea comprobar.
 * @param folder URI de la carpeta límite.
 * @returns `true` si el recurso pertenece a la carpeta.
 */
function isInside(file: vscode.Uri, folder: vscode.Uri): boolean {
    const separator = folder.fsPath.includes('\\') ? '\\' : '/';
    const folderPath = folder.fsPath.endsWith(separator) ? folder.fsPath : `${folder.fsPath}${separator}`;
    return file.fsPath === folder.fsPath || file.fsPath.startsWith(folderPath);
}
