import { renderWebviewIcon, WebviewIconName } from '../webview/components/WebviewIcon';

export interface WebviewMessage {
    command: string;
    value?: string;
}

export abstract class WebviewSection {
    public abstract readonly id: string;

    /** @returns Marcado HTML, inmediato o asíncrono, de la sección. */
    public abstract render(): Promise<string> | string;

    /**
     * Procesa una acción dirigida a la sección.
     *
     * @param action Nombre local de la acción.
     * @param value Valor opcional enviado por el control de la vista.
     * @returns Promesa que indica si la acción fue reconocida.
     */
    public abstract handleAction(action: string, value?: string): Promise<boolean>;
}

export interface WebviewSectionOptions {
    icon?: WebviewIconName;
    status?: string;
    statusTone?: 'neutral' | 'success' | 'warning';
    initiallyOpen?: boolean;
}

/**
 * Envuelve el contenido de una sección en el panel desplegable común de la vista.
 *
 * @param title Título visible de la sección.
 * @param content Marcado HTML que se insertará dentro del panel.
 * @param options Opciones de icono, estado y apertura inicial.
 * @returns Marcado HTML completo de la sección.
 */
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

/**
 * Escapa los caracteres con significado especial en HTML.
 *
 * @param value Texto sin escapar.
 * @returns Texto seguro para insertarlo en contenido o atributos HTML.
 */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[character] ?? character));
}
