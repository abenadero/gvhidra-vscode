/**
 * Genera controles HTML reutilizables para las distintas secciones del Webview.
 *
 * Todos los textos y acciones se escapan antes de incorporarse al documento.
 * Los botones simples envían su acción mediante data-command. Los formularios
 * envían tanto la acción como el valor escrito en el input asociado.
 */
export class WebviewControls {
    /**
     * Crea un formulario vertical con un input y, debajo, su botón de acción.
     *
     * @param action Acción que recibirá el proveedor del Webview.
     * @param buttonLabel Texto visible del botón.
     * @param buttonTooltip Ayuda mostrada al situar el cursor sobre el botón.
     * @param inputPlaceholder Texto orientativo mostrado dentro del input.
     */
    public static setInput(
        action: string,
        buttonLabel: string,
        buttonTooltip: string,
        inputPlaceholder: string
    ): string {
        return `
            <form class="input-form" data-command-form="${escapeHtml(action)}">
                <input
                    type="text"
                    name="value"
                    placeholder="${escapeHtml(inputPlaceholder)}"
                    aria-label="${escapeHtml(inputPlaceholder)}"
                >
                <button
                    type="submit"
                    title="${escapeHtml(buttonTooltip)}"
                    aria-label="${escapeHtml(buttonTooltip)}"
                >${escapeHtml(buttonLabel)}</button>
            </form>`;
    }

    /**
     * Crea un botón que envía la acción indicada al proveedor del Webview.
     *
     * @param action Acción que ejecutará el botón.
     * @param buttonLabel Texto visible del botón.
     */
    public static setButton(action: string, buttonLabel: string): string {
        return `<button type="button" data-command="${escapeHtml(action)}">${escapeHtml(buttonLabel)}</button>`;
    }
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[character] ?? character));
}
