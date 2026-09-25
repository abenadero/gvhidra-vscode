import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

const CONFLUENCE_URL = 'https://confluence.gva.es/spaces/gvhidra/pages/723550873/%C2%BFQu%C3%A9+es+gvHIDRA';

export class DocumentationSection extends WebviewSection {
    public readonly id = 'documentation';

    public render(): string {
        return sectionMarkup('DOCUMENTATION', [
            WebviewControls.setButton(`${this.id}.manual`, 'Manual'),
            WebviewControls.setButton(`${this.id}.wiki`, 'Wiki'),
            WebviewControls.setButton(`${this.id}.confluence`, 'Confluence')
        ].join(''));
    }

    public async handleAction(action: string): Promise<boolean> {
        const configuration = vscode.workspace.getConfiguration('gvhidra.documentation');
        const urls: Record<string, string> = {
            manual: configuration.get<string>('manualUrl', 'https://example.com/manual'),
            wiki: configuration.get<string>('wikiUrl', 'https://example.com/wiki'),
            confluence: CONFLUENCE_URL
        };
        const url = urls[action];
        if (!url) {
            return false;
        }

        await vscode.env.openExternal(vscode.Uri.parse(url));
        return true;
    }
}
