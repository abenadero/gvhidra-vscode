// Requires svn and svnadmin. All repositories, configuration and credentials are temporary.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach } = require('node:test');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { createTaskHost } = require('./support/task-host.cjs');

const exec = promisify(childProcess.execFile);
const useDefault = Symbol('Use the input default value');
let sandbox, testHome, configDirectory;
let terminals, warnings, errors, information, inputs, answers, confirmations, commands, openedFolders, nestedDatabases;
const taskHost = createTaskHost(execution => {
    const args = execution.process === 'svn'
        ? ['--config-dir', configDirectory, ...execution.args] : execution.args;
    return exec(execution.process, args, { ...execution.options, timeout: 10000 });
});

function fileUri(fsPath) {
    return { fsPath, scheme: 'file', toString: () => pathToFileURL(fsPath).toString() };
}

const vscode = {
    ...taskHost.api,
    Uri: {
        file: fileUri,
        joinPath: (uri, ...parts) => fileUri(path.join(uri.fsPath, ...parts))
    },
    window: {
        showWarningMessage: async (message, options) => {
            warnings.push({ message, options });
            return options?.modal ? confirmations.shift() : undefined;
        },
        showErrorMessage: async message => { errors.push(message); },
        showInformationMessage: async message => { information.push(message); },
        showInputBox: async options => {
            inputs.push(options);
            const answer = answers.shift();
            return answer === useDefault ? options.value : answer;
        },
        createTerminal: options => {
            const terminal = { options, show() {}, sendText(command) { this.command = command; } };
            terminals.push(terminal);
            return terminal;
        }
    },
    workspace: {
        fs: { stat: uri => stat(uri.fsPath) },
        workspaceFolders: [],
        findFiles: async () => nestedDatabases
    },
    commands: { executeCommand: async (command, uri) => {
        commands.push(command);
        if (command === 'vscode.openFolder') openedFolders.push(uri);
    } }
};

// Isolate both the helper's svn info process and its credential files without changing HOME.
function isolatedExecFile(command, args, options, callback) {
    const isolatedArgs = command === 'svn' ? ['--config-dir', configDirectory, ...args] : args;
    return childProcess.execFile(command, isolatedArgs, options, callback);
}
isolatedExecFile[promisify.custom] = (command, args, options) => {
    const isolatedArgs = command === 'svn' ? ['--config-dir', configDirectory, ...args] : args;
    return exec(command, isolatedArgs, options);
};

const originalLoad = Module._load;
let SVNHelper, VersionControlSection;
try {
    Module._load = function (name, ...args) {
        if (name === 'vscode') return vscode;
        if (name === 'node:os') return { ...os, homedir: () => testHome };
        if (name === 'node:child_process') return { ...childProcess, execFile: isolatedExecFile };
        return originalLoad.call(this, name, ...args);
    };
    ({ SVNHelper } = require('../out/sections/version-control/SVNHelper'));
    ({ VersionControlSection } = require('../out/sections/version-control/VersionControlSection'));
} finally {
    Module._load = originalLoad;
}

beforeEach(async t => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), "gvhidra svn's "));
    const testDirectory = sandbox;
    t.after(() => rm(testDirectory, { recursive: true, force: true }));
    testHome = path.join(sandbox, 'home');
    configDirectory = path.join(sandbox, 'svn-config');
    await mkdir(testHome);
    await mkdir(configDirectory);
    terminals = [];
    warnings = [];
    errors = [];
    information = [];
    inputs = [];
    answers = [];
    confirmations = [];
    commands = [];
    openedFolders = [];
    taskHost.reset();
    nestedDatabases = [];
    vscode.workspace.workspaceFolders = [];
    vscode.window.activeTextEditor = undefined;
    vscode.workspace.getWorkspaceFolder = uri => vscode.workspace.workspaceFolders.find(folder =>
        uri.fsPath === folder.uri.fsPath || uri.fsPath.startsWith(`${folder.uri.fsPath}${path.sep}`));
});

