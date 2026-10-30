import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { WorkingDirectoryControl } from '../../common/WorkingDirectoryControl';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { escapeHtml } from '../WebviewSection';

const execFileAsync = promisify(execFile);

interface SvnCredentials {
    username: string;
    password: string;
}

/**
 * Contiene toda la interfaz y el comportamiento exclusivos de SVN.
 *
 * La clase genera los botones SVN, traduce sus mensajes en acciones y abre
 * terminales con los comandos correspondientes. VersionControlSection se
 * limita a detectar el repositorio y delega aquí cuando encuentra .svn.
 */
export class SVNHelper {
    private static readonly commandPrefix = 'version-control.svn';
    private static readonly repositoryInputId = 'svn-repository-url';
    private static readonly repositoryPlaceholder = 'https://subversion.gva.es/svn/demo_gvhidra/demo_gvhidra';
    private workingCopyRoot?: vscode.Uri;

    public static async findWorkingCopyRoot(): Promise<vscode.Uri | undefined> {
        return findSvnWorkingCopyRoot();
    }

    /** Establece la raíz exacta usada como cwd por todos los comandos SVN. */
    public setWorkingCopyRoot(root: vscode.Uri): void {
        this.workingCopyRoot = root;
    }
    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly requestRender: () => void
    ) {}

    /** Genera, en vertical, todos los controles disponibles para SVN. */
    public async render(): Promise<string> {
        const repositoryUrl = await this.getWorkingCopyUrl() ?? this.getRepositoryUrl();
        const status = repositoryUrl
            ? `SVN repository detected: ${escapeHtml(repositoryUrl)}`
            : 'SVN repository detected';

        return [
            `<p class="repository-kind">${status}</p>`,
            WebviewControls.setLabelledInput(
                'URL Repositorio',
                SVNHelper.repositoryInputId,
                repositoryUrl,
                `example: ${SVNHelper.repositoryPlaceholder}`
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.checkout`,
                'Checkout de la URL',
                SVNHelper.repositoryInputId,
                {icon: 'download' }
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.createTag`,
                'Crear tag desde URL',
                SVNHelper.repositoryInputId,
                { icon: 'tag' }
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.update`,
                'Update desde URL',
                SVNHelper.repositoryInputId,
                { variant: 'primary', icon: 'refresh' }
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.commit`,
                'Commit desde URL',
                SVNHelper.repositoryInputId,
                { variant: 'primary', icon: 'check' }
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.manageProjectCredentials`,
                'Gestionar credenciales del proyecto',
                WorkingDirectoryControl.inputId,
                {
                    variant: 'ghost',
                    icon: 'key',
                    tooltip: 'Guarda las credenciales SVN para el proyecto actual'
                }
            ),
            WebviewControls.setButton(
                `${SVNHelper.commandPrefix}.resetCredentials`,
                'Resetear credenciales globales',
                {
                    variant: 'ghost',
                    icon: 'trash',
                    tooltip: 'Borra las credenciales SVN almacenadas para todos los repositorios'
                }
            ),
            WebviewControls.setButton(
                `${SVNHelper.commandPrefix}.history`,
                'Mostrar historial del fichero activo',
                { variant: 'ghost', icon: 'history' }
            )
        ].join('');
    }

    /**
     * Despacha únicamente acciones SVN. Devuelve false para que el coordinador
     * pueda identificar mensajes desconocidos sin ejecutar ningún comando.
     */
    public async handleAction(action: string, value?: string): Promise<boolean> {
        const actions: Record<string, () => Promise<void>> = {
            checkout: () => this.checkout(value),
            update: () => this.update(value),
            commit: () => this.commit(value),
            createTag: () => this.createTag(value),
            manageProjectCredentials: () => this.manageProjectCredentials(value),
            history: () => this.showHistory(),
            resetCredentials: () => this.resetCredentials()
        };
        const handler = actions[action];
        if (!handler) {
            return false;
        }

        await handler();
        return true;
    }

    private workspaceRoot(): vscode.Uri | undefined {
        return this.workingCopyRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    private repositoryStorageKey(): string {
        return `gvhidra.svnRepository.${this.workspaceRoot()?.toString() ?? 'global'}`;
    }

    private getRepositoryUrl(): string | undefined {
        return this.context.workspaceState.get<string>(this.repositoryStorageKey());
    }

    /** Obtiene de SVN la URL asociada al directorio de trabajo común. */
    private async getWorkingCopyUrl(): Promise<string | undefined> {
        const workingDirectory = this.workspaceRoot();
        if (!workingDirectory) {
            return undefined;
        }

        try {
            const { stdout } = await execFileAsync(
                'svn',
                ['info', '--show-item', 'url', workingDirectory.fsPath],
                { cwd: workingDirectory.fsPath, timeout: 10_000, windowsHide: true }
            );
            return stdout.trim() || undefined;
        } catch {
            return undefined;
        }
    }

    /** Conserva por proyecto la URL recibida desde el input del Webview. */
    private async chooseRepository(url?: string): Promise<string | undefined> {
        const trimmedUrl = url?.trim();
        if (!trimmedUrl) {
            return undefined;
        }

        await this.context.workspaceState.update(this.repositoryStorageKey(), trimmedUrl);
        this.requestRender();
        return trimmedUrl;
    }

    /** Resuelve la URL indicada por el control y evita acciones sin referencia. */
    private async repositoryFromInput(url?: string): Promise<string | undefined> {
        const repositoryUrl = await this.chooseRepository(url);
        if (!repositoryUrl) {
            void vscode.window.showWarningMessage('Introduce primero una URL de SVN.');
        }
        return repositoryUrl;
    }

    /** Ejecuta checkout sobre el directorio raíz abierto en VS Code. */
    private async checkout(url?: string): Promise<void> {
        const repositoryUrl = await this.repositoryFromInput(url);
        if (!repositoryUrl) {
            return;
        }

        const credentials = await this.promptAndStoreProjectCredentials(
            WorkingDirectoryControl.current()?.fsPath
        );
        if (!credentials) {
            return;
        }

        await this.runTerminal(
            `svn checkout ${svnAuthenticationOptions(credentials)} ${shellQuote(repositoryUrl)} .`
        );
    }

    /** Actualiza la copia de trabajo tomando la URL como origen. */
    private async update(url?: string): Promise<void> {
        const repositoryUrl = await this.repositoryFromInput(url);
        if (repositoryUrl) {
            // `svn update` solo acepta rutas locales. `switch` es la operación
            // equivalente que actualiza una working copy desde una URL.
            const authentication = await this.authenticationOptionsForProject();
            await this.runTerminal(`svn switch ${authentication}${shellQuote(repositoryUrl)} .`);
        }
    }

    /** Hace commit en la copia de trabajo asociada a la URL indicada. */
    private async commit(url?: string): Promise<void> {
        const repositoryUrl = await this.repositoryFromInput(url);
        if (!repositoryUrl || !await this.workingCopyMatches(repositoryUrl)) {
            return;
        }

        const message = await vscode.window.showInputBox({
            title: 'SVN Commit',
            prompt: 'Enter the commit message',
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : 'The commit message is required.'
        });
        if (message === undefined) {
            return;
        }

        const authentication = await this.authenticationOptionsForProject();
        await this.runTerminal(
            `svn commit ${authentication}-m ${shellQuote(message.trim())} .`
        );
    }

    /**
     * Crea una copia remota desde la URL indicada hacia el nombre de tag indicado.
     * Ambos valores introducidos por el usuario se escapan antes de enviarlos.
     */
    private async createTag(url?: string): Promise<void> {
        const repositoryUrl = await this.repositoryFromInput(url);
        if (!repositoryUrl) {
            return;
        }

        const tagName = await vscode.window.showInputBox({
            title: 'Create SVN TAG',
            prompt: 'Enter the tag name',
            ignoreFocusOut: true,
            validateInput: value => {
                if (!value.trim()) {
                    return 'The tag name is required.';
                }
                return /[\\/]/.test(value) ? 'The tag name cannot contain slashes.' : undefined;
            }
        });
        if (tagName === undefined) {
            return;
        }

        const destination = await vscode.window.showInputBox({
            title: 'Create SVN TAG',
            prompt: 'Enter the destination URL for the tag',
            value: suggestedTagUrl(repositoryUrl, tagName.trim()),
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : 'The destination URL is required.'
        });
        if (destination === undefined) {
            return;
        }

        const comment = await vscode.window.showInputBox({
            title: 'Create SVN TAG',
            prompt: 'Enter the tag comment',
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : 'The tag comment is required.'
        });
        if (comment === undefined) {
            return;
        }

        const authentication = await this.authenticationOptionsForProject();
        await this.runTerminal(
            `svn copy ${authentication}${shellQuote(repositoryUrl)} ${shellQuote(destination.trim())} -m ${shellQuote(comment.trim())}`
        );
    }

    /** Muestra el log SVN del fichero activo. */
    private async showHistory(): Promise<void> {
        const file = await this.selectedFile();
        if (!file) {
            return;
        }

        const authentication = await this.authenticationOptionsForProject();
        await this.runTerminal(
            `svn log ${authentication}-r 1:HEAD -- ${shellQuote(file.fsPath)}`
        );
    }

    /** Solicita y guarda las credenciales SVN propias del proyecto actual. */
    private async manageProjectCredentials(workingDirectoryPath?: string): Promise<void> {
        await this.promptAndStoreProjectCredentials(workingDirectoryPath);
    }

    /**
     * Lee las credenciales del proyecto y genera las opciones comunes de SVN.
     * Sin fichero, deja el comando en modo interactivo para que la terminal las pida.
     */
    private async authenticationOptionsForProject(): Promise<string> {
        const credentialsFile = this.projectCredentialsFile(
            WorkingDirectoryControl.current()?.fsPath,
            false
        );
        if (credentialsFile) {
            try {
                const credentials = parseCredentials(await readFile(credentialsFile, 'utf8'));
                if (credentials) {
                    return `${svnAuthenticationOptions(credentials)} `;
                }
            } catch {
                // La ausencia o ilegibilidad se trata igual: SVN mantiene su prompt interactivo.
            }
        }

        void vscode.window.showWarningMessage(
            'No se han almacenado credenciales SVN para este proyecto. '
            + 'El comando las solicitará manualmente en la terminal.'
        );
        return '';
    }

    /** Comparte con Checkout y con el botón de gestión la solicitud y persistencia. */
    private async promptAndStoreProjectCredentials(
        workingDirectoryPath?: string
    ): Promise<SvnCredentials | undefined> {
        const credentialsFile = this.projectCredentialsFile(workingDirectoryPath, true);
        if (!credentialsFile) {
            return undefined;
        }

        const projectCredentialsDirectory = dirname(credentialsFile);
        try {
            await mkdir(projectCredentialsDirectory, { recursive: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(
                `No se pudo crear la carpeta de credenciales SVN: ${message}`
            );
            return undefined;
        }

        const credentials = await promptForCredentials();
        if (!credentials) {
            return undefined;
        }

        try {
            await writeFile(
                credentialsFile,
                serializeCredentials(credentials),
                { encoding: 'utf8', mode: 0o600 }
            );
            await chmod(credentialsFile, 0o600);
            void vscode.window.showWarningMessage(
                `La contraseña SVN se ha almacenado sin cifrar en ${credentialsFile}.`
            );
            return credentials;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(
                `No se pudieron guardar las credenciales SVN: ${message}`
            );
            return undefined;
        }
    }

    /** Calcula el fichero asociado al directorio común sin crear nada todavía. */
    private projectCredentialsFile(
        workingDirectoryPath: string | undefined,
        reportErrors: boolean
    ): string | undefined {
        const trimmedPath = workingDirectoryPath?.trim();
        if (!trimmedPath) {
            if (reportErrors) {
                void vscode.window.showErrorMessage(
                    'No hay un directorio de trabajo establecido para gestionar las credenciales SVN.'
                );
            }
            return undefined;
        }

        const workingDirectory = WorkingDirectoryControl.resolveOpenFolder(trimmedPath);
        if (!workingDirectory) {
            if (reportErrors) {
                void vscode.window.showErrorMessage(
                    'El directorio de trabajo no corresponde a una carpeta abierta en VS Code.'
                );
            }
            return undefined;
        }

        const projectPath = projectPathAfterHtdocs(workingDirectory.fsPath);
        if (!projectPath) {
            if (reportErrors) {
                void vscode.window.showErrorMessage(
                    'El directorio de trabajo debe estar dentro de htdocs para identificar el proyecto.'
                );
            }
            return undefined;
        }

        return join(homedir(), '.subversion', 'auth', ...projectPath, 'svn-credentials');
    }

    /**
     * Borra la caché global de autenticación de Subversion tras una confirmación
     * explícita. Se usa la API de ficheros en vez de una shell para que la ruta
     * no pueda interpretarse como parte de un comando.
     */
    private async resetCredentials(): Promise<void> {
        const authDirectory = join(homedir(), '.subversion', 'auth');
        const confirmation = await vscode.window.showWarningMessage(
            `Se borrarán todas las credenciales SVN guardadas en ${authDirectory}.`,
            { modal: true, detail: 'Esta acción afecta a todos los repositorios SVN de este usuario.' },
            'Resetear credenciales'
        );
        if (confirmation !== 'Resetear credenciales') {
            return;
        }

        try {
            await rm(authDirectory, { recursive: true, force: true });
            void vscode.window.showInformationMessage('Las credenciales SVN guardadas se han reseteado.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`No se pudieron resetear las credenciales SVN: ${message}`);
        }
    }

    private async selectedFile(): Promise<vscode.Uri | undefined> {
        const root = this.workspaceRoot();
        if (!root) {
            void vscode.window.showWarningMessage('Open a project folder first.');
            return undefined;
        }

        const activeFile = vscode.window.activeTextEditor?.document.uri;
        if (activeFile && activeFile.scheme === 'file' && isInside(activeFile, root)) {
            return activeFile;
        }

        void vscode.window.showWarningMessage('Abre un fichero del proyecto para mostrar su historial SVN.');
        return undefined;
    }

    /** Comprueba que un commit local pertenece exactamente a la URL elegida. */
    private async workingCopyMatches(repositoryUrl: string): Promise<boolean> {
        const workingCopyUrl = await this.getWorkingCopyUrl();
        if (workingCopyUrl && normalizeSvnUrl(workingCopyUrl) === normalizeSvnUrl(repositoryUrl)) {
            return true;
        }

        void vscode.window.showWarningMessage(
            workingCopyUrl
                ? `La copia de trabajo corresponde a ${workingCopyUrl}, no a ${repositoryUrl}.`
                : 'No se ha podido obtener la URL de la copia de trabajo SVN.'
        );
        return false;
    }

    /** Abre una terminal SVN, entra explícitamente en la raíz y ejecuta el comando. */
    private async runTerminal(
        command: string,
        root: vscode.Uri | undefined = this.workspaceRoot()
    ): Promise<void> {
        if (!root) {
            void vscode.window.showWarningMessage('Open a project folder first.');
            return;
        }

        const terminal = vscode.window.createTerminal({ name: 'GVHidra — SVN', cwd: root });
        terminal.show(true);
        terminal.sendText(`cd ${shellQuote(root.fsPath)} && ${command}`, true);
    }
}

/**
 * Localiza el working copy SVN asociado al fichero activo. Si no hay uno,
 * busca repositorios directamente abiertos y, como último recurso, anidados.
 */
async function findSvnWorkingCopyRoot(): Promise<vscode.Uri | undefined> {
    const activeFile = vscode.window.activeTextEditor?.document.uri;
    if (activeFile?.scheme === 'file') {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeFile);
        if (workspaceFolder) {
            const activeRoot = await findSvnAncestor(
                vscode.Uri.joinPath(activeFile, '..'),
                workspaceFolder.uri
            );
            if (activeRoot) {
                return activeRoot;
            }
        }
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (await exists(vscode.Uri.joinPath(folder.uri, '.svn'))) {
            return folder.uri;
        }
    }

    const databases = await vscode.workspace.findFiles('**/.svn/wc.db', null, 100);
    return databases.length > 0 ? vscode.Uri.joinPath(databases[0], '..', '..') : undefined;
}

async function findSvnAncestor(start: vscode.Uri, boundary: vscode.Uri): Promise<vscode.Uri | undefined> {
    let current = start;
    while (isInside(current, boundary)) {
        if (await exists(vscode.Uri.joinPath(current, '.svn'))) {
            return current;
        }
        if (current.fsPath === boundary.fsPath) {
            break;
        }
        const parent = vscode.Uri.joinPath(current, '..');
        if (parent.fsPath === current.fsPath) {
            break;
        }
        current = parent;
    }
    return undefined;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/** Protege argumentos introducidos por el usuario para shells compatibles con POSIX. */
function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/** Solicita ambas credenciales en prompts de VS Code, ocultando la contraseña. */
async function promptForCredentials(): Promise<SvnCredentials | undefined> {
    const username = await vscode.window.showInputBox({
        title: 'Credenciales SVN del proyecto',
        prompt: 'Usuario SVN',
        ignoreFocusOut: true,
        validateInput: value => value.trim() ? undefined : 'El usuario SVN es obligatorio.'
    });
    if (username === undefined) {
        return undefined;
    }

    const password = await vscode.window.showInputBox({
        title: 'Credenciales SVN del proyecto',
        prompt: 'Contraseña SVN',
        password: true,
        ignoreFocusOut: true,
        validateInput: value => value.length > 0 ? undefined : 'La contraseña SVN es obligatoria.'
    });
    return password === undefined ? undefined : { username: username.trim(), password };
}

function serializeCredentials(credentials: SvnCredentials): string {
    return `username=${credentials.username}\npassword=${credentials.password}\n`;
}

/** Lee el formato de texto simple conservando los signos igual del valor. */
function parseCredentials(content: string): SvnCredentials | undefined {
    const values = new Map<string, string>();
    for (const line of content.split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator > 0) {
            values.set(line.slice(0, separator), line.slice(separator + 1));
        }
    }

    const username = values.get('username')?.trim();
    const password = values.get('password');
    return username && password ? { username, password } : undefined;
}

/** Opciones compartidas que evitan un segundo prompt y la caché global de SVN. */
function svnAuthenticationOptions(credentials: SvnCredentials): string {
    return [
        '--non-interactive',
        '--no-auth-cache',
        '--username',
        shellQuote(credentials.username),
        '--password',
        shellQuote(credentials.password)
    ].join(' ');
}

/** Ignora únicamente la barra final al comparar dos URLs SVN. */
function normalizeSvnUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

/** Devuelve todos los segmentos situados a la derecha del último htdocs. */
function projectPathAfterHtdocs(path: string): string[] | undefined {
    const segments = path.split(/[\\/]+/).filter(Boolean);
    const htdocsIndex = segments.map(segment => segment.toLowerCase()).lastIndexOf('htdocs');
    const projectPath = htdocsIndex >= 0 ? segments.slice(htdocsIndex + 1) : [];
    return projectPath.length > 0 ? projectPath : undefined;
}

/**
 * Propone la ubicación convencional de tags y permite que el usuario la
 * corrija antes de ejecutar el copy remoto.
 */
function suggestedTagUrl(sourceUrl: string, tagName: string): string {
    const source = normalizeSvnUrl(sourceUrl);
    const conventionalBase = source.match(/^(.*)\/trunk(?:\/.*)?$/)?.[1]
        ?? source.match(/^(.*)\/branches\/[^/]+(?:\/.*)?$/)?.[1];
    if (conventionalBase) {
        return `${conventionalBase}/tags/${tagName}`;
    }

    const lastSeparator = source.lastIndexOf('/');
    return lastSeparator >= 0
        ? `${source.slice(0, lastSeparator)}/tags/${tagName}`
        : `${source}/tags/${tagName}`;
}

function isInside(file: vscode.Uri, folder: vscode.Uri): boolean {
    const separator = folder.fsPath.includes('\\') ? '\\' : '/';
    const folderPath = folder.fsPath.endsWith(separator) ? folder.fsPath : `${folder.fsPath}${separator}`;
    return file.fsPath === folder.fsPath || file.fsPath.startsWith(folderPath);
}
