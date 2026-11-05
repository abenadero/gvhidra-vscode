import * as vscode from 'vscode';

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
    const title = `Credenciales de GitLab (${new URL(repositoryUrl).hostname})`;
    const username = await vscode.window.showInputBox({
        title,
        prompt: 'Usuario de GitLab para instalar am-marketplace',
        ignoreFocusOut: true,
        validateInput: value => validateCredential(value.trim(), 'Introduce el usuario de GitLab.')
    });
    if (username === undefined || validateCredential(username.trim())) {
        return undefined;
    }

    const password = await vscode.window.showInputBox({
        title,
        prompt: 'Contraseña o token de acceso personal de GitLab con permiso de lectura del repositorio',
        password: true,
        ignoreFocusOut: true,
        validateInput: value => validateCredential(value, 'Introduce la contraseña o el token de GitLab.')
    });
    if (password === undefined || validateCredential(password)) {
        return undefined;
    }

    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GVHIDRA_MARKETPLACE_GIT_USERNAME: username.trim(),
        GVHIDRA_MARKETPLACE_GIT_PASSWORD: password
    };
    const helperKey = `credential.${repositoryUrl}.helper`;
    const settings = [
        // Impide reutilizar o guardar estas credenciales en otros helpers.
        [helperKey, ''],
        [helperKey, '!f() { if [ "$1" = get ]; then printf \'%s\\n\' "username=$GVHIDRA_MARKETPLACE_GIT_USERNAME" "password=$GVHIDRA_MARKETPLACE_GIT_PASSWORD"; fi; }; f']
    ];
    let count = Number(environment.GIT_CONFIG_COUNT ?? '0');
    for (const [key, value] of settings) {
        environment[`GIT_CONFIG_KEY_${count}`] = key;
        environment[`GIT_CONFIG_VALUE_${count}`] = value;
        count++;
    }
    environment.GIT_CONFIG_COUNT = String(count);
    return environment;
}

/** Evita valores vacíos y saltos de línea en el protocolo de credenciales de Git. */
function validateCredential(value: string, emptyMessage = 'Introduce un valor.'): string | undefined {
    if (!value) {
        return emptyMessage;
    }
    return /[\0\r\n]/.test(value) ? 'Las credenciales no pueden contener saltos de línea.' : undefined;
}