function makeContext() {
    const values = new Map();
    return { workspaceState: { get: key => values.get(key), update: async (key, value) => { values.set(key, value); } } };
}

function helperAt(root, context = makeContext()) {
    const helper = new SVNHelper(context, () => {});
    helper.setWorkingCopyRoot(fileUri(root));
    return helper;
}

function openFolder(root) {
    const folder = { uri: fileUri(root) };
    vscode.workspace.workspaceFolders = [folder];
    return folder;
}

async function svn(cwd, ...args) {
    const { stdout } = await exec('svn', ['--config-dir', configDirectory, ...args], { cwd, timeout: 10000 });
    return stdout.trim();
}

async function fixture() {
    const repository = path.join(sandbox, 'repository');
    await exec('svnadmin', ['create', repository], { timeout: 10000 });
    const url = pathToFileURL(repository).toString();
    const trunk = `${url}/trunk`;
    const branch = `${url}/branches/feature`;
    await svn(sandbox, 'mkdir', trunk, `${url}/branches`, `${url}/tags`, '-m', 'Initial layout');
    const local = path.join(sandbox, 'htdocs', 'department', "project's files");
    await mkdir(local, { recursive: true });
    await svn(sandbox, 'checkout', trunk, local);
    await writeFile(path.join(local, 'file.txt'), 'trunk\n');
    await svn(local, 'add', 'file.txt');
    await svn(local, 'commit', '-m', 'Initial file');
    await svn(sandbox, 'copy', trunk, branch, '-m', 'Create feature branch');
    const publisher = path.join(sandbox, 'publisher');
    await svn(sandbox, 'checkout', branch, publisher);
    await writeFile(path.join(publisher, 'file.txt'), 'from selected URL\n');
    await svn(publisher, 'commit', '-m', 'Feature content');
    openFolder(local);
    const credentialsFile = path.join(testHome, '.subversion', 'auth', 'department', "project's files", 'svn-credentials');
    return { repository, url, trunk, branch, local, publisher, credentialsFile };
}

async function runLastTerminal() {
    assert.ok(terminals.length, 'The action must open a terminal');
    const terminal = terminals.at(-1);
    // Apply the same isolated SVN configuration to the real commands sent to the terminal.
    const command = 'svn() { command svn --config-dir "$GVHIDRA_SVN_TEST_CONFIG" "$@"; }\n' + terminal.command;
    return exec('/bin/sh', ['-c', command], {
        cwd: terminal.options.cwd.fsPath,
        env: { ...process.env, GVHIDRA_SVN_TEST_CONFIG: configDirectory },
        timeout: 10000
    });
}

