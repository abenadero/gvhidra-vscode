import { WebviewControls } from '../../webview/components/WebviewControls';
import { sectionMarkup, WebviewSection } from '../WebviewSection';

export class GenaroSection extends WebviewSection {
    public readonly id = 'genaro';

    public render(): string {
        return sectionMarkup(
            'Genaro',
            WebviewControls.setButton(`${this.id}.placeholder`, 'Genaro', {
                variant: 'primary',
                icon: 'sparkles'
            }),
            { icon: 'sparkles' }
        );
    }

    public async handleAction(_action: string): Promise<boolean> {
        return true;
    }
}
