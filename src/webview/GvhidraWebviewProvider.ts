import * as vscode from 'vscode';
import { WorkingDirectoryControl } from '../common/WorkingDirectoryControl';
import { DocumentationSection } from '../sections/documentation/DocumentationSection';
import { GenaroSection } from '../sections/genaro/GenaroSection';
import { PhpCsFixerSection } from '../sections/php-cs-fixer/PhpCsFixerSection';
import { VersionControlSection } from '../sections/version-control/VersionControlSection';
import { WebviewMessage, WebviewSection } from '../sections/WebviewSection';
import { XDebug3Section } from '../sections/xdebug3/XDebug3Section';
import { WebviewControls } from './components/WebviewControls';

export class GvhidraWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gvhidra-vscode.main';

    private view?: vscode.WebviewView;
    private readonly sections: WebviewSection[];

    public constructor(context: vscode.ExtensionContext) {
        this.sections = [
            new VersionControlSection(context, () => this.render()),
            new GenaroSection(),
            new PhpCsFixerSection(),
            new XDebug3Section(),
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
        const commonControls = WorkingDirectoryControl.render();
        const sections = await Promise.all(this.sections.map(section => section.render()));
        this.view.webview.html = getHtml(commonControls, sections.join('\n'), nonce);
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

function getHtml(commonControls: string, sections: string, nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
        .common-working-directory { margin: 0 0 12px; padding: 10px; }
        .section { margin: 0 0 12px; overflow: hidden; }
        .section:last-child { margin-bottom: 0; }
        .panel { border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(127, 127, 127, .35))); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background)); box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, .14)); }
        .section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 42px; padding: 9px 10px; color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); background: color-mix(in srgb, var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background)) 82%, var(--vscode-focusBorder) 18%); cursor: pointer; list-style: none; user-select: none; }
        .section-header::-webkit-details-marker { display: none; }
        .section-header:hover { background: color-mix(in srgb, var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background)) 74%, var(--vscode-focusBorder) 26%); }
        .section-header:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
        .section-heading, .section-meta { display: flex; align-items: center; min-width: 0; }
        .section-heading { gap: 8px; font-size: 11px; font-weight: 700; letter-spacing: .55px; text-transform: uppercase; }
        .section-meta { gap: 7px; }
        .icon { display: block; flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
        .section-icon { color: var(--vscode-focusBorder); }
        .section-status { overflow: hidden; max-width: 110px; padding: 2px 6px; border: 1px solid transparent; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0; line-height: 1.35; text-overflow: ellipsis; text-transform: none; white-space: nowrap; }
        .section-status--neutral { color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--vscode-descriptionForeground) 12%, transparent); }
        .section-status--success { color: var(--vscode-testing-iconPassed, #73c991); background: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 13%, transparent); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 35%, transparent); }
        .section-status--warning { color: var(--vscode-editorWarning-foreground, #cca700); background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 13%, transparent); border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 35%, transparent); }
        .section-chevron { width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg) translate(-1px, -1px); transition: transform 140ms ease; }
        .section:not([open]) .section-chevron { transform: rotate(-45deg); }
        .section-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding: 10px; border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border, var(--vscode-widget-border, transparent)) 65%, transparent); }
        .input-form { display: flex; flex-direction: column; grid-column: 1 / -1; gap: 7px; margin: 0; }
        .labelled-input { display: flex; flex-direction: column; gap: 4px; }
        .labelled-input label { color: var(--vscode-descriptionForeground); font-size: 11px; }
        input { width: 100%; min-height: 30px; padding: 6px 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; transition: border-color 120ms ease, box-shadow 120ms ease; }
        input::placeholder { color: var(--vscode-input-placeholderForeground); }
        input:focus-visible { border-color: var(--vscode-focusBorder); outline: none; box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
        input[readonly] { color: var(--vscode-descriptionForeground); opacity: .85; }
        .button { display: inline-flex; align-items: center; justify-content: flex-start; gap: 7px; width: 100%; min-height: 32px; padding: 6px 9px; border: 1px solid transparent; border-radius: 5px; font: inherit; font-weight: 500; line-height: 1.25; text-align: left; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, transform 80ms ease; }
        .button:hover { transform: translateY(-1px); }
        .button:active { transform: translateY(0); }
        .button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
        .button--primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: var(--vscode-button-border, transparent); }
        .button--primary:hover { background: var(--vscode-button-hoverBackground); }
        .button--secondary { color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-foreground) 10%, transparent)); border-color: color-mix(in srgb, var(--vscode-foreground) 15%, transparent); }
        .button--secondary:hover { background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-foreground) 17%, transparent)); border-color: color-mix(in srgb, var(--vscode-foreground) 25%, transparent); }
        .button--ghost { color: var(--vscode-textLink-foreground); background: transparent; }
        .button--ghost:hover { color: var(--vscode-textLink-activeForeground); background: color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent); }
        .button-icon { width: 15px; height: 15px; }
        .section-content > .button:last-child:nth-of-type(odd) { grid-column: 1 / -1; }
        .repository-kind { grid-column: 1 / -1; margin: 0 0 2px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; }
        .section-content > .labelled-input { grid-column: 1 / -1; }
        @media (max-width: 360px) {
            .section-content { grid-template-columns: 1fr; }
        }
        @media (max-width: 240px) {
            .section-status { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
            .button, .section-chevron { transition: none; }
        }
    </style>
</head>
<body>
    ${commonControls}
    ${sections}
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        ${WebviewControls.getInputValueScript()}
        document.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const button = target.closest('button[data-command]');
            if (button instanceof HTMLButtonElement) {
                vscode.postMessage({
                    command: button.dataset.command,
                    value: button.dataset.inputId ? getInputValue(button.dataset.inputId) : undefined
                });
            }
        });
        document.addEventListener('submit', event => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !form.dataset.commandForm) {
                return;
            }
            event.preventDefault();
            vscode.postMessage({
                command: form.dataset.commandForm,
                value: form.dataset.inputId ? getInputValue(form.dataset.inputId) : ''
            });
        });
    </script>
</body>
</html>`;
}
