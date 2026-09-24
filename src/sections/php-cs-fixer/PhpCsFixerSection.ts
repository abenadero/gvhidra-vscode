import { actionButton, sectionMarkup, WebviewSection } from '../WebviewSection';

export class PhpCsFixerSection extends WebviewSection {
    public readonly id = 'php-cs-fixer';

    public render(): string {
        return sectionMarkup('PHP CS FIXER', actionButton('PHP CS Fixer', `${this.id}.placeholder`));
    }

    public async handleAction(_action: string): Promise<boolean> {
        return true;
    }
}
