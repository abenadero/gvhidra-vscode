import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { escapeHtml } from '../WebviewSection';
import { createProjectDirectory, runProjectCheckout } from './ProjectCheckout';

const execFileAsync = promisify(execFile);

interface RepositorySelection {
    url: string;
    root: vscode.Uri;
}

/** Presentación y operaciones Git sobre la URL elegida para cada proyecto. */
export class GITHelper {
    private static readonly commandPrefix = 'version-control.git';
    private static readonly repositoryInputId = 'git-repository-url';
    private repositoryRoot?: vscode.Uri;

    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly requestRender: () => void
    ) {}

    /** Conserva la raíz exacta detectada, también en workspaces multirraíz. */
    public setRepositoryRoot(root: vscode.Uri): void {
        this.repositoryRoot = root;
    }

    /** La URL elegida prevalece sobre origin, que solo proporciona el valor inicial. */
    public async render(): Promise<string> {
        const root = this.repositoryRoot;
        const repositoryUrl = this.context.workspaceState.get<string>(this.repositoryStorageKey(root))
            ?? (root ? await this.readGit(root, ['remote', 'get-url', 'origin']) : undefined);

        return [
            `<p class="repository-kind">Git repository detected${repositoryUrl ? `: ${escapeHtml(repositoryUrl)}` : ''}</p>`,
            WebviewControls.setLabelledInput(
                'URL Repositorio',
                GITHelper.repositoryInputId,
                repositoryUrl,
                'https://gitlab.example.com/grupo/proyecto.git'
            ),
            WebviewControls.setButtonWithInput(
                `${GITHelper.commandPrefix}.clone`,
                'Clonar desde URL',
                GITHelper.repositoryInputId,
                { icon: 'download' }
            ),
            WebviewControls.setButtonWithInput(
                `${GITHelper.commandPrefix}.createTag`,
                'Crear tag desde URL',
                GITHelper.repositoryInputId,
                { icon: 'tag' }
            ),
            WebviewControls.setButtonWithInput(
                `${GITHelper.commandPrefix}.update`,
                'Update desde URL',
                GITHelper.repositoryInputId,
                { variant: 'primary', icon: 'refresh', tooltip: 'Actualiza la rama actual desde la URL indicada (fast-forward)' }
            ),
            WebviewControls.setButtonWithInput(
                `${GITHelper.commandPrefix}.switchBranch`,
                'Cambiar rama',
                GITHelper.repositoryInputId,
                { variant: 'primary', icon: 'source-control' }
            ),
            WebviewControls.setButtonWithInput(
                `${GITHelper.commandPrefix}.pipelines`,
                'Ir a pipeline del proyecto',
                GITHelper.repositoryInputId,
                { variant: 'ghost', icon: 'external-link' }
            ),
            WebviewControls.setButton(
                `${GITHelper.commandPrefix}.sourceControl`,
                'Abrir Source Control',
                { variant: 'ghost', icon: 'source-control', tooltip: 'Abre la vista Source Control de VS Code' }
            )
        ].join('');
    }

    public async handleAction(action: string, value?: string): Promise<boolean> {
        switch (action) {
            case 'clone': await this.clone(value); break;
            case 'update': await this.update(value); break;
            case 'createTag': await this.createTag(value); break;
            case 'switchBranch': await this.switchBranch(value); break;
            case 'pipelines': await this.openPipelines(value); break;
            case 'sourceControl': await vscode.commands.executeCommand('workbench.view.scm'); break;
            default: return false;
        }
        return true;
    }

    private repositoryStorageKey(root?: vscode.Uri): string {
        return `gvhidra.gitRepository.${root?.toString() ?? 'global'}`;
    }

    /** Captura el proyecto antes de abrir prompts o solicitar un nuevo renderizado. */
    private async repositoryFromInput(value?: string): Promise<RepositorySelection | undefined> {
        const root = this.repositoryRoot;
        if (!root) {
            void vscode.window.showWarningMessage('Abre primero una carpeta de proyecto Git.');
            return undefined;
        }
        const url = value?.trim();
        if (!url || /[\0\r\n]/.test(url)) {
            void vscode.window.showWarningMessage('Introduce primero una URL de Git válida.');
            return undefined;
        }

        await this.context.workspaceState.update(this.repositoryStorageKey(root), url);
        this.requestRender();
        return { url, root };
    }

    /** Descarga la URL en el nuevo proyecto de htdocs y lo abre cuando termina. */
    private async clone(value?: string): Promise<void> {
        const repository = await this.repositoryFromInput(value);
        if (!repository) {
            return;
        }
        const destination = await createProjectDirectory('Clonar desde URL');
        if (destination) {
            await runProjectCheckout(
                'git', ['clone', '--', repository.url, destination.fsPath], destination, 'Clonar proyecto'
            );
        }
    }

    /** Actualiza la rama actual desde esa misma rama en la URL, sin crear merges. */
    private async update(value?: string): Promise<void> {
        const repository = await this.repositoryFromInput(value);
        if (!repository) {
            return;
        }
        const branchRef = await this.readGit(repository.root, ['symbolic-ref', '--quiet', 'HEAD']);
        if (!branchRef?.startsWith('refs/heads/')) {
            void vscode.window.showWarningMessage('Selecciona una rama antes de actualizar el repositorio Git.');
            return;
        }
        this.runTerminal(
            `git pull --ff-only -- ${shellQuote(repository.url)} ${shellQuote(branchRef)}`,
            repository.root
        );
    }

    /** Crea y publica únicamente el nuevo tag sobre la referencia de la URL elegida. */
    private async createTag(value?: string): Promise<void> {
        const repository = await this.repositoryFromInput(value);
        if (!repository) {
            return;
        }
        const tag = await this.promptRefName('Crear tag desde URL', 'Nombre del tag', 'tags');
        if (!tag) {
            return;
        }
        const source = await vscode.window.showInputBox({
            title: 'Crear tag desde URL',
            prompt: 'Rama o tag de origen en la URL (HEAD para la rama predeterminada)',
            value: 'HEAD',
            ignoreFocusOut: true,
            validateInput: input => this.validateRefName(input, 'heads', true)
        });
        if (source === undefined || await this.validateRefName(source, 'heads', true)) {
            return;
        }
        const message = await vscode.window.showInputBox({
            title: 'Crear tag desde URL',
            prompt: 'Comentario del tag que se publicará en la URL indicada',
            value: tag,
            ignoreFocusOut: true,
            validateInput: input => input.trim() ? undefined : 'Introduce un comentario para el tag.'
        });
        if (!message?.trim()) {
            return;
        }

        const tagRef = `refs/tags/${tag}`;
        this.runTerminal([
            `git fetch --no-tags -- ${shellQuote(repository.url)} ${shellQuote(source.trim())}`,
            `git tag -a -m ${shellQuote(message.trim())} -- ${shellQuote(tag)} 'FETCH_HEAD^{commit}'`,
            `git -c push.followTags=false push -- ${shellQuote(repository.url)} ${shellQuote(`${tagRef}:${tagRef}`)}`
        ].join(' && '), repository.root);
    }

    /** Obtiene la rama de la URL; conserva las ramas locales existentes sin forzarlas. */
    private async switchBranch(value?: string): Promise<void> {
        const repository = await this.repositoryFromInput(value);
        if (!repository) {
            return;
        }
        const branch = await this.promptRefName('Cambiar rama', 'Nombre de la rama en la URL indicada', 'heads');
        if (!branch) {
            return;
        }
        const branchRef = `refs/heads/${branch}`;
        this.runTerminal(
            `git fetch --no-tags -- ${shellQuote(repository.url)} ${shellQuote(branchRef)} && `
            + `if git show-ref --verify --quiet ${shellQuote(branchRef)}; then `
            + `git switch --no-guess -- ${shellQuote(branch)} && git merge --ff-only FETCH_HEAD; `
            + `else git switch --no-track -c ${shellQuote(branch)} FETCH_HEAD; fi`,
            repository.root
        );
    }

    private async openPipelines(value?: string): Promise<void> {
        const repository = await this.repositoryFromInput(value);
        if (!repository) {
            return;
        }
        const url = pipelinesUrl(repository.url);
        if (!url) {
            void vscode.window.showWarningMessage('Introduce una URL HTTP(S) o SSH del proyecto para abrir sus pipelines.');
            return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }

    private async promptRefName(title: string, prompt: string, kind: 'heads' | 'tags'): Promise<string | undefined> {
        const value = await vscode.window.showInputBox({
            title,
            prompt,
            ignoreFocusOut: true,
            validateInput: input => this.validateRefName(input, kind)
        });
        return value !== undefined && !await this.validateRefName(value, kind) ? value.trim() : undefined;
    }

    /** Usa las reglas de Git y evita opciones, refspecs múltiples y nombres especiales. */
    private async validateRefName(value: string, kind: 'heads' | 'tags', allowHead = false): Promise<string | undefined> {
        const name = value.trim();
        if (allowHead && name === 'HEAD') {
            return undefined;
        }
        if (!name || name.startsWith('-') || (kind === 'heads' && name === 'HEAD')) {
            return 'Introduce un nombre de referencia Git válido.';
        }
        try {
            await execFileAsync('git', ['check-ref-format', `refs/${kind}/${name}`], {
                timeout: 10_000,
                windowsHide: true
            });
            return undefined;
        } catch {
            return 'Introduce un nombre de referencia Git válido.';
        }
    }

    private async readGit(root: vscode.Uri, args: string[]): Promise<string | undefined> {
        try {
            const { stdout } = await execFileAsync('git', args, {
                cwd: root.fsPath,
                timeout: 10_000,
                windowsHide: true
            });
            return stdout.trim() || undefined;
        } catch {
            return undefined;
        }
    }

    private runTerminal(command: string, root: vscode.Uri): void {
        const terminal = vscode.window.createTerminal({ name: 'GVHidra — Git', cwd: root });
        terminal.show(true);
        terminal.sendText(`cd ${shellQuote(root.fsPath)} && ${command}`, true);
    }
}

/** Protege los valores introducidos al enviarlos a la terminal POSIX, igual que SVN. */
function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Convierte URLs de clonado habituales en la página web de pipelines de GitLab. */
function pipelinesUrl(repositoryUrl: string): string | undefined {
    let webUrl = repositoryUrl;
    const scpUrl = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(webUrl);
    if (!webUrl.includes('://') && scpUrl && !/^[a-zA-Z]:[\\/]/.test(webUrl)) {
        webUrl = `https://${scpUrl[1]}/${scpUrl[2]}`;
    }
    try {
        let url = new URL(webUrl);
        if (url.protocol === 'ssh:') {
            url = new URL(`https://${url.hostname}${url.pathname}`);
        }
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
            return undefined;
        }
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        const projectPath = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
        if (!projectPath || projectPath === '/') {
            return undefined;
        }
        url.pathname = `${projectPath}/-/pipelines`;
        return url.toString();
    } catch {
        return undefined;
    }
}
