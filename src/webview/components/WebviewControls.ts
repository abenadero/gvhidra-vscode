/**
 * Genera controles HTML reutilizables para las distintas secciones del Webview.
 *
 * Todos los textos y acciones se escapan antes de incorporarse al documento.
 * Los botones simples envían su acción mediante data-command. Los formularios
 * envían tanto la acción como el valor escrito en el input asociado.
 */
export class WebviewControls {
    /** Crea un campo de texto independiente, sin botón asociado. */
    public static setInputField(
        inputId: string,
        inputPlaceholder: string,
        value: string = ''
    ): string {
        return `<input
            id="${escapeHtml(inputId)}"
            type="text"
            value="${escapeHtml(value)}"
            placeholder="${escapeHtml(inputPlaceholder)}"
            aria-label="${escapeHtml(inputPlaceholder)}"
        >`;
    }

    /** Crea un label seguido de un campo de texto editable o de solo lectura. */
    public static setLabelledInput(
        label: string,
        inputId: string,
        value: string = '',
        placeholder: string = '',
        readOnly: boolean = false
    ): string {
        return `<div class="labelled-input">
            <label for="${escapeHtml(inputId)}">${escapeHtml(label)}</label>
            <input
                id="${escapeHtml(inputId)}"
                type="text"
                value="${escapeHtml(value)}"
                placeholder="${escapeHtml(placeholder)}"
                aria-label="${escapeHtml(label)}"
                ${readOnly ? 'readonly' : ''}
            >
        </div>`;
    }

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
        inputPlaceholder: string,
        inputId: string = createInputId(action)
    ): string {
        return `
            <form
                class="input-form"
                data-command-form="${escapeHtml(action)}"
                data-input-id="${escapeHtml(inputId)}"
            >
                <input
                    id="${escapeHtml(inputId)}"
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
     * Devuelve el código cliente que lee el valor de un input a partir de su id.
     *
     * Este código se ejecuta dentro del Webview, donde sí está disponible el
     * DOM. La clase TypeScript se ejecuta en el Extension Host y por eso no debe
     * intentar acceder directamente a document.
     */
    public static getInputValueScript(): string {
        return `
            function getInputValue(inputId) {
                const input = document.getElementById(inputId);
                return input instanceof HTMLInputElement ? input.value : '';
            }
        `;
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

    /**
     * Crea un botón cuya acción incluye el valor del input indicado.
     *
     * @param action Acción que ejecutará el botón.
     * @param buttonLabel Texto visible del botón.
     * @param inputId Identificador del input que se leerá al pulsarlo.
     */
    public static setButtonWithInput(action: string, buttonLabel: string, inputId: string): string {
        return `<button type="button" data-command="${escapeHtml(action)}" data-input-id="${escapeHtml(inputId)}">${escapeHtml(buttonLabel)}</button>`;
    }
}

function createInputId(action: string): string {
    return `input-${action.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
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
