import { promptForGitEnvironment } from '../../common/GitAuthentication';

/** Reconoce los errores con los que Git solicita o rechaza credenciales HTTPS. */
export function isGitAuthenticationError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
        return false;
    }
    const details = ['message', 'stderr', 'stdout']
        .map(key => (error as Record<string, unknown>)[key])
        .filter(value => typeof value === 'string')
        .join('\n');
    return /authentication failed|authentication required|http basic: access denied|could not read (?:username|password)|terminal prompts disabled/i.test(details);
}

/**
 * Solicita credenciales y las facilita a Git solo durante la instalación.
 * El helper no escribe secretos en disco, argumentos, URLs ni configuración Git.
 */
export async function promptForMarketplaceGitEnvironment(
    repositoryUrl: string
): Promise<NodeJS.ProcessEnv | undefined> {
    return promptForGitEnvironment(repositoryUrl, {
        title: `Credenciales de GitLab (${new URL(repositoryUrl).hostname})`,
        username: 'Usuario de GitLab para instalar am-marketplace',
        password: 'Contraseña o token de acceso personal de GitLab con permiso de lectura del repositorio'
    });
}
