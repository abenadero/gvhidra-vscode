/**
 * Encapsula la presentación y las acciones exclusivas de repositorios Git.
 *
 * VersionControlSection sólo instancia y delega en este helper cuando existe
 * un directorio .git y no existe un directorio .svn. Los botones y comandos
 * Git se incorporarán aquí en futuras iteraciones, evitando que la sección
 * coordinadora conozca detalles específicos de Git.
 */
export class GITHelper {
    /**
     * Renderiza el estado Git actual. Todavía no se muestran botones porque
     * las operaciones Git se definirán expresamente en una fase posterior.
     */
    public render(): string {
        return '<p class="repository-kind">Git repository detected</p>';
    }

    /**
     * Punto único de entrada para los futuros mensajes enviados por botones
     * Git. Hasta que existan acciones Git, ningún comando se considera válido.
     */
    public async handleAction(_action: string): Promise<boolean> {
        return false;
    }
}
