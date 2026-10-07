export type WebviewIconName =
    | 'book'
    | 'bug'
    | 'check'
    | 'download'
    | 'external-link'
    | 'file'
    | 'folder'
    | 'history'
    | 'play'
    | 'refresh'
    | 'source-control'
    | 'sparkles'
    | 'tag'
    | 'trash'
    | 'tools';

const iconPaths: Record<WebviewIconName, string> = {
    book: '<path d="M2.5 2.5h4a2 2 0 0 1 2 2v9a2 2 0 0 0-2-2h-4zM13.5 2.5h-3a2 2 0 0 0-2 2v9a2 2 0 0 1 2-2h3z"/>',
    bug: '<path d="M5 5.5h6v4a3 3 0 0 1-6 0zM6.5 5.5v-1a1.5 1.5 0 0 1 3 0v1M2.5 6.5H5m6 0h2.5M2.5 10H5m6 0h2.5M4 3l1.5 1.5M12 3l-1.5 1.5M8 6v6"/>',
    check: '<path d="m3 8.5 3.2 3.2L13 4.9"/>',
    download: '<path d="M8 2v8m-3-3 3 3 3-3M3 13.5h10"/>',
    'external-link': '<path d="M9 3h4v4m0-4L7.5 8.5M7 4H3v9h9V9"/>',
    file: '<path d="M4 1.5h5l3 3V14H4zM9 1.5v3h3"/>',
    folder: '<path d="M1.5 4h5l1.5 1.5h6.5v7.5h-13z"/>',
    history: '<path d="M3.2 4.2A6 6 0 1 1 2 9m0-5v4h4M8 4.5V8l2.3 1.4"/>',
    play: '<path d="M5 2.5 13 8l-8 5.5z"/>',
    refresh: '<path d="M13 5V2l-1.7 1.7A5.5 5.5 0 1 0 13 9M13 2v3h-3"/>',
    'source-control': '<circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="13" r="1.5"/><path d="M5 4.5v4A4.5 4.5 0 0 0 9.5 13M11 11.5V7a2 2 0 0 0-2-2H7.5"/>',
    sparkles: '<path d="m8 1 .8 2.2L11 4l-2.2.8L8 7l-.8-2.2L5 4l2.2-.8zM12.5 8l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6zM4.5 8l1 2.5L8 11.5l-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>',
    tag: '<path d="M2 3h6.2L14 8.8 8.8 14 2 7.2z"/><circle cx="5.2" cy="6.2" r="1"/>',
    trash: '<path d="M3 4.5h10M6 4.5v-2h4v2M4.5 4.5l.7 9h5.6l.7-9M7 7v4M9 7v4"/>',
    tools: '<path d="M9.5 2.3a3.2 3.2 0 0 0-3.8 4.2l-4 4a1.4 1.4 0 0 0 2 2l4-4a3.2 3.2 0 0 0 4.2-3.8L10 6.6 8.4 5z"/>'
};

/** Renderiza un icono vectorial decorativo que hereda el color del control. */
export function renderWebviewIcon(name: WebviewIconName, className = ''): string {
    const classes = ['icon', className].filter(Boolean).join(' ');
    return `<svg class="${classes}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;
}
