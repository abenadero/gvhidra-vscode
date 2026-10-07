import * as vscode from 'vscode';
import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

const CONFLUENCE_URL = 'https://confluence.gva.es/spaces/gvhidra/pages/723550873/%C2%BFQu%C3%A9+es+gvHIDRA';
const NEXUS_URL = 'https://nexus.gva.es/service/rest/repository/browse/public/es/gva/gvhidra/';

export class DocumentationSection extends WebviewSection {
    public readonly id = 'documentation';

    public render(): string {
        return sectionMarkup('Documentation', [
            WebviewControls.setButton(`${this.id}.manual`, 'Manual', {
                variant: 'ghost',
                icon: 'external-link'
            }),
            WebviewControls.setButton(`${this.id}.wiki`, 'Wiki', {
                variant: 'ghost',
                icon: 'external-link'
            }),
            WebviewControls.setButton(`${this.id}.confluence`, 'Confluence', {
                variant: 'ghost',
                icon: 'external-link'
            }),
            WebviewControls.setButton(`${this.id}.nexus`, 'Nexus', {
                variant: 'ghost',
                icon: 'external-link'
            })
        ].join(''), { icon: 'book' });
    }

    public async handleAction(action: string): Promise<boolean> {
        const configuration = vscode.workspace.getConfiguration('gvhidra.documentation');
        const urls: Record<string, string> = {
            manual: configuration.get<string>('manualUrl', 'https://example.com/manual'),
            wiki: configuration.get<string>('wikiUrl', 'https://example.com/wiki'),
            confluence: CONFLUENCE_URL,
            nexus: NEXUS_URL
        };
        const url = urls[action];
        if (!url) {
            return false;
        }

        await vscode.env.openExternal(vscode.Uri.parse(url));
        return true;
    }
}
