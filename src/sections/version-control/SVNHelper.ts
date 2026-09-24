import * as vscode from 'vscode';
import { actionButton, escapeHtml } from '../WebviewSection';

interface FilePick extends vscode.QuickPickItem {
    readonly relativePath: string;
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
            actionButton('Choose Repository', `${SVNHelper.commandPrefix}.chooseRepository`),
            actionButton('Checkout', `${SVNHelper.commandPrefix}.checkout`),
            actionButton('Update', `${SVNHelper.commandPrefix}.update`),
            actionButton('Commit', `${SVNHelper.commandPrefix}.commit`),
            actionButton('Create TAG', `${SVNHelper.commandPrefix}.createTag`),
            actionButton('Show History', `${SVNHelper.commandPrefix}.history`)
        ].join('');
    }

    /**
     * Despacha únicamente acciones SVN. Devuelve false para que el coordinador
     * pueda identificar mensajes desconocidos sin ejecutar ningún comando.
     */
    public async handleAction(action: string): Promise<boolean> {
        const actions: Record<string, () => Promise<void>> = {
            chooseRepository: () => this.chooseRepository().then(() => undefined),
            checkout: () => this.checkout(),
            update: () => this.runTerminal('svn update'),
            commit: () => this.commit(),
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

    private workspaceRoot(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    private repositoryStorageKey(): string {
        return `gvhidra.svnRepository.${this.workspaceRoot()?.uri.toString() ?? 'global'}`;
    }

    private getRepositoryUrl(): string | undefined {
        return this.context.workspaceState.get<string>(this.repositoryStorageKey());
    }

    /** Solicita y conserva por proyecto la URL empleada por el checkout SVN. */
    private async chooseRepository(): Promise<string | undefined> {
        const url = await vscode.window.showInputBox({
            title: 'Choose SVN Repository',
            prompt: 'Enter the SVN repository URL',
            value: this.getRepositoryUrl(),
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : 'The repository URL is required.'
        });
        if (url === undefined) {
            return undefined;
        }

        const trimmedUrl = url.trim();
        await this.context.workspaceState.update(this.repositoryStorageKey(), trimmedUrl);
        this.requestRender();
        return trimmedUrl;
    }

    /** Ejecuta checkout sobre el directorio raíz abierto en VS Code. */
    private async checkout(): Promise<void> {
        const repositoryUrl = this.getRepositoryUrl() ?? await this.chooseRepository();
        if (repositoryUrl) {
            await this.runTerminal(`svn checkout ${shellQuote(repositoryUrl)} .`);
        }
    }

    /** Solicita mensaje y ficheros antes de ejecutar svn commit. */
    private async commit(): Promise<void> {
        const message = await vscode.window.showInputBox({
            title: 'SVN Commit',
            prompt: 'Enter the commit message',
            ignoreFocusOut: true,
            validateInput: value => value.trim() ? undefined : 'The commit message is required.'
        });
        if (message === undefined) {
            return;
        }

        const files = await this.chooseProjectFiles('Choose files for the SVN commit');
        if (!files?.length) {
            return;
        }

        const paths = files.map(shellQuote).join(' ');
        await this.runTerminal(`svn commit -m ${shellQuote(message.trim())} -- ${paths}`);
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

        const relativePath = vscode.workspace.asRelativePath(file, false);
        await this.runTerminal(`svn log -- ${shellQuote(relativePath)}`);
    }

    private async selectedFile(): Promise<vscode.Uri | undefined> {
        const root = this.workspaceRoot();
        if (!root) {
            void vscode.window.showWarningMessage('Open a project folder first.');
            return undefined;
        }

        const activeFile = vscode.window.activeTextEditor?.document.uri;
        if (activeFile && activeFile.scheme === 'file' && isInside(activeFile, root.uri)) {
            return activeFile;
        }

        const selected = await vscode.window.showOpenDialog({
            title: 'Choose a file to show its history',
            defaultUri: root.uri,
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false
        });
        return selected?.[0];
    }

    private async chooseProjectFiles(placeHolder: string): Promise<string[] | undefined> {
        const root = this.workspaceRoot();
        if (!root) {
            void vscode.window.showWarningMessage('Open a project folder first.');
            return undefined;
        }

        const uris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root, '**/*'),
            new vscode.RelativePattern(root, '{.git,.svn,node_modules,out}/**'),
            5000
        );
        const items: FilePick[] = uris.map(uri => {
            const relativePath = vscode.workspace.asRelativePath(uri, false);
            return { label: relativePath, relativePath };
        }).sort((left, right) => left.label.localeCompare(right.label));

        const selected = await vscode.window.showQuickPick(items, {
            title: placeHolder,
            placeHolder,
            canPickMany: true,
            ignoreFocusOut: true
        });
        return selected?.map(item => item.relativePath);
    }

    /** Abre una terminal SVN situada en la raíz y ejecuta el comando recibido. */
    private async runTerminal(command: string): Promise<void> {
        const root = this.workspaceRoot();
        if (!root) {
            void vscode.window.showWarningMessage('Open a project folder first.');
            return;
        }

        const terminal = vscode.window.createTerminal({ name: 'GVHidra — SVN', cwd: root.uri });
        terminal.show(true);
        terminal.sendText(command, true);
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
