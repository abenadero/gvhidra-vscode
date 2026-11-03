import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

const execFileAsync = promisify(execFile);
const MARKETPLACE_NAME = 'am-marketplace';
const MARKETPLACE_URL = 'https://gitlab.laberit.com/am/ia/plugins/am-marketplace/codex.git';

interface CodexPlugin {
    pluginId: string;
    name: string;
    version?: string;
    installed?: boolean;
}

interface CodexPluginList {
    installed: CodexPlugin[];
    available: CodexPlugin[];
}

/** Gestiona Codex y los plugins publicados en el marketplace de Laberit. */
export class CodexSection extends WebviewSection {
    public readonly id = 'codex';

    private executable?: string;
    private version?: string;

    public constructor(private readonly requestRender: () => void) {
        super();
    }

    /** Localiza el Codex incluido en la extensión de VS Code y muestra su versión. */
    public async render(): Promise<string> {
        this.executable = await findCodexExecutable();
        this.version = this.executable
            ? await readCodexVersion(this.executable)
            : undefined;

        if (!this.executable) {
            return sectionMarkup(
                'Codex',
                '<p class="repository-kind">No se encuentra Codex en la extensión OpenAI ChatGPT de VS Code.</p>',
                { icon: 'sparkles', status: 'No disponible', statusTone: 'warning' }
            );
        }

        return sectionMarkup('Codex', [
            WebviewControls.setButton(
                `${this.id}.installMarketplace`,
                'Instalar am-marketplace',
                {
                    variant: 'primary',
                    icon: 'download',
                    tooltip: 'Añadir el marketplace de plugins de Laberit'
                }
            ),
            WebviewControls.setButton(
                `${this.id}.installMarketplacePlugin`,
                'Instalar skills del am-marketplace',
                {
                    icon: 'sparkles',
                    tooltip: 'Consultar y seleccionar un plugin disponible'
                }
            )
        ].join(''), {
            icon: 'sparkles',
            status: this.version ?? 'Instalado',
            statusTone: 'success'
        });
    }

    public async handleAction(action: string): Promise<boolean> {
        if (action === 'installMarketplace') {
            await this.installMarketplace();
            return true;
        }
        if (action === 'installMarketplacePlugin') {
            await this.chooseAndInstallPlugin();
            return true;
        }
        return false;
    }

    private async requireExecutable(): Promise<string | undefined> {
        this.executable ??= await findCodexExecutable();
        if (!this.executable) {
            void vscode.window.showErrorMessage(
                'No se encuentra el ejecutable de Codex instalado por la extensión OpenAI ChatGPT de VS Code.'
            );
        }
        return this.executable;
    }

    private async installMarketplace(): Promise<void> {
        const executable = await this.requireExecutable();
        if (!executable) {
            return;
        }

        try {
            await runCodexWithProgress(
                executable,
                ['plugin', 'marketplace', 'add', MARKETPLACE_URL, '--ref', 'main'],
                'Instalando am-marketplace…'
            );
            void vscode.window.showInformationMessage('am-marketplace se ha instalado correctamente.');
            this.requestRender();
        } catch (error) {
            showCodexError('No se pudo instalar am-marketplace', error);
        }
    }

