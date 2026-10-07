import { renderWebviewIcon, WebviewIconName } from '../webview/components/WebviewIcon';

export interface WebviewMessage {
    command: string;
    value?: string;
}

export abstract class WebviewSection {
    public abstract readonly id: string;
    public abstract render(): Promise<string> | string;
    public abstract handleAction(action: string, value?: string): Promise<boolean>;
}

export interface WebviewSectionOptions {
    icon?: WebviewIconName;
    status?: string;
    statusTone?: 'neutral' | 'success' | 'warning';
    initiallyOpen?: boolean;
}

export function sectionMarkup(
    title: string,
    content: string,
    options: WebviewSectionOptions = {}
): string {
    const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const icon = renderWebviewIcon(options.icon ?? 'tools', 'section-icon');
    const status = options.status
        ? `<span class="section-status section-status--${options.statusTone ?? 'neutral'}">${escapeHtml(options.status)}</span>`
        : '';
    const open = options.initiallyOpen === false ? '' : ' open';

    return `
        <details class="section panel"${open}>
            <summary class="section-header" aria-labelledby="section-${sectionId}">
                <span class="section-heading">${icon}<span id="section-${sectionId}">${escapeHtml(title)}</span></span>
                <span class="section-meta">${status}<span class="section-chevron" aria-hidden="true"></span></span>
            </summary>
            <div class="section-content">${content}</div>
        </details>`;
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[character] ?? character));
}
