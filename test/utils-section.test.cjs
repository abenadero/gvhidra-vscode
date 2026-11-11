const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { beforeEach, test } = require('node:test');

let testHome, errors, information, opened, shown, progress, progressGate;
let failedReadPath, failedDeletePath, failedTruncatePath;
const vscode = {
    Uri: { file: fsPath => ({ fsPath, scheme: 'file' }) },
    ProgressLocation: { Notification: 15 },
    workspace: {
        openTextDocument: async uri => {
            const document = { uri, text: await fs.readFile(uri.fsPath, 'utf8') };
            opened.push(document);
            return document;
        }
    },
    window: {
        withProgress: async (options, task) => {
            progress.push(options);
            await progressGate;
            return task();
        },
        showTextDocument: async (document, options) => { shown.push({ document, options }); },
        showErrorMessage: async message => { errors.push(message); },
        showInformationMessage: async message => { information.push(message); }
    }
};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === 'vscode') return vscode;
    if (name === 'node:os') return { ...os, homedir: () => testHome };
    if (name === 'node:fs/promises') return {
        ...fs,
        readdir: async (directory, options) => {
            if (directory === failedReadPath) throw new Error(`EACCES: ${directory}`);
            return fs.readdir(directory, options);
        },
        unlink: async file => {
            if (file === failedDeletePath) throw new Error(`EACCES: ${file}`);
            return fs.unlink(file);
        },
        truncate: async (file, length) => {
            if (file === failedTruncatePath) throw new Error(`EACCES: ${file}`);
            return fs.truncate(file, length);
        }
    };
    return originalLoad.call(this, name, ...args);
};
const { UtilsSection } = require('../out/sections/utils/UtilsSection');
Module._load = originalLoad;

beforeEach(async t => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "gvhidra utils's "));
    const sandbox = testHome;
    t.after(() => fs.rm(sandbox, { recursive: true, force: true }));
    await fs.mkdir(path.join(testHome, 'gvhidra'));
    errors = [];
    information = [];
    opened = [];
    shown = [];
    progress = [];
    progressGate = undefined;
    failedReadPath = undefined;
    failedDeletePath = undefined;
    failedTruncatePath = undefined;
});

