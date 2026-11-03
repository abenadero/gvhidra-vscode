import { renderWebviewIcon, WebviewIconName } from './WebviewIcon';

export type WebviewButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface WebviewButtonOptions {
    variant?: WebviewButtonVariant;
    icon?: WebviewIconName;
    tooltip?: string;
}

/**
 * Genera controles HTML reutilizables para las distintas secciones del Webview.
 *
 * Todos los textos y acciones se escapan antes de incorporarse al documento.
 * Los botones simples envían su acción mediante data-command. Los formularios
 * envían tanto la acción como el valor escrito en el input asociado.
 */
export class WebviewControls {
    /**
     * Crea un campo de texto independiente, sin botón asociado.
     *
     * @param inputId Identificador HTML del campo.
     * @param inputPlaceholder Texto orientativo del campo.
     * @param value Valor inicial del campo.
     * @returns Marcado HTML del campo de texto.
     */
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

    /**
     * Crea una etiqueta seguida de un campo de texto editable o de solo lectura.
     *
     * @param label Texto visible de la etiqueta.
     * @param inputId Identificador HTML del campo.
     * @param value Valor inicial del campo.
     * @param placeholder Texto orientativo mostrado cuando el campo está vacío.
     * @param readOnly Indica si el usuario puede modificar el campo.
     * @returns Marcado HTML del control etiquetado.
     */
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
     * @param inputId Identificador del campo; si se omite se deriva de la acción.
     * @param options Opciones visuales del botón del formulario.
     * @returns Marcado HTML del formulario.
     */
    public static setInput(
        action: string,
        buttonLabel: string,
        buttonTooltip: string,
        inputPlaceholder: string,
        inputId: string = createInputId(action),
        options: WebviewButtonOptions = { variant: 'primary' }
    ): string {
        const variant = options.variant ?? 'primary';
        const icon = options.icon ? renderWebviewIcon(options.icon, 'button-icon') : '';
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
                    class="button button--${variant}"
                    type="submit"
                    title="${escapeHtml(buttonTooltip)}"
                    aria-label="${escapeHtml(buttonTooltip)}"
                >${icon}<span>${escapeHtml(buttonLabel)}</span></button>
            </form>`;
    }

    /**
     * Devuelve el código cliente que lee el valor de un input a partir de su id.
     *
     * Este código se ejecuta dentro del Webview, donde sí está disponible el
     * DOM. La clase TypeScript se ejecuta en el Extension Host y por eso no debe
     * intentar acceder directamente a document.
     *
     * @returns Código JavaScript que define el lector de valores de campos.
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
     * @param options Opciones visuales y de accesibilidad del botón.
     * @returns Marcado HTML del botón.
     */
    public static setButton(
        action: string,
        buttonLabel: string,
        options: WebviewButtonOptions = {}
    ): string {
        return this.createButton(action, buttonLabel, options);
    }

    /**
     * Crea un botón cuya acción incluye el valor del input indicado.
     *
     * @param action Acción que ejecutará el botón.
     * @param buttonLabel Texto visible del botón.
     * @param inputId Identificador del input que se leerá al pulsarlo.
     * @param options Opciones visuales y de accesibilidad del botón.
     * @returns Marcado HTML del botón enlazado al campo.
     */
    public static setButtonWithInput(
        action: string,
        buttonLabel: string,
        inputId: string,
        options: WebviewButtonOptions = {}
    ): string {
        return this.createButton(action, buttonLabel, options, inputId);
    }

    /**
     * Crea cualquiera de las variantes visuales manteniendo una única
     * estructura para estados, iconos, tooltips y atributos de mensajería.
     *
     * @param action Acción enviada al pulsar el botón.
     * @param buttonLabel Texto visible del botón.
     * @param options Opciones visuales y de accesibilidad.
     * @param inputId Campo opcional cuyo valor se enviará con la acción.
     * @returns Marcado HTML del botón configurado.
     */
    public static createButton(
        action: string,
        buttonLabel: string,
        options: WebviewButtonOptions = {},
        inputId?: string
    ): string {
        const variant = options.variant ?? 'secondary';
        const tooltip = options.tooltip
            ? ` title="${escapeHtml(options.tooltip)}" aria-label="${escapeHtml(options.tooltip)}"`
            : '';
        const inputAttribute = inputId
            ? ` data-input-id="${escapeHtml(inputId)}"`
            : '';
        const icon = options.icon ? renderWebviewIcon(options.icon, 'button-icon') : '';

        return `<button class="button button--${variant}" type="button" data-command="${escapeHtml(action)}"${inputAttribute}${tooltip}>${icon}<span>${escapeHtml(buttonLabel)}</span></button>`;
    }
}

/**
 * Deriva un identificador HTML estable a partir del nombre de una acción.
 *
 * @param action Nombre de la acción asociada al campo.
 * @returns Identificador con caracteres válidos para HTML.
 */
function createInputId(action: string): string {
    return `input-${action.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

/**
 * Escapa texto antes de insertarlo en el HTML generado por los controles.
 *
 * @param value Texto sin escapar.
 * @returns Texto con los caracteres HTML reservados codificados.
 */
function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[character] ?? character));
}
