import * as vscode from 'vscode';
import { GvhidraWebviewProvider } from './webview/GvhidraWebviewProvider';

export function activate(context: vscode.ExtensionContext): void {
    const provider = new GvhidraWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GvhidraWebviewProvider.viewType,
            provider
        )
    );
}

export function deactivate(): void {}