async function write(relative, text = 'test content') {
    const file = path.join(testHome, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return file;
}

test('deletes matching files recursively, including hidden directories, and preserves other files and symlinks', async () => {
    const removed = await Promise.all([
        write('gvhidra/file.php:Zone.Identifier'),
        write('gvhidra/nested/.hidden/file:Zone.Identifier'),
        write('gvhidra/directory:Zone.Identifier/child:Zone.Identifier'),
        write('gvhidra/.git/file:Zone.Identifier'),
        write('gvhidra/:Zone.Identifier'),
        write('gvhidra/a file\'s "$(touch NEVER_EXECUTED)`literal`\n:Zone.Identifier')
    ]);
    const preserved = await Promise.all([
        write('gvhidra/file.php'),
        write('gvhidra/file:Zone.Identifier.bak'),
        write('gvhidra/file:zone.identifier'),
        write('gvhidra/Zone.Identifier'),
        write('gvhidra/directory:Zone.Identifier/keep.txt'),
        write('outside/file:Zone.Identifier'),
        write('sibling:Zone.Identifier')
    ]);
    const directoryLink = path.join(testHome, 'gvhidra', 'external-directory');
    const fileLink = path.join(testHome, 'gvhidra', 'link:Zone.Identifier');
    await fs.symlink(path.join(testHome, 'outside'), directoryLink, 'dir');
    await fs.symlink(preserved[5], fileLink);

    const section = new UtilsSection();
    assert.equal(await section.handleAction('deleteZoneIdentifiers'), true);

    for (const file of removed) await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
    for (const file of preserved) assert.equal(await fs.readFile(file, 'utf8'), 'test content');
    assert.ok((await fs.lstat(directoryLink)).isSymbolicLink());
    assert.ok((await fs.lstat(fileLink)).isSymbolicLink());
    assert.ok((await fs.stat(path.join(testHome, 'gvhidra', 'directory:Zone.Identifier'))).isDirectory());
    assert.match(information[0], /Eliminados 6 ficheros/);
    assert.equal(errors.length, 0);
    assert.equal(progress.length, 1);

    await section.handleAction('deleteZoneIdentifiers');
    assert.match(information[1], /No se encontraron ficheros/);
});

test('skips every templates_c subtree, including unreadable directories, while cleaning similarly named directories', async () => {
    const ignored = await Promise.all([
        write('gvhidra/templates_c/file:Zone.Identifier'),
        write('gvhidra/project/templates_c/nested/file:Zone.Identifier'),
        write('gvhidra/.hidden/project/templates_c/file:Zone.Identifier')
    ]);
    failedReadPath = path.dirname(ignored[0]);
    const removed = await Promise.all([
        write('gvhidra/project/file:Zone.Identifier'),
        write('gvhidra/templates_c_backup/file:Zone.Identifier'),
        write('gvhidra/project/my_templates_c/file:Zone.Identifier')
    ]);

    await new UtilsSection().handleAction('deleteZoneIdentifiers');

    for (const file of ignored) assert.equal(await fs.readFile(file, 'utf8'), 'test content');
    for (const file of removed) await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    assert.equal(errors.length, 0);
    assert.equal(information.length, 1);
    assert.match(information[0], /Eliminados 3 ficheros/);
});

test('reports a missing root and releases the guard so the action can be retried', async () => {
    await fs.rmdir(path.join(testHome, 'gvhidra'));
    const section = new UtilsSection();
    await section.handleAction('deleteZoneIdentifiers');
    assert.match(errors[0], /ENOENT/);
    assert.equal(information.length, 0);

    const file = await write('gvhidra/file:Zone.Identifier');
    await section.handleAction('deleteZoneIdentifiers');
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    assert.match(information[0], /Eliminados 1 ficheros/);
});

test('does not traverse a symlink used as the gvhidra root', async () => {
    await fs.rmdir(path.join(testHome, 'gvhidra'));
    const file = await write('outside/file:Zone.Identifier');
    await fs.symlink(path.join(testHome, 'outside'), path.join(testHome, 'gvhidra'), 'dir');

    await new UtilsSection().handleAction('deleteZoneIdentifiers');
    assert.equal(await fs.readFile(file, 'utf8'), 'test content');
    assert.match(errors[0], /no es un directorio/);
    assert.equal(information.length, 0);
});

test('continues deleting accessible files and reports partial failures without announcing success', async () => {
    const unreadable = await write('gvhidra/unreadable/hidden:Zone.Identifier');
    failedReadPath = path.dirname(unreadable);
    failedDeletePath = await write('gvhidra/locked:Zone.Identifier');
    const deleted = await write('gvhidra/accessible/ok:Zone.Identifier');

    await new UtilsSection().handleAction('deleteZoneIdentifiers');

    await assert.rejects(fs.stat(deleted), { code: 'ENOENT' });
    assert.equal(await fs.readFile(unreadable, 'utf8'), 'test content');
    assert.equal(await fs.readFile(failedDeletePath, 'utf8'), 'test content');
    assert.equal(information.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Eliminados 1 ficheros/);
    assert.match(errors[0], /2 operaciones: EACCES/);
});

test('duplicate clicks do not start concurrent deletion runs', async () => {
    let release;
    progressGate = new Promise(resolve => { release = resolve; });
    const section = new UtilsSection();
    const pending = section.handleAction('deleteZoneIdentifiers');
    assert.equal(await section.handleAction('deleteZoneIdentifiers'), true);
    assert.equal(progress.length, 1);
    release();
    await pending;

    await section.handleAction('deleteZoneIdentifiers');
    assert.equal(progress.length, 2);
});

test('opens both PHP error logs in separate non-preview editor tabs', async () => {
    const php74 = await write('gvhidra/gvhidradev/logs/php74/error.log', 'PHP 7.4 error');
    const php84 = await write('gvhidra/gvhidradev/logs/php84/error.log', 'PHP 8.4 error');
    const section = new UtilsSection();

    assert.equal(await section.handleAction('openPhp74ErrorLog'), true);
    assert.equal(await section.handleAction('openPhp84ErrorLog'), true);
    assert.deepEqual(opened.map(document => document.uri.fsPath), [php74, php84]);
    assert.deepEqual(shown.map(entry => entry.document.text), ['PHP 7.4 error', 'PHP 8.4 error']);
    assert.ok(shown.every(entry => entry.options.preview === false));
    assert.equal(errors.length, 0);
});

test('missing PHP logs report their paths without opening or creating files', async () => {
    const section = new UtilsSection();
    for (const version of ['74', '84']) {
        await section.handleAction(`openPhp${version}ErrorLog`);
        const file = path.join(testHome, 'gvhidra', 'gvhidradev', 'logs', `php${version}`, 'error.log');
        assert.ok(errors.at(-1).includes(file));
        await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
    assert.equal(shown.length, 0);
    assert.equal(information.length, 0);
});

test('clears each PHP error log in place and allows an existing writer to keep logging', async () => {
    const section = new UtilsSection();
    const php74 = await write('gvhidra/gvhidradev/logs/php74/error.log', 'PHP 7.4 error');
    const php84 = await write('gvhidra/gvhidradev/logs/php84/error.log', 'PHP 8.4 error');
    const other = await write('gvhidra/gvhidradev/logs/php84/other.log', 'Other log');

    for (const [version, file] of [['74', php74], ['84', php84]]) {
        await fs.chmod(file, 0o640);
        const before = await fs.stat(file);
        const writer = await fs.open(file, 'a');
        try {
            assert.equal(await section.handleAction(`clearPhp${version}ErrorLog`), true);
            assert.equal(await fs.readFile(file, 'utf8'), '');
            const after = await fs.stat(file);
            assert.equal(after.ino, before.ino);
            assert.equal(after.mode, before.mode);

            await writer.writeFile('New PHP error\n');
            assert.equal(await fs.readFile(file, 'utf8'), 'New PHP error\n');
            assert.ok(information.at(-1).includes(file));
        } finally {
            await writer.close();
        }
        if (version === '74') assert.equal(await fs.readFile(php84, 'utf8'), 'PHP 8.4 error');
    }
    assert.equal(await fs.readFile(other, 'utf8'), 'Other log');
    assert.equal(information.length, 2);
    assert.equal(errors.length, 0);
    assert.equal(opened.length, 0);
});

test('clearing a missing PHP log reports an error without creating the file', async () => {
    const section = new UtilsSection();
    for (const version of ['74', '84']) {
        const file = path.join(testHome, 'gvhidra', 'gvhidradev', 'logs', `php${version}`, 'error.log');
        await fs.mkdir(path.dirname(file), { recursive: true });
        assert.equal(await section.handleAction(`clearPhp${version}ErrorLog`), true);
        assert.ok(errors.at(-1).includes(file));
        await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
    assert.equal(errors.length, 2);
    assert.equal(information.length, 0);
});

test('a failure to clear a PHP log preserves its contents and reports no success', async () => {
    const file = await write('gvhidra/gvhidradev/logs/php74/error.log', 'Keep this error');
    failedTruncatePath = file;
    const section = new UtilsSection();

    await section.handleAction('clearPhp74ErrorLog');

    assert.equal(await fs.readFile(file, 'utf8'), 'Keep this error');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /No se pudo vaciar .*EACCES/);
    assert.equal(information.length, 0);
});

test('unknown actions cannot select arbitrary files or deletion paths', async () => {
    const file = await write('outside/file:Zone.Identifier');
    const section = new UtilsSection();
    assert.equal(await section.handleAction('../../outside'), false);
    assert.equal(await section.handleAction('toString'), false);
    assert.equal(await section.handleAction('clearPhp../../outsideErrorLog'), false);
    assert.equal(await fs.readFile(file, 'utf8'), 'test content');
    assert.equal(opened.length, 0);
    assert.equal(progress.length, 0);
});
