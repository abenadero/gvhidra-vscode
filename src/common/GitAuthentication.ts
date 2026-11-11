import * as vscode from 'vscode';

/** Solicita credenciales y las facilita a Git solo durante la operación actual. */
export async function promptForGitEnvironment(
    repositoryUrl: string,
    prompts: { title: string; username: string; password: string }
): Promise<Record<string, string> | undefined> {
    const username = await vscode.window.showInputBox({
        title: prompts.title,
        prompt: prompts.username,
        ignoreFocusOut: true,
        validateInput: value => validateCredential(value.trim(), 'Introduce el usuario de Git.')
    });
    if (username === undefined || validateCredential(username.trim())) {
        return undefined;
    }

    const password = await vscode.window.showInputBox({
        title: prompts.title,
        prompt: prompts.password,
        password: true,
        ignoreFocusOut: true,
        validateInput: value => validateCredential(value, 'Introduce la contraseña o el token de Git.')
    });
    if (password === undefined || validateCredential(password)) {
        return undefined;
    }

    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            environment[key] = value;
        }
    }
    environment.GIT_TERMINAL_PROMPT = '0';
    environment.GIT_ASKPASS = '';
    environment.GVHIDRA_GIT_USERNAME = username.trim();
    environment.GVHIDRA_GIT_PASSWORD = password;
    let count = Number(environment.GIT_CONFIG_COUNT ?? '0');
    for (const url of credentialUrls(repositoryUrl)) {
        const helperKey = `credential.${url}.helper`;
        const settings = [
            // No reutiliza ni guarda estas credenciales en otros helpers.
            [helperKey, ''],
            [helperKey, '!f() { if [ "$1" = get ]; then printf \'%s\\n\' "username=$GVHIDRA_GIT_USERNAME" "password=$GVHIDRA_GIT_PASSWORD"; fi; }; f']
        ];
        for (const [key, value] of settings) {
            environment[`GIT_CONFIG_KEY_${count}`] = key;
            environment[`GIT_CONFIG_VALUE_${count}`] = value;
            count++;
        }
    }
    environment.GIT_CONFIG_COUNT = String(count);
    return environment;
}

/** GitLab puede redirigir la URL elegida a la misma ruta con el sufijo .git. */
function credentialUrls(repositoryUrl: string): string[] {
    const urls = new Set([repositoryUrl]);
    try {
        const url = new URL(repositoryUrl);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            url.pathname = url.pathname.replace(/\/+$/, '');
            urls.add(url.toString());
            url.pathname = url.pathname.endsWith('.git')
                ? url.pathname.slice(0, -4)
                : `${url.pathname}.git`;
            urls.add(url.toString());
        }
    } catch {
        // Las rutas locales y las URLs SCP conservan su representación original.
    }
    return [...urls];
}

/** Evita valores vacíos y saltos de línea en el protocolo de credenciales de Git. */
function validateCredential(value: string, emptyMessage = 'Introduce un valor.'): string | undefined {
    if (!value) {
        return emptyMessage;
    }
    return /[\0\r\n]/.test(value) ? 'Las credenciales no pueden contener saltos de línea.' : undefined;
}