test('renders the working-copy URL, editable repository input and SVN controls', async () => {
    const f = await fixture();
    const helper = helperAt(f.local);
    const html = await helper.render();
    assert.ok(html.includes(f.trunk.replace(/'/g, '&#39;')));
    assert.match(html, /id="svn-repository-url"/);
    assert.doesNotMatch(html, /readonly/);
    for (const action of ['checkout', 'update', 'commit', 'createTag', 'manageProjectCredentials', 'resetCredentials', 'history', 'sourceControl']) {
        assert.ok(html.includes(`data-command="version-control.svn.${action}"`));
    }
    assert.equal(await helper.handleAction('unknownAction', f.trunk), false);
});

test('checkout downloads into the named htdocs project, stores its credentials and opens it', async () => {
    const f = await fixture();
    const name = "Checkout de prueba's";
    const destination = path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', name);
    answers = [` ${name} `, 'demo-user', "password's=literal"];
    await helperAt(f.local).handleAction('checkout', ` ${f.branch} `);
    assert.equal(taskHost.results[0].exitCode, 0, taskHost.results[0].error?.message);
    assert.equal(await svn(destination, 'info', '--show-item', 'url'), f.branch);
    assert.equal(await readFile(path.join(destination, 'file.txt'), 'utf8'), 'from selected URL\n');
    const credentials = path.join(testHome, '.subversion', 'auth', name, 'svn-credentials');
    assert.equal(await readFile(credentials, 'utf8'), "username=demo-user\npassword=password's=literal\n");
    assert.equal((await stat(credentials)).mode & 0o777, 0o600);
    assert.equal(inputs[2].password, true);
    await assert.rejects(stat(f.credentialsFile), { code: 'ENOENT' });
    assert.deepEqual(openedFolders.map(uri => uri.fsPath), [destination]);
    assert.equal(taskHost.listenerCount, 0);
});

test('checkout rejects invalid project names and preserves an existing destination', async () => {
    const helper = helperAt(sandbox);
    for (const name of ['', '..', '../outside', '/absolute', 'nested/project', 'nested\\project', 'bad\nname']) {
        answers = [name];
        await helper.handleAction('checkout', 'file:///unused/trunk');
    }
    const destination = path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', 'existing');
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'keep.txt'), 'keep me');
    answers = ['existing'];
    await helper.handleAction('checkout', 'file:///unused/trunk');
    assert.equal(await readFile(path.join(destination, 'keep.txt'), 'utf8'), 'keep me');
    assert.equal(taskHost.runs.length, 0);
    assert.equal(openedFolders.length, 0);
    assert.match(errors.at(-1), /Ya existe/);
    await assert.rejects(stat(path.join(testHome, '.subversion')), { code: 'ENOENT' });
});

test('failed checkout does not open the project or remove files from a partial download', async () => {
    const f = await fixture();
    const destination = path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', 'failed-checkout');
    answers = ['failed-checkout', 'demo-user', 'demo-password'];
    taskHost.beforeRun = () => writeFile(path.join(destination, 'partial.txt'), 'keep partial data');
    await helperAt(f.local).handleAction('checkout', `${f.url}/missing`);
    assert.notEqual(taskHost.results[0].exitCode, 0);
    assert.equal(openedFolders.length, 0);
    assert.match(errors.at(-1), /no ha finalizado correctamente/);
    assert.equal(await readFile(path.join(destination, 'partial.txt'), 'utf8'), 'keep partial data');
    assert.equal(await svn(f.local, 'info', '--show-item', 'url'), f.trunk);
    assert.equal(taskHost.listenerCount, 0);
});

test('update switches the working copy to the entered branch URL', async () => {
    const f = await fixture();
    await helperAt(f.local).handleAction('update', f.branch);
    await runLastTerminal();
    assert.equal(await svn(f.local, 'info', '--show-item', 'url'), f.branch);
    assert.equal(await readFile(path.join(f.local, 'file.txt'), 'utf8'), 'from selected URL\n');
    assert.ok(warnings.some(warning => warning.message.includes('No se han almacenado credenciales')));
});

test('commit publishes local changes only when the working copy matches the URL', async () => {
    const f = await fixture();
    const helper = helperAt(f.local);
    await writeFile(path.join(f.local, 'file.txt'), 'local change\n');
    const message = "Commit's $(touch NEVER_EXECUTED)";
    answers = [message];
    await helper.handleAction('commit', ` ${f.trunk}/ `);
    await runLastTerminal();
    assert.equal(await svn(sandbox, 'cat', `${f.trunk}/file.txt`), 'local change');
    assert.ok((await svn(sandbox, 'log', '-l', '1', f.trunk)).includes(message));
    await assert.rejects(stat(path.join(f.local, 'NEVER_EXECUTED')));
    const terminalCount = terminals.length;
    const promptCount = inputs.length;
    const revision = await svn(sandbox, 'info', '--show-item', 'revision', f.url);
    await helper.handleAction('commit', f.branch);
    assert.equal(terminals.length, terminalCount);
    assert.equal(inputs.length, promptCount);
    assert.equal(await svn(sandbox, 'info', '--show-item', 'revision', f.url), revision);
    assert.ok(warnings.some(warning => warning.message.includes('La copia de trabajo corresponde')));
});

test('create tag copies the chosen remote URL, independently of local changes', async () => {
    const f = await fixture();
    await writeFile(path.join(f.local, 'file.txt'), 'uncommitted local change\n');
    const message = "Release's $(touch NEVER_EXECUTED)";
    answers = ['release-1', useDefault, message];
    const helper = helperAt(f.local);
    await helper.handleAction('createTag', f.branch);
    const tagUrl = `${f.url}/tags/release-1`;
    assert.equal(inputs[1].value, tagUrl);
    await runLastTerminal();
    assert.equal(await svn(sandbox, 'cat', `${tagUrl}/file.txt`), 'from selected URL');
    assert.ok((await svn(sandbox, 'log', '-l', '1', tagUrl)).includes(message));
    assert.equal(await readFile(path.join(f.local, 'file.txt'), 'utf8'), 'uncommitted local change\n');
    await assert.rejects(stat(path.join(f.local, 'NEVER_EXECUTED')));
    assert.equal(await svn(sandbox, 'list', `${f.url}/tags`), 'release-1/');
});

test('history shows the active file log and rejects files outside the working copy', async () => {
    const f = await fixture();
    const helper = helperAt(f.local);
    vscode.window.activeTextEditor = { document: { uri: fileUri(path.join(f.local, 'file.txt')) } };
    await helper.handleAction('history');
    const { stdout } = await runLastTerminal();
    assert.ok(stdout.includes('Initial file'));
    const count = terminals.length;
    vscode.window.activeTextEditor = { document: { uri: fileUri(path.join(`${f.local}-other`, 'file.txt')) } };
    await helper.handleAction('history');
    assert.equal(terminals.length, count);
    assert.ok(warnings.some(warning => warning.message.includes('Abre un fichero del proyecto')));
});

test('saved credentials are private, separated per project and reused by update', async () => {
    const f = await fixture();
    const helper = helperAt(f.local);
    answers = ['demo-user', "password's=with=equals"];
    await helper.handleAction('manageProjectCredentials', f.local);
    const content = "username=demo-user\npassword=password's=with=equals\n";
    assert.equal(await readFile(f.credentialsFile, 'utf8'), content);
    assert.equal((await stat(f.credentialsFile)).mode & 0o777, 0o600);
    warnings = [];
    await helper.handleAction('update', f.branch);
    assert.ok(terminals.at(-1).command.includes('--non-interactive --no-auth-cache'));
    assert.equal(warnings.length, 0);
    await runLastTerminal();
    assert.equal(await svn(f.local, 'info', '--show-item', 'url'), f.branch);
    const other = path.join(sandbox, 'htdocs', 'department', 'other-project');
    await mkdir(other);
    openFolder(other);
    answers = ['other-user', 'other-password'];
    await helper.handleAction('manageProjectCredentials', other);
    assert.equal(await readFile(f.credentialsFile, 'utf8'), content);
    const otherFile = path.join(testHome, '.subversion', 'auth', 'department', 'other-project', 'svn-credentials');
    assert.equal(await readFile(otherFile, 'utf8'), 'username=other-user\npassword=other-password\n');
});

test('credential reset requires confirmation and removes only the isolated authentication folder', async () => {
    const f = await fixture();
    const helper = helperAt(f.local);
    answers = ['demo-user', 'demo-password'];
    await helper.handleAction('manageProjectCredentials', f.local);
    const configFile = path.join(testHome, '.subversion', 'config');
    await writeFile(configFile, 'keep this configuration');
    await helper.handleAction('resetCredentials');
    assert.equal((await stat(f.credentialsFile)).isFile(), true);
    assert.equal(warnings.at(-1).options.modal, true);
    confirmations = ['Resetear credenciales'];
    await helper.handleAction('resetCredentials');
    await assert.rejects(stat(path.join(testHome, '.subversion', 'auth')), { code: 'ENOENT' });
    assert.equal(await readFile(configFile, 'utf8'), 'keep this configuration');
    assert.ok(information.some(message => message.includes('se han reseteado')));
});

test('credentials reject missing, unopened or unidentified project folders', async () => {
    const helper = new SVNHelper(makeContext(), () => {});
    await helper.handleAction('manageProjectCredentials');
    await helper.handleAction('manageProjectCredentials', path.join(sandbox, 'htdocs', 'unopened'));
    openFolder(sandbox);
    await helper.handleAction('manageProjectCredentials', sandbox);
    assert.equal(inputs.length, 0);
    assert.equal(terminals.length, 0);
    assert.equal(errors.length, 3);
    await assert.rejects(stat(path.join(testHome, '.subversion')), { code: 'ENOENT' });
});

test('empty URLs and cancelled prompts leave the working copy and repository unchanged', async () => {
    const f = await fixture();
    const helper = helperAt(f.local);
    const revision = await svn(sandbox, 'info', '--show-item', 'revision', f.url);
    for (const action of ['checkout', 'update', 'commit', 'createTag']) {
        await helper.handleAction(action, ' ');
    }
    for (const cancelled of [[undefined], ['cancelled-user', undefined], ['cancelled-password', 'demo-user', undefined]]) {
        answers = cancelled;
        await helper.handleAction('checkout', f.trunk);
    }
    for (const name of ['cancelled-user', 'cancelled-password']) {
        await assert.rejects(stat(path.join(testHome, 'gvhidra', 'gvhidradev', 'htdocs', name)), { code: 'ENOENT' });
    }
    await helper.handleAction('commit', f.trunk);
    for (const cancelled of [[undefined], ['release-1', undefined], ['release-1', useDefault, undefined]]) {
        answers = cancelled;
        await helper.handleAction('createTag', f.trunk);
    }
    assert.equal(terminals.length, 0);
    assert.equal(taskHost.runs.length, 0);
    assert.equal(openedFolders.length, 0);
    assert.equal(await svn(sandbox, 'info', '--show-item', 'revision', f.url), revision);
    await assert.rejects(stat(f.credentialsFile), { code: 'ENOENT' });
});

test('Source Control opens the native VS Code view without needing a repository URL', async () => {
    const helper = new SVNHelper(makeContext(), () => {});
    assert.equal(await helper.handleAction('sourceControl'), true);
    assert.deepEqual(commands, ['workbench.view.scm']);
    assert.equal(terminals.length, 0);
    assert.equal(inputs.length, 0);
});

test('coordinator uses the nested SVN root of the active file and forwards the edited URL', async () => {
    const f = await fixture();
    openFolder(path.join(sandbox, 'htdocs'));
    vscode.window.activeTextEditor = { document: { uri: fileUri(path.join(f.local, 'file.txt')) } };
    const section = new VersionControlSection(makeContext(), () => {});
    assert.match(await section.render(), /SVN active/);
    assert.equal(await section.handleAction('git.update', f.branch), false);
    assert.equal(await section.handleAction('svn.update', f.branch), true);
    assert.equal(terminals.at(-1).options.cwd.fsPath, f.local);
    await runLastTerminal();
    assert.equal(await svn(f.local, 'info', '--show-item', 'url'), f.branch);
});

test('coordinator accepts a unique nested SVN working copy and avoids ambiguous choices', async () => {
    const f = await fixture();
    openFolder(sandbox);
    nestedDatabases = [fileUri(path.join(f.local, '.svn', 'wc.db'))];
    const section = new VersionControlSection(makeContext(), () => {});
    assert.match(await section.render(), /SVN active/);
    nestedDatabases.push(fileUri(path.join(f.publisher, '.svn', 'wc.db')));
    assert.match(await section.render(), /Not detected/);
    assert.equal(await section.handleAction('svn.update', f.branch), false);
    assert.equal(terminals.length, 0);
});
