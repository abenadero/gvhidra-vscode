import * as vscode from 'vscode';
import { sectionMarkup, WebviewSection } from '../WebviewSection';
import { GITHelper } from './GITHelper';
import { SVNHelper } from './SVNHelper';

type RepositoryKind = 'git' | 'svn' | 'none';

/**
 * Coordina la sección VERSION CONTROL sin implementar operaciones concretas.
 *
 * Su única responsabilidad es detectar .git y .svn en la raíz del proyecto,
 * escoger el helper adecuado y delegar en él tanto el HTML como los mensajes.
 * SVN tiene prioridad si, de forma excepcional, ambos metadatos están presentes;
 * por tanto GITHelper sólo se renderiza para proyectos Git que no son SVN.
 */
export class VersionControlSection extends WebviewSection {
    public readonly id = 'version-control';

    private readonly gitHelper = new GITHelper();
    private readonly svnHelper: SVNHelper;
    private activeRepository: RepositoryKind = 'none';

    public constructor(
        context: vscode.ExtensionContext,
        requestRender: () => void
    ) {
        super();
        this.svnHelper = new SVNHelper(context, requestRender);
    }

    /**
     * Detecta el repositorio en cada renderizado para que la vista refleje el
     * proyecto abierto. Si no se reconoce Git ni SVN no se crean botones.
     */
    public async render(): Promise<string> {
        this.activeRepository = await this.detectRepository();

        if (this.activeRepository === 'svn') {
            return sectionMarkup('VERSION CONTROL', this.svnHelper.render());
        }
        if (this.activeRepository === 'git') {
            return sectionMarkup('VERSION CONTROL', this.gitHelper.render());
        }

        return sectionMarkup(
            'VERSION CONTROL',
            '<p class="repository-kind">No se ha reconocido este directorio como un proyecto GIT o SVN</p>'
        );
    }

    /**
     * Enruta exclusivamente al helper del repositorio detectado. El prefijo
     * impide que una acción SVN pueda ejecutarse mientras la vista está en Git,
     * y deja preparado el mismo aislamiento para futuras acciones Git.
     */
    public async handleAction(action: string): Promise<boolean> {
        if (this.activeRepository === 'svn' && action.startsWith('svn.')) {
            return this.svnHelper.handleAction(action.slice('svn.'.length));
        }
        if (this.activeRepository === 'git' && action.startsWith('git.')) {
            return this.gitHelper.handleAction(action.slice('git.'.length));
        }
        return false;
    }

    private async detectRepository(): Promise<RepositoryKind> {
        const root = vscode.workspace.workspaceFolders?.[0];
        if (!root) {
            return 'none';
        }

        const [hasGit, hasSvn] = await Promise.all([
            exists(vscode.Uri.joinPath(root.uri, '.git')),
            exists(vscode.Uri.joinPath(root.uri, '.svn'))
        ]);

        if (hasSvn) {
            return 'svn';
        }
        return hasGit ? 'git' : 'none';
    }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}
