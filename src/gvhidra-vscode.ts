import * as vscode from 'vscode';
import { GvhidraWebviewProvider } from './webview/GvhidraWebviewProvider';

/**
 * Activa la extensión y registra el proveedor de la vista principal de GVHidra.
 *
 * @param context Contexto de la extensión usado para registrar suscripciones.
 * @returns No devuelve ningún valor.
 */
export function activate(context: vscode.ExtensionContext): void {
    const provider = new GvhidraWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GvhidraWebviewProvider.viewType,
            provider
        )
    );
}

/**
 * Punto de desactivación de la extensión; actualmente no requiere liberar recursos.
 *
 * @returns No devuelve ningún valor.
 */
export function deactivate(): void {}
