import * as vscode from 'vscode';
import { WorkingDirectoryControl } from '../../common/WorkingDirectoryControl';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';
import { GITHelper } from './GITHelper';
import { SVNHelper } from './SVNHelper';

type RepositoryKind = 'git' | 'svn' | 'none';

/**
 * Coordina la sección VERSION CONTROL sin implementar operaciones concretas.
 *
 * Detecta primero el repositorio de la carpeta abierta relevante. Si la raíz
 * no es Git ni SVN, busca la working copy SVN del fichero activo y, como
 * último recurso, una única working copy SVN anidada.
 */
export class VersionControlSection extends WebviewSection {
    public readonly id = 'version-control';
    private static readonly repositoryInputId = 'repository-url';

    private readonly gitHelper: GITHelper;
    private readonly svnHelper: SVNHelper;
    private activeRepository: RepositoryKind = 'none';

    /**
     * Crea los helpers especializados en Git y SVN.
     *
     * @param context Contexto de la extensión compartido por los helpers.
     * @param requestRender Callback para solicitar el refresco de la vista.
     */
    public constructor(
        context: vscode.ExtensionContext,
        requestRender: () => void
    ) {
        super();
        this.gitHelper = new GITHelper(context, requestRender);
        this.svnHelper = new SVNHelper(context, requestRender);
    }

    /**
     * Detecta el repositorio en cada renderizado para que la vista refleje el
     * proyecto abierto. Sin repositorio ofrece los controles iniciales de descarga.
     *
     * @returns Marcado HTML correspondiente al repositorio detectado.
     */
    public async render(): Promise<string> {
        this.activeRepository = await this.detectRepository();

        if (this.activeRepository === 'svn') {
            return sectionMarkup('Version control', await this.svnHelper.render(), {
                icon: 'source-control',
                status: 'SVN active',
                statusTone: 'success'
            });
        }
        if (this.activeRepository === 'git') {
            return sectionMarkup('Version control', await this.gitHelper.render(), {
                icon: 'source-control',
                status: 'Git active',
                statusTone: 'success'
            });
        }

        return sectionMarkup(
            'Version control',
            [
                '<p class="repository-kind">No se ha reconocido este directorio como un proyecto GIT o SVN.</p>',
                WebviewControls.setLabelledInput(
                    'URL Repositorio',
                    VersionControlSection.repositoryInputId,
                    '',
                    'https://servidor/ruta/del/repositorio'
                ),
                WebviewControls.setButtonWithInput(
                    `${this.id}.svn.checkout`,
                    'SVN checkout',
                    VersionControlSection.repositoryInputId,
                    { variant: 'primary', icon: 'download' }
                ),
                WebviewControls.setButtonWithInput(
                    `${this.id}.git.clone`,
                    'GIT clone',
                    VersionControlSection.repositoryInputId,
                    { variant: 'primary', icon: 'download' }
                )
            ].join(''),
            { icon: 'source-control', status: 'Not detected', statusTone: 'warning' }
        );
    }

    /**
     * Enruta al helper del repositorio detectado. Cuando no hay repositorio,
     * solo permite el checkout SVN o el clone Git de un proyecto nuevo.
     *
     * @param action Acción con el prefijo del sistema de control de versiones.
     * @param value Valor opcional recibido desde un control del Webview.
     * @returns `true` si el helper activo reconoce la acción; en caso contrario, `false`.
     */
    public async handleAction(action: string, value?: string): Promise<boolean> {
        if (this.activeRepository === 'none' && (action === 'svn.checkout' || action === 'git.clone')) {
            const root = WorkingDirectoryControl.current();
            if (!root) {
                void vscode.window.showWarningMessage('Abre primero una carpeta de trabajo.');
                return true;
            }
            if (action === 'svn.checkout') {
                this.svnHelper.setWorkingCopyRoot(root);
                return this.svnHelper.handleAction('checkout', value);
            }
            this.gitHelper.setRepositoryRoot(root);
            return this.gitHelper.handleAction('clone', value);
        }
        if (this.activeRepository === 'svn' && action.startsWith('svn.')) {
            return this.svnHelper.handleAction(action.slice('svn.'.length), value);
        }
        if (this.activeRepository === 'git' && action.startsWith('git.')) {
            return this.gitHelper.handleAction(action.slice('git.'.length), value);
        }
        return false;
    }

    /**
     * Detecta el repositorio relevante priorizando la carpeta del fichero activo.
     *
     * @returns Tipo de repositorio encontrado o `none` cuando no existe uno inequívoco.
     */
    private async detectRepository(): Promise<RepositoryKind> {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const activeFile = vscode.window.activeTextEditor?.document.uri;
        const activeFolder = activeFile?.scheme === 'file'
            ? vscode.workspace.getWorkspaceFolder(activeFile)
            : undefined;

        // La carpeta del fichero activo define el contexto en workspaces
        // multirraíz. Un marcador en su raíz siempre prevalece sobre cualquier
        // repositorio anidado.
        if (activeFolder) {
            const repository = await this.detectWorkspaceRoot(activeFolder);
            if (repository !== 'none') {
                return repository;
            }

            const activeSvnRoot = await SVNHelper.findActiveWorkingCopyRoot();
            if (activeSvnRoot) {
                this.svnHelper.setWorkingCopyRoot(activeSvnRoot);
                return 'svn';
            }
        }

        for (const folder of folders) {
            if (folder !== activeFolder) {
                const repository = await this.detectWorkspaceRoot(folder);
                if (repository !== 'none') {
                    return repository;
                }
            }
        }

        const nestedSvnRoot = await SVNHelper.findUniqueNestedWorkingCopyRoot();
        if (nestedSvnRoot) {
            this.svnHelper.setWorkingCopyRoot(nestedSvnRoot);
            return 'svn';
        }

        return 'none';
    }

    /**
     * Comprueba los marcadores de Git y SVN en la raíz exacta de una carpeta abierta.
     *
     * @param folder Carpeta de workspace que se desea inspeccionar.
     * @returns Tipo de repositorio detectado o `none` si no hay marcador en la raíz.
     */
    private async detectWorkspaceRoot(folder: vscode.WorkspaceFolder): Promise<RepositoryKind> {
        // La working copy de la carpeta abierta prevalece sobre un marcador Git residual.
        if (await exists(vscode.Uri.joinPath(folder.uri, '.svn'))) {
            this.svnHelper.setWorkingCopyRoot(folder.uri);
            return 'svn';
        }
        if (await exists(vscode.Uri.joinPath(folder.uri, '.git'))
            && await GITHelper.isRepositoryRoot(folder.uri)) {
            this.gitHelper.setRepositoryRoot(folder.uri);
            return 'git';
        }
        return 'none';
    }
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
