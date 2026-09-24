import { actionButton, sectionMarkup, WebviewSection } from '../WebviewSection';

export class GenaroSection extends WebviewSection {
    public readonly id = 'genaro';

    public render(): string {
        return sectionMarkup('GENARO', actionButton('Genaro', `${this.id}.placeholder`));
    }

    public async handleAction(_action: string): Promise<boolean> {
        return true;
    }
}
