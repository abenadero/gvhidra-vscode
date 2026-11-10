import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { WorkingDirectoryControl } from '../../common/WorkingDirectoryControl';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { escapeHtml } from '../WebviewSection';
import { createProjectDirectory, discardEmptyProjectDirectory, runProjectCheckout } from './ProjectCheckout';

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

    /**
     * Localiza la working copy que contiene el fichero activo.
     *
     * @returns URI de la raíz SVN activa o `undefined` si no existe.
     */
    public static async findActiveWorkingCopyRoot(): Promise<vscode.Uri | undefined> {
        return findActiveSvnWorkingCopyRoot();
    }

    /**
     * Localiza una working copy anidada solamente cuando el resultado es único.
     *
     * @returns URI de la única raíz SVN encontrada o `undefined` si hay cero o varias.
     */
    public static async findUniqueNestedWorkingCopyRoot(): Promise<vscode.Uri | undefined> {
        return findUniqueNestedSvnWorkingCopyRoot();
    }

    /**
     * Establece la raíz exacta usada como directorio de trabajo por los comandos SVN.
     *
     * @param root URI raíz de la working copy.
     * @returns No devuelve ningún valor.
     */
    public setWorkingCopyRoot(root: vscode.Uri): void {
        this.workingCopyRoot = root;
    }

    /**
     * Crea el helper con acceso al estado persistente y al refresco del Webview.
     *
     * @param context Contexto de la extensión usado para persistir la URL del repositorio.
     * @param requestRender Callback que solicita un nuevo renderizado.
     */
    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly requestRender: () => void
    ) {}

    /**
     * Genera todos los controles disponibles para SVN.
     *
     * @returns Marcado HTML de los controles y el estado del repositorio.
     */
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
            ),
            WebviewControls.setButton(
                `${SVNHelper.commandPrefix}.sourceControl`,
                'Abrir Source Control',
                { variant: 'ghost', icon: 'source-control', tooltip: 'Abre la vista Source Control de VS Code' }
            )
        ].join('');
    }

    /**
     * Despacha únicamente acciones SVN. Devuelve false para que el coordinador
     * pueda identificar mensajes desconocidos sin ejecutar ningún comando.
     *
     * @param action Nombre local de la acción SVN.
     * @param value Valor opcional enviado por el control asociado.
     * @returns `true` si la acción fue reconocida; en caso contrario, `false`.
     */
    public async handleAction(action: string, value?: string): Promise<boolean> {
        const actions: Record<string, () => Promise<void>> = {
            checkout: () => this.checkout(value),
            update: () => this.update(value),
            commit: () => this.commit(value),
            createTag: () => this.createTag(value),
            manageProjectCredentials: () => this.manageProjectCredentials(value),
            history: () => this.showHistory(),
            resetCredentials: () => this.resetCredentials(),
            sourceControl: async () => { await vscode.commands.executeCommand('workbench.view.scm'); }
        };
        const handler = actions[action];
        if (!handler) {
            return false;
        }

        await handler();
        return true;
    }

    /**
     * Obtiene la raíz SVN seleccionada o la primera carpeta abierta como fallback.
     *
     * @returns URI usada como directorio de trabajo o `undefined` si no hay ninguna.
     */
    private workspaceRoot(): vscode.Uri | undefined {
        return this.workingCopyRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    /**
     * Construye la clave que separa la URL persistida por cada workspace.
     *
     * @returns Clave de almacenamiento correspondiente a la raíz actual.
     */
    private repositoryStorageKey(): string {
        return `gvhidra.svnRepository.${this.workspaceRoot()?.toString() ?? 'global'}`;
    }

    /**
     * Recupera la última URL SVN elegida para el workspace actual.
     *
     * @returns URL almacenada o `undefined` si todavía no se ha elegido ninguna.
     */
    private getRepositoryUrl(): string | undefined {
        return this.context.workspaceState.get<string>(this.repositoryStorageKey());
    }

    /**
     * Obtiene mediante `svn info` la URL asociada al directorio de trabajo.
     *
     * @returns URL de la working copy o `undefined` si no puede consultarse.
     */
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

    /**
     * Valida y conserva por proyecto la URL recibida desde el input del Webview.
     *
     * @param url URL opcional introducida por el usuario.
     * @returns URL sin espacios exteriores o `undefined` cuando está vacía.
     */
    private async chooseRepository(url?: string): Promise<string | undefined> {
        const trimmedUrl = url?.trim();
        if (!trimmedUrl) {
            return undefined;
        }

        await this.context.workspaceState.update(this.repositoryStorageKey(), trimmedUrl);
        this.requestRender();
        return trimmedUrl;
    }

    /**
     * Resuelve la URL indicada por el control y avisa cuando falta una referencia.
     *
     * @param url URL opcional introducida por el usuario.
     * @returns URL normalizada o `undefined` si no se proporcionó una.
     */
    private async repositoryFromInput(url?: string): Promise<string | undefined> {
        const repositoryUrl = await this.chooseRepository(url);
        if (!repositoryUrl) {
            void vscode.window.showWarningMessage('Introduce primero una URL de SVN.');
        }
        return repositoryUrl;
    }

    /**
     * Descarga la URL en un proyecto nuevo de htdocs y lo abre al finalizar.
     *
     * @param url URL del repositorio que se desea descargar.
     * @returns Promesa que finaliza tras la descarga y apertura, o al cancelar.
     */
    private async checkout(url?: string): Promise<void> {
        const repositoryUrl = await this.repositoryFromInput(url);
        if (!repositoryUrl) {
            return;
        }

        const destination = await createProjectDirectory('Checkout desde URL');
        if (!destination) {
            return;
        }
        // El proyecto nuevo todavía no está abierto en el workspace.
        const credentials = await this.promptAndStoreCredentials(
            join(homedir(), '.subversion', 'auth', basename(destination.fsPath), 'svn-credentials')
        );
        if (!credentials) {
            await discardEmptyProjectDirectory(destination);
            return;
        }

        await runProjectCheckout(
            'svn',
            ['checkout', '--non-interactive', '--no-auth-cache',
                '--username', credentials.username, '--password', credentials.password,
                '--', repositoryUrl, destination.fsPath],
            destination,
            'Checkout del proyecto'
        );
    }

    /**
     * Actualiza la copia de trabajo tomando la URL como origen mediante `svn switch`.
     *
     * @param url URL de repositorio que debe usar la working copy.
     * @returns Promesa que finaliza tras abrir la terminal o descartar la acción.
     */
    private async update(url?: string): Promise<void> {
        const repositoryUrl = await this.repositoryFromInput(url);
        if (repositoryUrl) {
            // `svn update` solo acepta rutas locales. `switch` es la operación
            // equivalente que actualiza una working copy desde una URL.
            const authentication = await this.authenticationOptionsForProject();
            await this.runTerminal(`svn switch ${authentication}${shellQuote(repositoryUrl)} .`);
        }
    }

    /**
     * Hace commit en la copia de trabajo asociada exactamente a la URL indicada.
     *
     * @param url URL contra la que se valida la working copy.
     * @returns Promesa que finaliza tras abrir la terminal o cancelar el commit.
     */
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
     *
     * @param url URL de origen que se copiará al nuevo tag.
     * @returns Promesa que finaliza tras abrir la terminal o cancelar el asistente.
     */
    private async createTag(url?: string): Promise<void> {
        const repositoryUrl = await this.repositoryFromInput(url);
        if (!repositoryUrl) {
            return;
        }

        const tagName = await vscode.window.showInputBox({
            title: 'Create SVN TAG',
            prompt: 'Enter the tag name',
            placeHolder: await this.getLatestTagName(repositoryUrl),
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

    /** Consulta la creación de los tags existentes, sin confundirla con modificaciones posteriores. */
    private async getLatestTagName(sourceUrl: string): Promise<string | undefined> {
        try {
            const credentials = await this.readProjectCredentials();
            const authentication = credentials
                ? ['--username', credentials.username, '--password', credentials.password]
                : [];
            const readSvn = (args: string[], url: string) => execFileAsync('svn', [
                ...args, '--non-interactive', '--no-auth-cache', ...authentication, '--', url
            ], { cwd: this.workspaceRoot()?.fsPath, timeout: 10_000, windowsHide: true });
            const tagsUrl = suggestedTagUrl(sourceUrl, '');
            const { stdout } = await readSvn(['list', '--xml'], tagsUrl);
            const tags = [...stdout.matchAll(/<entry\b[^>]*\bkind="dir"[^>]*>([\s\S]*?)<\/entry>/g)]
                .map(([, entry]) => ({
                    name: decodeXml(entry.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? ''),
                    changedRevision: Number(entry.match(/<commit\b[^>]*\brevision="(\d+)"/)?.[1] ?? 0)
                }))
                .filter(tag => tag.name)
                .sort((left, right) => right.changedRevision - left.changedRevision);

            let latestTag: string | undefined;
            let latestRevision = 0;
            for (const tag of tags) {
                // La creación nunca puede ser posterior a la última modificación.
                if (tag.changedRevision <= latestRevision) {
                    break;
                }
                const { stdout: log } = await readSvn(
                    ['log', '--xml', '--stop-on-copy', '--limit', '1', '-r', '0:HEAD'],
                    `${tagsUrl}${encodeURIComponent(tag.name)}@`
                );
                const revision = Number(log.match(/<logentry\b[^>]*\brevision="(\d+)"/)?.[1] ?? 0);
                if (revision > latestRevision) {
                    latestRevision = revision;
                    latestTag = tag.name;
                }
            }
            return latestTag;
        } catch {
            // El placeholder es opcional: una consulta fallida no impide crear un tag.
            return undefined;
        }
    }

    /**
     * Muestra el log SVN del fichero activo en una terminal.
     *
     * @returns Promesa que finaliza tras abrir la terminal o descartar la acción.
     */
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

    /**
     * Solicita y guarda las credenciales SVN propias del proyecto actual.
     *
     * @param workingDirectoryPath Ruta de la carpeta abierta que identifica el proyecto.
     * @returns Promesa que finaliza después del proceso de captura y almacenamiento.
     */
    private async manageProjectCredentials(workingDirectoryPath?: string): Promise<void> {
        await this.promptAndStoreProjectCredentials(workingDirectoryPath);
    }

    /**
     * Lee las credenciales del proyecto y genera las opciones comunes de SVN.
     * Sin fichero, deja el comando en modo interactivo para que la terminal las pida.
     *
     * @returns Opciones de autenticación escapadas, o una cadena vacía para el modo interactivo.
     */
    private async authenticationOptionsForProject(): Promise<string> {
        const credentials = await this.readProjectCredentials();
        if (credentials) {
            return `${svnAuthenticationOptions(credentials)} `;
        }

        void vscode.window.showWarningMessage(
            'No se han almacenado credenciales SVN para este proyecto. '
            + 'El comando las solicitará manualmente en la terminal.'
        );
        return '';
    }

    /** Lee las credenciales también para consultas opcionales que no deben mostrar avisos. */
    private async readProjectCredentials(): Promise<SvnCredentials | undefined> {
        const credentialsFile = this.projectCredentialsFile(
            WorkingDirectoryControl.current()?.fsPath,
            false
        );
        if (credentialsFile) {
            try {
                return parseCredentials(await readFile(credentialsFile, 'utf8'));
            } catch {
                // La ausencia o ilegibilidad se trata igual: SVN mantiene su prompt interactivo.
            }
        }
        return undefined;
    }

    /**
     * Solicita y persiste las credenciales que comparten checkout y gestión manual.
     *
     * @param workingDirectoryPath Ruta de la carpeta que identifica el proyecto.
     * @returns Credenciales guardadas o `undefined` si la operación falla o se cancela.
     */
    private async promptAndStoreProjectCredentials(
        workingDirectoryPath?: string
    ): Promise<SvnCredentials | undefined> {
        const credentialsFile = this.projectCredentialsFile(workingDirectoryPath, true);
        if (!credentialsFile) {
            return undefined;
        }

        return this.promptAndStoreCredentials(credentialsFile);
    }

    /** Comparte el guardado entre proyectos abiertos y el nuevo destino del checkout. */
    private async promptAndStoreCredentials(credentialsFile: string): Promise<SvnCredentials | undefined> {
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

    /**
     * Calcula el fichero de credenciales asociado al proyecto sin crearlo.
     *
     * @param workingDirectoryPath Ruta de una carpeta abierta bajo `htdocs`.
     * @param reportErrors Indica si deben mostrarse errores de validación al usuario.
     * @returns Ruta del fichero de credenciales o `undefined` si no puede derivarse.
     */
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
     *
     * @returns Promesa que finaliza después de borrar o cancelar la operación.
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

    /**
     * Obtiene el fichero activo únicamente si pertenece a la raíz SVN seleccionada.
     *
     * @returns URI del fichero válido o `undefined` si no existe una selección utilizable.
     */
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

    /**
     * Comprueba que la working copy local pertenece exactamente a la URL elegida.
     *
     * @param repositoryUrl URL con la que se compara la información local.
     * @returns `true` si ambas URLs coinciden; en caso contrario, `false`.
     */
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

    /**
     * Abre una terminal SVN, entra explícitamente en la raíz y ejecuta el comando.
     *
     * @param command Comando SVN completo que se enviará a la terminal.
     * @param root Directorio de trabajo; por defecto usa la raíz SVN seleccionada.
     * @returns Promesa que finaliza después de enviar el comando o avisar de que falta la raíz.
     */
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
 * Localiza la working copy SVN asociada al fichero activo sin atravesar el
 * límite de su carpeta de workspace.
 *
 * @returns URI de la raíz SVN activa o `undefined` si no se encuentra.
 */
async function findActiveSvnWorkingCopyRoot(): Promise<vscode.Uri | undefined> {
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
    return undefined;
}

/**
 * Usa una working copy anidada como fallback sólo cuando es inequívoca. Dos
 * resultados bastan para saber que no se debe escoger una de forma arbitraria.
 *
 * @returns URI de la única working copy anidada o `undefined`.
 */
async function findUniqueNestedSvnWorkingCopyRoot(): Promise<vscode.Uri | undefined> {
    const databases = await vscode.workspace.findFiles('**/.svn/wc.db', null, 2);
    return databases.length === 1
        ? vscode.Uri.joinPath(databases[0], '..', '..')
        : undefined;
}

/**
 * Recorre los ancestros de una ruta en busca de un marcador `.svn` sin superar un límite.
 *
 * @param start URI desde la que comienza el recorrido ascendente.
 * @param boundary Carpeta límite incluida en la búsqueda.
 * @returns URI del primer ancestro SVN o `undefined` si no existe.
 */
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

/**
 * Comprueba si una URI existe en el sistema de archivos del workspace.
 *
 * @param uri Recurso que se desea consultar.
 * @returns `true` si el recurso existe; en caso contrario, `false`.
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
 * Protege un argumento para su uso literal en shells compatibles con POSIX.
 *
 * @param value Valor que se desea escapar.
 * @returns Valor entre comillas simples con las comillas internas protegidas.
 */
function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Solicita usuario y contraseña en prompts de VS Code, ocultando la contraseña.
 *
 * @returns Credenciales introducidas o `undefined` si el usuario cancela.
 */
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

/**
 * Serializa unas credenciales en el formato de texto simple usado por la extensión.
 *
 * @param credentials Usuario y contraseña que se desean guardar.
 * @returns Contenido del fichero de credenciales.
 */
function serializeCredentials(credentials: SvnCredentials): string {
    return `username=${credentials.username}\npassword=${credentials.password}\n`;
}

/**
 * Lee el formato de credenciales de texto simple conservando los signos igual del valor.
 *
 * @param content Contenido completo del fichero de credenciales.
 * @returns Credenciales válidas o `undefined` si falta algún campo obligatorio.
 */
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

/**
 * Genera las opciones que evitan un segundo prompt y la caché global de SVN.
 *
 * @param credentials Credenciales que se pasarán al comando.
 * @returns Fragmento de argumentos de autenticación con valores escapados.
 */
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

/**
 * Normaliza una URL SVN ignorando espacios exteriores y barras finales.
 *
 * @param url URL que se desea normalizar.
 * @returns URL preparada para comparaciones.
 */
function normalizeSvnUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

/** Decodifica nombres de tags recibidos en la salida XML de SVN. */
function decodeXml(value: string): string {
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) =>
        entity.startsWith('#')
            ? String.fromCodePoint(entity[1].toLowerCase() === 'x'
                ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
            : entities[entity]
    );
}

/**
 * Obtiene todos los segmentos situados a la derecha del último `htdocs`.
 *
 * @param path Ruta de sistema de archivos que se desea analizar.
 * @returns Segmentos que identifican el proyecto o `undefined` si no existen.
 */
function projectPathAfterHtdocs(path: string): string[] | undefined {
    const segments = path.split(/[\\/]+/).filter(Boolean);
    const htdocsIndex = segments.map(segment => segment.toLowerCase()).lastIndexOf('htdocs');
    const projectPath = htdocsIndex >= 0 ? segments.slice(htdocsIndex + 1) : [];
    return projectPath.length > 0 ? projectPath : undefined;
}

/**
 * Propone la ubicación convencional de tags y permite que el usuario la
 * corrija antes de ejecutar el copy remoto.
 *
 * @param sourceUrl URL SVN que se usará como origen.
 * @param tagName Nombre del tag que se desea crear.
 * @returns URL de destino sugerida bajo el directorio `tags`.
 */
function suggestedTagUrl(sourceUrl: string, tagName: string): string {
    const source = normalizeSvnUrl(sourceUrl);
    const conventionalBase = source.match(/^(.*)\/trunk(?:\/.*)?$/)?.[1]
        ?? source.match(/^(.*)\/(?:branches|tags)\/[^/]+(?:\/.*)?$/)?.[1];
    if (conventionalBase) {
        return `${conventionalBase}/tags/${tagName}`;
    }

    const lastSeparator = source.lastIndexOf('/');
    return lastSeparator >= 0
        ? `${source.slice(0, lastSeparator)}/tags/${tagName}`
        : `${source}/tags/${tagName}`;
}

/**
 * Determina si un recurso está contenido en una carpeta o coincide con ella.
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
