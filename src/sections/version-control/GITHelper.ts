/**
 * Encapsula la presentación y las acciones exclusivas de repositorios Git.
 *
 * VersionControlSection delega en este helper cuando la carpeta de workspace
 * relevante contiene .git en su raíz. Los botones y comandos Git se
 * incorporarán aquí en futuras iteraciones, evitando que la sección
 * coordinadora conozca detalles específicos de Git.
 */
export class GITHelper {
    /**
     * Renderiza el estado Git actual. Todavía no se muestran botones porque
     * las operaciones Git se definirán expresamente en una fase posterior.
     *
     * @returns Marcado HTML que informa de la detección del repositorio Git.
     */
    public render(): string {
        return '<p class="repository-kind">Git repository detected</p>';
    }

    /**
     * Punto único de entrada para los futuros mensajes enviados por botones
     * Git. Hasta que existan acciones Git, ningún comando se considera válido.
     *
     * @param _action Nombre de la acción Git recibida, actualmente no utilizado.
     * @returns Promesa resuelta siempre con `false` mientras no haya acciones implementadas.
     */
    public async handleAction(_action: string): Promise<boolean> {
        return false;
    }
}
