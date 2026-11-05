const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const http = require('node:http');
const Module = require('node:module');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test, beforeEach } = require('node:test');
const { promisify } = require('node:util');

const exec = promisify(childProcess.execFile);
const marketplaceUrl = 'https://gitlab.laberit.com/am/ia/plugins/am-marketplace/codex.git';
let answers, prompts, errors, information, runs, runCommand, renderCount, sandbox;
const vscode = {
    ProgressLocation: { Notification: 15 },
    window: {
        withProgress: async (_options, task) => task(),
        showInputBox: async options => { prompts.push(options); return answers.shift(); },
        showErrorMessage: async message => { errors.push(message); },
        showInformationMessage: async message => { information.push(message); }
    }
};
const execFileMock = () => { throw new Error('Use the promisified command runner'); };
execFileMock[promisify.custom] = async (executable, args, options) => {
    runs.push({ executable, args, options });
    return runCommand(executable, args, options);
};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === 'vscode') return vscode;
    if (name === 'node:child_process') return { ...childProcess, execFile: execFileMock };
    return originalLoad.call(this, name, ...args);
};
const { CodexSection } = require('../out/sections/codex/CodexSection');
const { promptForMarketplaceGitEnvironment } = require('../out/sections/codex/MarketplaceGitAuthentication');
Module._load = originalLoad;

beforeEach(async t => {
    sandbox = await mkdtemp(path.join(tmpdir(), "gvhidra codex's "));
    const directory = sandbox;
    const config = path.join(directory, 'gitconfig');
    await writeFile(config, '[credential]\n\thelper =\n');
    // Keep real Git calls isolated from the user's credentials and configuration.
    const isolatedEnvironment = {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: config,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'credential.interactive',
        GIT_CONFIG_VALUE_0: 'false',
        GIT_ASKPASS: '',
        SSH_ASKPASS: ''
    };
    const previous = Object.fromEntries(Object.keys(isolatedEnvironment).map(key => [key, process.env[key]]));
    Object.assign(process.env, isolatedEnvironment);
    t.after(async () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        await rm(directory, { recursive: true, force: true });
    });
    answers = [];
    prompts = [];
    errors = [];
    information = [];
    runs = [];
    renderCount = 0;
    runCommand = async () => ({ stdout: '', stderr: '' });
});

function section() {
    const value = new CodexSection(() => { renderCount++; });
    value.executable = '/fake/codex';
    return value;
}

function authenticationError(detail = 'fatal: could not read Username for https://gitlab.laberit.com: terminal prompts disabled') {
    return Object.assign(new Error('Codex could not clone the marketplace'), { stderr: detail });
}

test('installs without prompting when Git already has access', async () => {
    assert.equal(await section().handleAction('installMarketplace'), true);
    assert.equal(prompts.length, 0);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].args, ['plugin', 'marketplace', 'add', marketplaceUrl, '--ref', 'main']);
    assert.equal(runs[0].options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(information.length, 1);
    assert.equal(errors.length, 0);
    assert.equal(renderCount, 1);
});

test('missing credentials prompt for a username and masked token, then retry with working Git authentication', async () => {
    const password = "p@ss'\" $(touch NEVER_EXECUTED)`literal`=$value";
    const config = process.env.GIT_CONFIG_GLOBAL;
    const before = await readFile(config, 'utf8');
    answers = ['  laberit-user  ', password];
    runCommand = async (_executable, _args, options) => {
        if (runs.length === 1) throw authenticationError();
        // Exercise the actual Git credential protocol and shell helper, including special characters.
        const pending = exec('git', ['credential', 'fill'], { env: options.env, cwd: sandbox, timeout: 10000 });
        pending.child.stdin.end(`url=${marketplaceUrl}\n\n`);
        const { stdout } = await pending;
        assert.ok(stdout.includes('username=laberit-user\n'));
        assert.ok(stdout.includes(`password=${password}\n`));
        return { stdout: '', stderr: '' };
    };

    await section().handleAction('installMarketplace');
    assert.equal(runs.length, 2);
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].password, true);
    assert.match(prompts[1].prompt, /token/);
    assert.deepEqual(runs[1].args, runs[0].args);
    assert.equal(information.length, 1);
    assert.deepEqual(errors, []);
    assert.equal(renderCount, 1);
    assert.equal(process.env.GVHIDRA_MARKETPLACE_GIT_PASSWORD, undefined);
    assert.equal(await readFile(config, 'utf8'), before);
    await assert.rejects(stat(path.join(sandbox, 'NEVER_EXECUTED')), { code: 'ENOENT' });
});

test('cancelling either prompt stops installation without success or error notifications', async () => {
    runCommand = async () => { throw authenticationError(); };
    for (const responses of [[undefined], ['user', undefined]]) {
        answers = [...responses];
        const previousRuns = runs.length;
        await section().handleAction('installMarketplace');
        assert.equal(runs.length, previousRuns + 1);
    }
    assert.equal(information.length, 0);
    assert.equal(errors.length, 0);
    assert.equal(renderCount, 0);
});

test('network errors do not request GitLab credentials', async () => {
    runCommand = async () => { throw authenticationError('fatal: Could not resolve host: gitlab.laberit.com'); };
    await section().handleAction('installMarketplace');
    assert.equal(prompts.length, 0);
    assert.equal(runs.length, 1);
    assert.match(errors[0], /Could not resolve host/);
    assert.equal(information.length, 0);
    assert.equal(renderCount, 0);
});

test('rejected saved credentials allow a retry, and an invalid token reports failure without looping', async () => {
    answers = ['user', 'invalid-token'];
    runCommand = async () => { throw authenticationError('remote: HTTP Basic: Access denied\nfatal: Authentication failed'); };
    await section().handleAction('installMarketplace');
    assert.equal(runs.length, 2);
    assert.equal(prompts.length, 2);
    assert.match(errors[0], /Authentication failed/);
    assert.equal(information.length, 0);
    assert.equal(renderCount, 0);
});

test('empty credentials and credential protocol injection never reach the installation command', async () => {
    runCommand = async () => { throw authenticationError(); };
    for (const responses of [[' '], ['user\npassword=bad'], ['user', ''], ['user', 'bad\npassword'], ['user', 'bad\0password']]) {
        answers = [...responses];
        const previousRuns = runs.length;
        await section().handleAction('installMarketplace');
        assert.equal(runs.length, previousRuns + 1);
    }
    assert.equal(information.length, 0);
    assert.equal(errors.length, 0);
});

test('temporary credentials authenticate a real HTTP Git request and remain scoped to that repository', async t => {
    const username = 'test-user';
    const password = 'test-token';
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    let authenticated = 0;
    const server = http.createServer((request, response) => {
        if (request.headers.authorization !== authorization) {
            response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GitLab"' });
            response.end();
            return;
        }
        authenticated++;
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(request.url.endsWith('/HEAD') ? 'ref: refs/heads/main\n' : '');
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/marketplace.git`;
    answers = [username, password];
    const environment = await promptForMarketplaceGitEnvironment(url);
    await exec('git', ['ls-remote', url], { env: environment, cwd: sandbox, timeout: 10000 });
    assert.ok(authenticated > 0);

    const pending = exec('git', ['credential', 'fill'], { env: environment, cwd: sandbox, timeout: 10000 });
    pending.child.stdin.end(`url=${url.replace('/marketplace.git', '/other.git')}\n\n`);
    await assert.rejects(pending, error => {
        assert.match(error.stderr, /could not read Username/);
        assert.ok(!error.stderr.includes(password));
        return true;
    });
});
