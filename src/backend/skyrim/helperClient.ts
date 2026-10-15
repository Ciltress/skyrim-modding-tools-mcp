import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import { SessionExpiredError } from '../Backend.js';
import { createLogger } from '../../lib/logger.js';

/**
 * The client side of the plugin helper (docs/adr/0003): a long-running .NET process that speaks
 * one JSON object per line on stdio — `{id, method, params}` in, `{id, result}` or
 * `{id, error: {code, message}}` out. It keeps the load order open between calls, which is why it is
 * one process for the server's lifetime rather than one per call.
 */

/** A failure the helper reported. `code` is stable — `notFound`, `badRequest`, `danglingReferences`… */
export class HelperError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
        this.name = 'HelperError';
    }
}

/**
 * The helper was not running when the call was made, so nothing was applied and the server may
 * restart it and retry once. A helper that dies *during* a call is a plain HelperError instead: the
 * call may have been half done.
 */
export class HelperUnavailableError extends SessionExpiredError {
    constructor(message: string) {
        super(message);
        this.name = 'HelperUnavailableError';
    }
}

/** The helper's executable is missing — a build step was skipped. Checked again on every call. */
export class HelperMissingError extends Error { }

export interface HelperTransport {
    readonly running: boolean;
    start(): Promise<void>;
    call<T = any>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
    stop(): void;
}

const DEFAULT_TIMEOUT_MS = 120_000;

interface Pending {
    method: string;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export class HelperClient implements HelperTransport {
    private child?: ChildProcess;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;
    private readonly logger = createLogger('SkyrimHelper');

    constructor(private readonly executable: string) { }

    get running(): boolean {
        return !!this.child && this.child.exitCode === null && !this.child.killed;
    }

    async start(): Promise<void> {
        if (this.running) return;
        if (!fs.existsSync(this.executable)) {
            throw new HelperMissingError(
                `The plugin helper is not built: no '${this.executable}'. Run 'npm run build:helper' ` +
                `(needs the .NET 10 SDK), or set SKYRIM_HELPER_PATH to a built SkyrimHelper.exe.`);
        }

        const child = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.child = child;

        readline.createInterface({ input: child.stdout! }).on('line', line => this.answer(line));
        readline.createInterface({ input: child.stderr! }).on('line', line => {
            if (line.trim()) this.logger.info(line);
        });
        child.on('exit', code => {
            if (this.child === child) this.child = undefined;
            this.failAll(new HelperError('helperExited',
                `The plugin helper exited (code ${code}) during the call. The call may have been half done; ` +
                `check its result before repeating it.`));
        });
        child.on('error', error => this.logger.error('helper process error', { error: error.message }));
    }

    call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
        if (!this.running) {
            return Promise.reject(new HelperUnavailableError('The plugin helper is not running.'));
        }
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                // A helper stuck on one call blocks every call after it: start over.
                this.stop();
                reject(new HelperError('timeout', `The plugin helper did not answer '${method}' within ${timeoutMs / 1000} s.`));
            }, timeoutMs);
            this.pending.set(id, { method, resolve, reject, timer });
            this.child!.stdin!.write(`${JSON.stringify({ id, method, params })}\n`);
        });
    }

    stop(): void {
        const child = this.child;
        this.child = undefined;
        if (child && child.exitCode === null) {
            child.stdin?.end();
            child.kill();
        }
    }

    private answer(line: string): void {
        let message: any;
        try {
            message = JSON.parse(line);
        } catch {
            this.logger.warn('helper wrote a line that is not JSON', { line: line.slice(0, 200) });
            return;
        }
        const pending = this.pending.get(message?.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new HelperError(String(message.error.code), String(message.error.message)));
        else pending.resolve(message.result);
    }

    private failAll(error: Error): void {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
}
