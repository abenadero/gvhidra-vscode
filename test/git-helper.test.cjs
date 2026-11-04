const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const { tmpdir } = os;
const path = require('node:path');
const { test, beforeEach } = require('node:test');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { createTaskHost } = require('./support/task-host.cjs');

const exec = promisify(execFile);
let terminals, warnings, errors, openedUrls, openedFolders, answers, testHome;
const taskHost = createTaskHost(execution => exec(execution.process, execution.args, {
    ...execution.options, timeout: 10000
}));

function fileUri(fsPath) {
    return { fsPath, scheme: 'file', toString: () => pathToFileURL(fsPath).toString() };
}

const vscode = {
    ...taskHost.api,
    Uri: {
        file: fileUri,
        joinPath: (uri, ...parts) => fileUri(path.join(uri.fsPath, ...parts)),
        parse: value => ({ toString: () => value })
    },
    window: {
        showWarningMessage: async message => { warnings.push(message); },
        showErrorMessage: async message => { errors.push(message); },
        showInputBox: async () => answers.shift(),
        createTerminal: options => {
            const terminal = { options, show() {}, sendText(command) { this.command = command; } };
            terminals.push(terminal);
            return terminal;
        }
    },
    workspace: { fs: { stat: uri => stat(uri.fsPath) }, workspaceFolders: [], findFiles: async () => [] },
    env: { openExternal: async uri => { openedUrls.push(uri.toString()); return true; } },
    commands: { executeCommand: async (command, uri) => {
        if (command === 'vscode.openFolder') openedFolders.push(uri);
    } }
};

const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === 'node:os') return { ...os, homedir: () => testHome };
    return name === 'vscode' ? vscode : originalLoad.call(this, name, ...args);
};
const { GITHelper } = require('../out/sections/version-control/GITHelper');
const { VersionControlSection } = require('../out/sections/version-control/VersionControlSection');
Module._load = originalLoad;

beforeEach(async t => {
    testHome = await mkdtemp(path.join(tmpdir(), 'gvhidra-git-home-'));
    const directory = testHome;
    t.after(() => rm(directory, { recursive: true, force: true }));
    terminals = [];
    warnings = [];
    errors = [];
    openedUrls = [];
    openedFolders = [];
    answers = [];
    taskHost.reset();
    vscode.workspace.workspaceFolders = [];
    vscode.window.activeTextEditor = undefined;
    vscode.workspace.getWorkspaceFolder = () => undefined;
});

function makeContext() {
    const values = new Map();
    return { workspaceState: { get: key => values.get(key), update: async (key, value) => { values.set(key, value); } } };
}

function helperAt(root, context = makeContext()) {
    const helper = new GITHelper(context, () => {});
    helper.setRepositoryRoot(fileUri(root));
    return helper;
}

async function git(cwd, ...args) {
    const { stdout } = await exec('git', args, { cwd, timeout: 10000 });
    return stdout.trim();
}

async function commit(cwd, filename, contents) {
    await writeFile(path.join(cwd, filename), contents);
    await git(cwd, 'add', '--', filename);
    await git(cwd, '-c', 'user.name=GVHidra Test', '-c', 'user.email=test@example.com',
        '-c', 'commit.gpgSign=false', 'commit', '-m', filename);
    return git(cwd, 'rev-parse', 'HEAD');
}

async function fixture(t) {
    const root = await mkdtemp(path.join(tmpdir(), "gvhidra git's "));
    t.after(() => rm(root, { recursive: true, force: true }));
    const origin = path.join(root, 'origin.git');
    const selected = path.join(root, "selected repo's.git");
    const local = path.join(root, 'local');
    await git(root, 'init', '--bare', '--initial-branch=main', origin);
    await git(root, 'clone', origin, local);
    await git(local, 'config', 'user.name', 'GVHidra Test');
    await git(local, 'config', 'user.email', 'test@example.com');
    await git(local, 'config', 'tag.gpgSign', 'false');
    await commit(local, 'initial.txt', 'initial\n');
    await git(local, 'push', 'origin', 'main');
    await git(root, 'clone', '--bare', origin, selected);
    const publisher = path.join(root, 'publisher');
    await git(root, 'clone', selected, publisher);
    const remoteHead = await commit(publisher, 'remote.txt', 'selected URL\n');
    await git(publisher, 'push', 'origin', 'main');
    return { root, origin, selected, local, publisher, remoteHead };
}

