import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { escapeHtml } from '../WebviewSection';

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
    private static readonly workingCopyInputId = 'svn-working-copy';
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
    public render(): string {
        const repositoryUrl = this.getRepositoryUrl();
        const status = repositoryUrl
            ? `SVN repository detected: ${escapeHtml(repositoryUrl)}`
            : 'SVN repository detected';

        return [
            `<p class="repository-kind">${status}</p>`,
            WebviewControls.setLabelledInput(
                'Working Copy',
                SVNHelper.workingCopyInputId,
                this.workspaceRoot()?.fsPath ?? '',
                '',
                true
            ),
            WebviewControls.setLabelledInput(
                'Repository URL',
                SVNHelper.repositoryInputId,
                repositoryUrl,
                `example: ${SVNHelper.repositoryPlaceholder}`
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.checkout`,
                'Checkout',
                SVNHelper.repositoryInputId
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.update`,
                'Update Repository',
                SVNHelper.workingCopyInputId
            ),
            WebviewControls.setButtonWithInput(
                `${SVNHelper.commandPrefix}.commit`,
                'Commit Repository',
                SVNHelper.workingCopyInputId
            ),
            WebviewControls.setButton(`${SVNHelper.commandPrefix}.createTag`, 'Create TAG'),
            WebviewControls.setButton(`${SVNHelper.commandPrefix}.history`, 'Show History for file selected')
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
            createTag: () => this.createTag(),
            history: () => this.showHistory()
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

    /** Ejecuta checkout sobre el directorio raíz abierto en VS Code. */
    private async checkout(url?: string): Promise<void> {
        const repositoryUrl = await this.chooseRepository(url) ?? this.getRepositoryUrl();
        if (repositoryUrl) {
            await this.runTerminal(`svn checkout ${shellQuote(repositoryUrl)} .`);
        }
    }

    /** Ejecuta update sobre la Working Copy mostrada en el Webview. */
    private async update(workingCopyPath?: string): Promise<void> {
        const root = await this.workingCopyFromInput(workingCopyPath);
        if (root) {
            await this.runTerminal('svn update', root);
        }
    }

    /** Solicita el mensaje y ejecuta el commit sobre la Working Copy mostrada. */
    private async commit(workingCopyPath?: string): Promise<void> {
        const root = await this.workingCopyFromInput(workingCopyPath);
        if (!root) {
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

        await this.runTerminal(`svn commit -m ${shellQuote(message.trim())}`, root);
    }

    /**
     * Crea una copia remota desde ^/crc/trunk hacia el nombre de tag indicado.
     * Ambos valores introducidos por el usuario se escapan antes de enviarlos.
     */
    private async createTag(): Promise<void> {
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

        const comment = await vscode.window.showInputBox({
            title: 'Create SVN TAG',
            prompt: 'Enter the tag comment',
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : 'The tag comment is required.'
        });
        if (comment === undefined) {
            return;
        }

        const destination = `^/crc/tags/${tagName.trim()}`;
        await this.runTerminal(
            `svn copy ${shellQuote('^/crc/trunk')} ${shellQuote(destination)} -m ${shellQuote(comment.trim())}`
        );
    }

    /** Muestra el log SVN del editor activo o de un fichero elegido. */
    private async showHistory(): Promise<void> {
        const file = await this.selectedFile();
        if (!file) {
            return;
        }

        const relativePath = file.fsPath;
        await this.runTerminal(`svn log -- ${shellQuote(relativePath)}`);
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

        const selected = await vscode.window.showOpenDialog({
            title: 'Choose a file to show its history',
            defaultUri: root,
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false
        });
        return selected?.[0];
    }

    /** Valida y devuelve la misma Working Copy mostrada en el Webview. */
    private async workingCopyFromInput(path?: string): Promise<vscode.Uri | undefined> {
        const trimmedPath = path?.trim();
        if (!trimmedPath) {
            void vscode.window.showWarningMessage('No SVN working copy has been selected.');
            return undefined;
        }

        const root = vscode.Uri.file(trimmedPath);
        if (!await exists(vscode.Uri.joinPath(root, '.svn'))) {
            void vscode.window.showWarningMessage(`The path is not an SVN working copy: ${trimmedPath}`);
            return undefined;
        }

        this.workingCopyRoot = root;
        return root;
    }

    /** Abre una terminal SVN situada en la raíz y ejecuta el comando recibido. */
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
        terminal.sendText(command, true);
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

function isInside(file: vscode.Uri, folder: vscode.Uri): boolean {
    const separator = folder.fsPath.includes('\\') ? '\\' : '/';
    const folderPath = folder.fsPath.endsWith(separator) ? folder.fsPath : `${folder.fsPath}${separator}`;
    return file.fsPath === folder.fsPath || file.fsPath.startsWith(folderPath);
}