    private async chooseAndInstallPlugin(): Promise<void> {
        const executable = await this.requireExecutable();
        if (!executable) {
            return;
        }

        let plugins: CodexPluginList;
        try {
            const { stdout } = await runCodexWithProgress(
                executable,
                ['plugin', 'list', '--marketplace', MARKETPLACE_NAME, '--available', '--json'],
                'Consultando skills de am-marketplace…'
            );
            plugins = parsePluginList(stdout);
        } catch (error) {
            showCodexError(
                'No se pudieron consultar las skills. Comprueba que am-marketplace esté instalado',
                error
            );
            return;
        }

        if (plugins.available.length === 0) {
            void vscode.window.showInformationMessage(
                'No hay nuevas skills disponibles en am-marketplace.'
            );
            return;
        }

        const selection = await vscode.window.showQuickPick(
            plugins.available.map(plugin => ({
                label: plugin.name,
                description: plugin.version ? `v${plugin.version}` : undefined,
                detail: plugin.pluginId,
                pluginId: plugin.pluginId
            })),
            {
                title: 'Skills disponibles en am-marketplace',
                placeHolder: 'Selecciona la skill que quieres instalar',
                matchOnDescription: true,
                matchOnDetail: true
            }
        );
        if (!selection) {
            return;
        }

        try {
            await runCodexWithProgress(
                executable,
                ['plugin', 'add', selection.pluginId],
                `Instalando ${selection.label}…`
            );
            void vscode.window.showInformationMessage(`${selection.label} se ha instalado correctamente.`);
        } catch (error) {
            showCodexError(`No se pudo instalar ${selection.label}`, error);
        }
    }
}

/**
 * Busca dentro de las instalaciones remota y local de VS Code partiendo
 * siempre del HOME actual. Se elige la extensión ChatGPT más reciente.
 */
async function findCodexExecutable(): Promise<string | undefined> {
    const extensionRoots = [
        join(homedir(), '.vscode-server', 'extensions'),
        join(homedir(), '.vscode-server-insiders', 'extensions'),
        join(homedir(), '.vscode', 'extensions'),
        join(homedir(), '.vscode-insiders', 'extensions')
    ];

    for (const extensionRoot of extensionRoots) {
        let extensionNames: string[];
        try {
            extensionNames = (await readdir(extensionRoot))
                .filter(name => name.startsWith('openai.chatgpt-'))
                .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
        } catch {
            continue;
        }

        for (const extensionName of extensionNames) {
            const binDirectory = join(extensionRoot, extensionName, 'bin');
            let platformDirectories: string[];
            try {
                platformDirectories = await readdir(binDirectory);
            } catch {
                continue;
            }

            for (const platformDirectory of platformDirectories) {
                const executable = join(
                    binDirectory,
                    platformDirectory,
                    process.platform === 'win32' ? 'codex.exe' : 'codex'
                );
                try {
                    await access(executable, constants.X_OK);
                    return executable;
                } catch {
                    // Continúa con otra arquitectura o versión de la extensión.
                }
            }
        }
    }
    return undefined;
}

async function readCodexVersion(executable: string): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync(executable, ['--version'], {
            timeout: 5_000,
            windowsHide: true
        });
        const version = stdout.trim().replace(/^codex-cli\s+/i, '');
        return version || undefined;
    } catch {
        return undefined;
    }
}

async function runCodexWithProgress(
    executable: string,
    args: string[],
    title: string
): Promise<{ stdout: string; stderr: string }> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title },
        () => execFileAsync(executable, args, {
            timeout: 120_000,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024
        })
    );
}

function parsePluginList(output: string): CodexPluginList {
    const value: unknown = JSON.parse(output);
    if (!isRecord(value)) {
        throw new Error('Codex ha devuelto una respuesta JSON no válida.');
    }
    return {
        installed: parsePlugins(value.installed),
        available: parsePlugins(value.available)
    };
}

function parsePlugins(value: unknown): CodexPlugin[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap(item => {
        if (!isRecord(item) || typeof item.pluginId !== 'string' || typeof item.name !== 'string') {
            return [];
        }
        return [{
            pluginId: item.pluginId,
            name: item.name,
            version: typeof item.version === 'string' ? item.version : undefined,
            installed: typeof item.installed === 'boolean' ? item.installed : undefined
        }];
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function showCodexError(prefix: string, error: unknown): void {
    const detail = commandErrorMessage(error);
    void vscode.window.showErrorMessage(detail ? `${prefix}: ${detail}` : `${prefix}.`);
}

function commandErrorMessage(error: unknown): string | undefined {
    if (isRecord(error)) {
        const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
        if (stderr) {
            return stderr.split(/\r?\n/).at(-1);
        }
    }
    return error instanceof Error ? error.message : undefined;
}