async function runLastTerminal() {
    assert.ok(terminals.length, 'The action must open a terminal');
    const terminal = terminals.at(-1);
    return exec('/bin/sh', ['-c', terminal.command], { cwd: terminal.options.cwd.fsPath, timeout: 10000 });
}

test('renders an editable URL, the five requested controls and no credentials or history', async t => {
    const f = await fixture(t);
    const helper = helperAt(f.local);
    const html = await helper.render();
    assert.ok(html.includes(f.origin.replace(/'/g, '&#39;')));
    assert.equal((html.match(/data-input-id="git-repository-url"/g) || []).length, 5);
    assert.doesNotMatch(html, /readonly|credentials|history/);
    assert.equal(await helper.handleAction('history', f.selected), false);
    assert.equal(await helper.handleAction('toString', f.selected), false);
});

test('the edited URL survives rendering and remains separate for each repository', async t => {
    const f = await fixture(t);
    const context = makeContext();
    const helper = helperAt(f.local, context);
    await helper.handleAction('pipelines', ' https://gitlab.example.com/other/project.git/ ');
    assert.match(await helper.render(), /value="https:\/\/gitlab.example.com\/other\/project.git\/"/);
    assert.match(await helperAt(f.local, context).render(), /other\/project/);
    helper.setRepositoryRoot(fileUri(f.publisher));
    assert.ok((await helper.render()).includes(f.selected.replace(/'/g, '&#39;')));
    assert.equal(await git(f.local, 'remote', 'get-url', 'origin'), f.origin);
});

test('clone downloads into the named project under HOME/gvhidra/gvhidradev/htdocs and opens it', async t => {
    const f = await fixture(t);
    const name = "Proyecto de prueba's";
    const clone = path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', name);
    answers = [` ${name} `];
    await helperAt(f.local).handleAction('clone', f.selected);
    assert.equal(taskHost.results[0].exitCode, 0, taskHost.results[0].error?.message);
    assert.equal(await git(clone, 'rev-parse', 'HEAD'), f.remoteHead);
    assert.equal(await git(clone, 'remote', 'get-url', 'origin'), f.selected);
    assert.equal(await readFile(path.join(clone, 'remote.txt'), 'utf8'), 'selected URL\n');
    assert.deepEqual(openedFolders.map(uri => uri.fsPath), [clone]);
    assert.equal(taskHost.listenerCount, 0);
});

test('clone rejects invalid project names and preserves an existing project folder', async () => {
    const helper = helperAt(testHome);
    for (const name of ['', ' ', '.', '..', '../outside', '/absolute', 'nested/project', 'nested\\project', 'bad\nname']) {
        answers = [name];
        await helper.handleAction('clone', '/unused.git');
    }
    const existing = path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', 'existing');
    await mkdir(existing, { recursive: true });
    await writeFile(path.join(existing, 'keep.txt'), 'keep me');
    answers = ['existing'];
    await helper.handleAction('clone', '/unused.git');
    assert.equal(await readFile(path.join(existing, 'keep.txt'), 'utf8'), 'keep me');
    assert.equal(taskHost.runs.length, 0);
    assert.equal(openedFolders.length, 0);
    assert.match(errors.at(-1), /Ya existe/);
});

test('a failed clone never opens the folder and removes the empty reserved destination', async () => {
    answers = ['failed-project'];
    await helperAt(testHome).handleAction('clone', path.join(testHome, 'missing.git'));
    assert.notEqual(taskHost.results[0].exitCode, 0);
    assert.equal(openedFolders.length, 0);
    assert.match(errors.at(-1), /no ha finalizado correctamente/);
    await assert.rejects(stat(path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', 'failed-project')), { code: 'ENOENT' });
    assert.equal(taskHost.listenerCount, 0);
});

test('task startup failures and cancellation before process start do not open a project', async () => {
    const helper = helperAt(testHome);
    taskHost.startError = new Error('Unable to start task');
    answers = ['not-started'];
    await helper.handleAction('clone', '/unused.git');
    assert.match(errors.at(-1), /No se pudo iniciar/);
    assert.equal(taskHost.listenerCount, 0);
    taskHost.startError = undefined;
    taskHost.endWithoutProcess = true;
    answers = ['cancelled-project'];
    await helper.handleAction('clone', '/unused.git');
    assert.equal(openedFolders.length, 0);
    assert.equal(taskHost.listenerCount, 0);
    for (const name of ['not-started', 'cancelled-project']) {
        await assert.rejects(stat(path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', name)), { code: 'ENOENT' });
    }
});

test('clone waits for its own successful task completion before opening the folder', async t => {
    const f = await fixture(t);
    let started, release;
    const start = new Promise(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    taskHost.beforeRun = async () => { started(); await pending; };
    answers = ['wait-for-clone'];
    const download = helperAt(f.local).handleAction('clone', f.selected);
    await start;
    const openedBeforeCompletion = openedFolders.length;
    taskHost.emitProcessEnd({ execution: { task: { definition: { runId: 'other-task' } } }, exitCode: 0 });
    await Promise.resolve();
    const openedAfterUnrelatedTask = openedFolders.length;
    release();
    await download;
    assert.equal(openedBeforeCompletion, 0);
    assert.equal(openedAfterUnrelatedTask, 0);
    assert.equal(openedFolders.length, 1);
    assert.equal(taskHost.listenerCount, 0);
});

test('update uses the selected URL even when origin points elsewhere, and rejects divergence', async t => {
    const f = await fixture(t);
    const helper = helperAt(f.local);
    // A tag with the same name must not confuse the current branch lookup.
    await git(f.local, 'tag', 'main');
    await helper.handleAction('update', f.selected);
    await runLastTerminal();
    assert.equal(await git(f.local, 'rev-parse', 'HEAD'), f.remoteHead);
    assert.notEqual(await git(f.origin, 'rev-parse', 'main'), f.remoteHead);
    const localHead = await commit(f.local, 'local-only.txt', 'local\n');
    await commit(f.publisher, 'remote-only.txt', 'remote\n');
    await git(f.publisher, 'push', 'origin', 'main');
    await helper.handleAction('update', f.selected);
    await assert.rejects(runLastTerminal());
    assert.equal(await git(f.local, 'rev-parse', 'HEAD'), localHead);
});

test('switch branch fetches the named branch from the URL and updates an existing local branch', async t => {
    const f = await fixture(t);
    await git(f.publisher, 'switch', '-c', 'feature/from-url');
    const firstHead = await commit(f.publisher, 'feature.txt', 'first\n');
    await git(f.publisher, 'push', 'origin', 'feature/from-url');
    const helper = helperAt(f.local);
    answers = ['feature/from-url'];
    await helper.handleAction('switchBranch', f.selected);
    await runLastTerminal();
    assert.equal(await git(f.local, 'branch', '--show-current'), 'feature/from-url');
    assert.equal(await git(f.local, 'rev-parse', 'HEAD'), firstHead);
    const nextHead = await commit(f.publisher, 'feature.txt', 'second\n');
    await git(f.publisher, 'push', 'origin', 'feature/from-url');
    await git(f.local, 'switch', 'main');
    answers = ['feature/from-url'];
    await helper.handleAction('switchBranch', f.selected);
    await runLastTerminal();
    assert.equal(await git(f.local, 'rev-parse', 'HEAD'), nextHead);
    // A missing remote branch must not switch to a similarly named local one.
    await git(f.local, 'branch', 'local-only');
    answers = ['local-only'];
    await helper.handleAction('switchBranch', f.selected);
    await assert.rejects(runLastTerminal());
    assert.equal(await git(f.local, 'branch', '--show-current'), 'feature/from-url');
});

test('tag is created from the remote source and only that tag is published to the URL', async t => {
    const f = await fixture(t);
    await git(f.local, 'tag', '-a', 'unrelated', '-m', 'Must stay local');
    await git(f.local, 'config', 'push.followTags', 'true');
    answers = ['release/v1', 'HEAD', "Release's $(touch NEVER_EXECUTED)"];
    const helper = helperAt(f.local);
    await helper.handleAction('createTag', f.selected);
    await runLastTerminal();
    assert.equal(await git(f.selected, 'rev-parse', 'release/v1^{commit}'), f.remoteHead);
    assert.notEqual(await git(f.local, 'rev-parse', 'HEAD'), f.remoteHead);
    assert.equal(await git(f.selected, 'tag', '--list'), 'release/v1');
    assert.equal(await git(f.origin, 'tag', '--list'), '');
    assert.equal(await git(f.selected, 'for-each-ref', '--format=%(contents)', 'refs/tags/release/v1'),
        "Release's $(touch NEVER_EXECUTED)");
    await assert.rejects(stat(path.join(f.local, 'NEVER_EXECUTED')));
    // An existing tag must stop the command before publication to another URL.
    answers = ['release/v1', 'HEAD', 'Duplicate'];
    await helper.handleAction('createTag', f.origin);
    await assert.rejects(runLastTerminal());
    assert.equal(await git(f.origin, 'tag', '--list'), '');
});

test('pipeline opens the project web URL for HTTPS, SCP and SSH clone URLs', async () => {
    const helper = helperAt('/tmp');
    const cases = [
        ['https://gitlab.example.com/group/project', 'https://gitlab.example.com/group/project/-/pipelines'],
        ['https://gitlab.example.com/group/project.git/', 'https://gitlab.example.com/group/project/-/pipelines'],
        ['http://gitlab.example.com:8080/group/project.git?x=1#readme', 'http://gitlab.example.com:8080/group/project/-/pipelines'],
        ['https://user:secret@gitlab.example.com/group/project.git', 'https://gitlab.example.com/group/project/-/pipelines'],
        ['git@gitlab.example.com:group/subgroup/project.git', 'https://gitlab.example.com/group/subgroup/project/-/pipelines'],
        ['ssh://git@gitlab.example.com:2222/group/project.git', 'https://gitlab.example.com/group/project/-/pipelines']
    ];
    for (const [input, expected] of cases) {
        await helper.handleAction('pipelines', input);
        assert.equal(openedUrls.at(-1), expected);
    }
    const count = openedUrls.length;
    for (const input of ['/tmp/local.git', 'file:///tmp/local.git', 'https://gitlab.example.com/']) {
        await helper.handleAction('pipelines', input);
    }
    assert.equal(openedUrls.length, count);
    assert.equal(terminals.length, 0);
});

test('empty URLs, invalid refs and cancelled prompts do not run commands', async () => {
    const helper = helperAt('/tmp');
    for (const action of ['clone', 'update', 'createTag', 'switchBranch', 'pipelines']) {
        await helper.handleAction(action, ' ');
    }
    for (const branch of ['', '-force', 'HEAD', '../bad', 'bad:ref', 'bad name', 'bad\nname']) {
        answers = [branch];
        await helper.handleAction('switchBranch', 'https://gitlab.example.com/group/project.git');
    }
    await helper.handleAction('clone', 'https://gitlab.example.com/group/project.git');
    answers = [undefined];
    await helper.handleAction('createTag', 'https://gitlab.example.com/group/project.git');
    answers = ['valid-tag', undefined];
    await helper.handleAction('createTag', 'https://gitlab.example.com/group/project.git');
    answers = ['valid-tag', 'HEAD', undefined];
    await helper.handleAction('createTag', 'https://gitlab.example.com/group/project.git');
    assert.equal(terminals.length, 0);
    assert.equal(openedUrls.length, 0);
});

test('detached HEAD does not update', async t => {
    const f = await fixture(t);
    await git(f.local, 'switch', '--detach');
    await helperAt(f.local).handleAction('update', f.selected);
    assert.equal(terminals.length, 0);
    assert.match(warnings.at(-1), /Selecciona una rama/);
});

test('coordinator forwards the URL and uses the detected Git root in a multi-root workspace', async t => {
    const f = await fixture(t);
    const empty = path.join(f.root, 'empty');
    await mkdir(empty);
    const folders = [empty, f.local].map(fsPath => ({ uri: fileUri(fsPath) }));
    vscode.workspace.workspaceFolders = folders;
    vscode.window.activeTextEditor = { document: { uri: fileUri(path.join(empty, 'file.txt')) } };
    vscode.workspace.getWorkspaceFolder = () => folders[0];
    const section = new VersionControlSection(makeContext(), () => {});
    assert.match(await section.render(), /Clonar desde URL/);
    assert.equal(await section.handleAction('svn.update', f.selected), false);
    assert.equal(await section.handleAction('git.update', f.selected), true);
    assert.equal(terminals.at(-1).options.cwd.fsPath, f.local);
    await runLastTerminal();
    assert.equal(await git(f.local, 'rev-parse', 'HEAD'), f.remoteHead);
});

test('a plain folder shows an empty URL and both download buttons, allowing a Git clone', async t => {
    const f = await fixture(t);
    const empty = path.join(f.root, 'empty');
    await mkdir(empty);
    const context = makeContext();
    const section = new VersionControlSection(context, () => {});
    // A previously detected repository must not remain the context for this download.
    vscode.workspace.workspaceFolders = [{ uri: fileUri(f.local) }];
    assert.match(await section.render(), /Git active/);
    vscode.workspace.workspaceFolders = [{ uri: fileUri(empty) }];
    const html = await section.render();
    assert.match(html, /id="repository-url"\s+type="text"\s+value=""\s+placeholder="https:\/\//);
    assert.match(html, /SVN checkout/);
    assert.match(html, /GIT clone/);
    assert.equal((html.match(/data-input-id="repository-url"/g) || []).length, 2);
    assert.equal((html.match(/<button\b/g) || []).length, 2);
    for (const action of ['git.update', 'git.createTag', 'git.switchBranch', 'svn.update', 'svn.commit', 'svn.resetCredentials']) {
        assert.equal(await section.handleAction(action, f.selected), false);
    }
    for (const action of ['git.clone', 'svn.checkout']) {
        assert.equal(await section.handleAction(action, ' '), true);
    }
    assert.equal(taskHost.runs.length, 0);
    answers = ['clone-from-plain-folder'];
    assert.equal(await section.handleAction('git.clone', f.selected), true);
    const clone = path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', 'clone-from-plain-folder');
    assert.equal(await git(clone, 'rev-parse', 'HEAD'), f.remoteHead);
    assert.deepEqual(openedFolders.map(uri => uri.fsPath), [clone]);
    assert.equal(context.workspaceState.get(`gvhidra.gitRepository.${fileUri(empty).toString()}`), f.selected);
});

test('an empty .git in an opened child folder never selects the parent repository or URL', async t => {
    const f = await fixture(t);
    const child = path.join(f.local, 'htdocs', 'crc');
    await mkdir(path.join(child, '.git'), { recursive: true });
    // Git itself falls back to the parent, reproducing the misleading URL in the UI.
    assert.equal(await git(child, 'rev-parse', '--show-toplevel'), f.local);
    vscode.workspace.workspaceFolders = [{ uri: fileUri(child) }];
    const section = new VersionControlSection(makeContext(), () => {});
    const html = await section.render();
    assert.match(html, /Not detected/);
    assert.match(html, /id="repository-url"\s+type="text"\s+value=""/);
    assert.doesNotMatch(html, /Git active/);
    assert.equal(await section.handleAction('git.update', f.selected), false);
    assert.equal(terminals.length, 0);
});

test('a Git worktree with a .git file remains a valid repository root', async t => {
    const f = await fixture(t);
    const worktree = path.join(f.root, 'worktree');
    await git(f.local, 'worktree', 'add', '-b', 'worktree-test', worktree);
    assert.equal((await stat(path.join(worktree, '.git'))).isFile(), true);
    vscode.workspace.workspaceFolders = [{ uri: fileUri(worktree) }];
    const html = await new VersionControlSection(makeContext(), () => {}).render();
    assert.match(html, /Git active/);
    assert.ok(html.includes(f.origin.replace(/'/g, '&#39;')));
});
