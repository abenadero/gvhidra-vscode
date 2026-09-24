export interface WebviewMessage {
    command: string;
}

export abstract class WebviewSection {
    public abstract readonly id: string;
    public abstract render(): Promise<string> | string;
    public abstract handleAction(action: string): Promise<boolean>;
}

export function sectionMarkup(title: string, content: string): string {
    const sectionId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `
        <section class="section" aria-labelledby="section-${sectionId}">
            <h2 id="section-${sectionId}">${escapeHtml(title)}</h2>
            <div class="section-content">${content}</div>
        </section>`;
}

export function actionButton(label: string, command: string): string {
    return `<button type="button" data-command="${escapeHtml(command)}">${escapeHtml(label)}</button>`;
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
