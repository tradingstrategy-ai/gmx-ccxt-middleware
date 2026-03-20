// Shared test helpers for starting forks, launching the bridge, and importing the generated adapter.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../../..');
export const ANVIL_FORK_BLOCK_NUMBER = 44000000;
export const DEFAULT_TEST_SYMBOL = 'ETH/USDC:USDC';

function delay(ms) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function getFreePort() {
    return await new Promise((resolvePort, rejectPort) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close((err) => {
                if (err) {
                    rejectPort(err);
                    return;
                }
                resolvePort(address.port);
            });
        });
        server.on('error', rejectPort);
    });
}

export async function waitForHealth(url, token, timeoutMs = 60000) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
        try {
            const response = await fetch(url, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            // Server is still starting.
        }
        await delay(500);
    }
    throw new Error(`Timed out waiting for ${url}`);
}

export async function waitForJsonRpc(url, timeoutMs = 30000) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'web3_clientVersion',
                    params: [],
                }),
            });
            if (response.ok) {
                const payload = await response.json();
                if (payload.result) {
                    return payload;
                }
            }
        } catch (error) {
            // Process is still starting.
        }
        await delay(500);
    }
    throw new Error(`Timed out waiting for JSON-RPC endpoint ${url}`);
}

export function spawnManaged(command, args, options = {}) {
    const child = spawn(command, args, {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    return {
        child,
        getOutput() {
            return { stdout, stderr };
        },
        async stop() {
            if (child.exitCode !== null) {
                return;
            }
            child.kill('SIGTERM');
            await Promise.race([
                new Promise((resolveClose) => child.once('close', resolveClose)),
                delay(5000).then(() => {
                    if (child.exitCode === null) {
                        child.kill('SIGKILL');
                    }
                }),
            ]);
        },
    };
}

export async function createTempConfig(contents) {
    const dir = await mkdtemp(resolve(tmpdir(), 'gmx-ccxt-server-'));
    const path = resolve(dir, 'gmx-bridge.local.toml');
    await writeFile(path, contents, 'utf8');
    return {
        path,
        async cleanup() {
            await rm(dir, { recursive: true, force: true });
        },
    };
}

export async function importGeneratedExchange() {
    const modulePath = resolve(REPO_ROOT, 'ccxt/js/src/gmx.js');
    assert.ok(existsSync(modulePath), 'Generated ccxt/js/src/gmx.js not found. Run `make ccxt-build` first.');
    const module = await import(pathToFileURL(modulePath).href);
    return module.default;
}

export function pickTestSymbol(markets) {
    if (markets[DEFAULT_TEST_SYMBOL]) {
        return DEFAULT_TEST_SYMBOL;
    }
    const symbols = Object.keys(markets);
    assert.ok(symbols.length > 0, 'Expected at least one market');
    return symbols[0];
}

export async function startBridgeServer({ configText, token }) {
    const config = await createTempConfig(configText);
    const port = await getFreePort();
    const replaced = configText.replace('__PORT__', String(port));
    await writeFile(config.path, replaced, 'utf8');
    const process = spawnManaged('poetry', ['run', 'python', '-m', 'gmx_ccxt_server', '--config', config.path]);
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await waitForHealth(`${baseUrl}/healthz`, token);
    } catch (error) {
        const output = process.getOutput();
        await process.stop();
        await config.cleanup();
        throw new Error(`Bridge server failed to start\nSTDOUT:\n${output.stdout}\nSTDERR:\n${output.stderr}`);
    }
    return {
        baseUrl,
        token,
        async stop() {
            await process.stop();
            await config.cleanup();
        },
    };
}

export async function startAnvilFork(rpcUrl) {
    const forkableRpcUrl = normaliseRpcUrlForCli(rpcUrl);
    const port = await getFreePort();
    const process = spawnManaged('anvil', [
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--fork-url',
        forkableRpcUrl,
        '--fork-block-number',
        String(ANVIL_FORK_BLOCK_NUMBER),
    ]);
    const forkUrl = `http://127.0.0.1:${port}`;
    try {
        await waitForJsonRpc(forkUrl, 30000);
    } catch (error) {
        const output = process.getOutput();
        await process.stop();
        throw new Error(`Anvil failed to start\nSTDOUT:\n${output.stdout}\nSTDERR:\n${output.stderr}`);
    }
    return {
        rpcUrl: forkUrl,
        async stop() {
            await process.stop();
        },
    };
}

export function normaliseRpcUrlForCli(rpcUrl) {
    assert.ok(rpcUrl, 'RPC URL is required');
    const entries = rpcUrl.trim().split(/\s+/);
    const preferredEntry = entries.find((entry) => !entry.startsWith('mev+')) ?? entries[0];
    return preferredEntry.replace(/^mev\+/, '');
}

export function makeConfigText({ rpcUrl, authToken = '', privateKey = '', walletAddress = '', chainId = '', preloadMarkets = false }) {
    const chainIdLine = chainId ? `chain_id = ${chainId}` : 'chain_id = 42161';
    return `[server]
host = "127.0.0.1"
port = __PORT__
auth_token = "${authToken}"
log_level = "info"

[gmx]
rpc_url = "${rpcUrl}"
private_key = "${privateKey}"
wallet_address = "${walletAddress}"
${chainIdLine}
subsquid_endpoint = ""
execution_buffer = 2.2
default_slippage = 0.003
verbose = false
preload_markets = ${preloadMarkets ? 'true' : 'false'}

[gmx.options]
rest_api_mode = true
graphql_only = false
disable_market_cache = false
`;
}
