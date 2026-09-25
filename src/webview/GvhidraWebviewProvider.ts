import * as vscode from 'vscode';
import { DocumentationSection } from '../sections/documentation/DocumentationSection';
import { GenaroSection } from '../sections/genaro/GenaroSection';
import { PhpCsFixerSection } from '../sections/php-cs-fixer/PhpCsFixerSection';
import { VersionControlSection } from '../sections/version-control/VersionControlSection';
import { WebviewMessage, WebviewSection } from '../sections/WebviewSection';

export class GvhidraWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gvhidra-vscode.main';

    private view?: vscode.WebviewView;
    private readonly sections: WebviewSection[];

    public constructor(context: vscode.ExtensionContext) {
        this.sections = [
            new VersionControlSection(context, () => this.render()),
            new GenaroSection(),
            new PhpCsFixerSection(),
            new DocumentationSection()
        ];
    }

    public resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.onDidReceiveMessage(
            message => void this.handleMessage(message),
            undefined,
            []
        );
        void this.render();
    }

    private async handleMessage(message: unknown): Promise<void> {
        if (!isWebviewMessage(message)) {
            return;
        }
        const separator = message.command.indexOf('.');
        if (separator < 1) {
            return;
        }
        const sectionId = message.command.slice(0, separator);
        const action = message.command.slice(separator + 1);
        const section = this.sections.find(candidate => candidate.id === sectionId);
        await section?.handleAction(action, message.value);
    }

    private async render(): Promise<void> {
        if (!this.view) {
            return;
        }
        const nonce = createNonce();
        const sections = await Promise.all(this.sections.map(section => section.render()));
        this.view.webview.html = getHtml(sections.join('\n'), nonce);
    }
}

function isWebviewMessage(value: unknown): value is WebviewMessage {
    return typeof value === 'object'
        && value !== null
        && typeof (value as { command?: unknown }).command === 'string'
        && ((value as { value?: unknown }).value === undefined
            || typeof (value as { value?: unknown }).value === 'string');
}

function createNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let index = 0; index < 32; index += 1) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
}

function getHtml(sections: string, nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        :root { color-scheme: light dark; }
        body { box-sizing: border-box; margin: 0; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
        .section { margin: 0 0 20px; }
        h2 { margin: 0 0 8px; color: var(--vscode-sideBarSectionHeader-foreground); font-size: 11px; font-weight: 700; letter-spacing: .4px; }
        .section-content, .input-form { display: flex; flex-direction: column; gap: 6px; }
        .input-form { margin: 0; }
        input { box-sizing: border-box; width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
        input::placeholder { color: var(--vscode-input-placeholderForeground); }
        input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
        button { width: 100%; padding: 6px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; text-align: left; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
        .repository-kind { margin: 0 0 2px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    </style>
</head>
<body>
    ${sections}
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const button = target.closest('button[data-command]');
            if (button instanceof HTMLButtonElement) {
                vscode.postMessage({ command: button.dataset.command });
            }
        });
        document.addEventListener('submit', event => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.dataset.commandForm) {
                return;
            }
            event.preventDefault();
            const input = form.elements.namedItem('value');
            vscode.postMessage({
                command: form.dataset.commandForm,
                value: input instanceof HTMLInputElement ? input.value : ''
            });
        });
    </script>
</body>
</html>`;
}
