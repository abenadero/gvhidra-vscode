import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const provider = new MenuProvider();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
            'gvhidra-vscode.main',
            provider
        )
    );
}

export function deactivate() {}

class MenuProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {
        const description = new vscode.TreeItem(
            'Este es un texto descriptivo.'
        );

        const button1 = new vscode.TreeItem(
            'Botón 1',
            vscode.TreeItemCollapsibleState.None
        );

        const button2 = new vscode.TreeItem(
            'Botón 2',
            vscode.TreeItemCollapsibleState.None
        );

        return [description, button1, button2];
    }
}
