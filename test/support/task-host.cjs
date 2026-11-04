// Simulates the VS Code task lifecycle while running real Git/SVN processes in tests.
function createTaskHost(runProcess) {
    const processListeners = new Set();
    const endListeners = new Set();
    const listen = listeners => callback => {
        listeners.add(callback);
        return { dispose: () => listeners.delete(callback) };
    };
    const host = {
        reset() {
            this.runs = [];
            this.results = [];
            this.startError = undefined;
            this.beforeRun = undefined;
            this.endWithoutProcess = false;
        },
        emitProcessEnd(event) { for (const callback of processListeners) callback(event); },
        emitTaskEnd(event) { for (const callback of endListeners) callback(event); },
        get listenerCount() { return processListeners.size + endListeners.size; }
    };
    host.reset();
    host.api = {
        TaskScope: { Workspace: 2 },
        TaskRevealKind: { Always: 1 },
        ProcessExecution: class {
            constructor(process, args, options) { Object.assign(this, { process, args, options }); }
        },
        Task: class {
            constructor(definition, scope, name, source, execution) {
                Object.assign(this, { definition, scope, name, source, execution });
            }
        },
        tasks: {
            onDidEndTaskProcess: listen(processListeners),
            onDidEndTask: listen(endListeners),
            executeTask: async task => {
                host.runs.push(task);
                if (host.startError) throw host.startError;
                const execution = { task };
                if (host.endWithoutProcess) {
                    host.emitTaskEnd({ execution });
                    return execution;
                }
                host.running = Promise.resolve().then(async () => {
                    let exitCode, error;
                    try {
                        await host.beforeRun?.(execution);
                        await runProcess(task.execution);
                        exitCode = 0;
                    } catch (failure) {
                        error = failure;
                        exitCode = typeof failure.code === 'number' ? failure.code : undefined;
                    }
                    host.results.push({ exitCode, error });
                    host.emitProcessEnd({ execution, exitCode });
                    host.emitTaskEnd({ execution });
                });
                return execution;
            }
        }
    };
    return host;
}

module.exports = { createTaskHost };
