// Bridge contract tests covering the HTTP request and response surface exposed to CCXT.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeBridgeEnv,
    startAnvilFork,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Whether Anvil is available for fork-backed bridge contract tests.
const hasAnvil = spawnSync('which', ['anvil'], { stdio: 'ignore' }).status === 0;
// Source RPC used to create the Arbitrum fork.
const forkRpc = process.env.JSON_RPC_ARBITRUM;
// Test runner selection for environments with fork support.
const runForkTest = (forkRpc && hasAnvil) ? test : test.skip;

function authHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postCall(baseUrl, token, body) {
    return await fetch(`${baseUrl}/call`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(token),
        },
        body: JSON.stringify(body),
    });
}

/*
Purpose:
Verify the bridge ping endpoint exposes non-secret runtime metadata on a fork.
Steps checked:
Start Anvil and the bridge, call /ping with auth, and assert the liveness payload fields.
*/
runForkTest('test_bridge_ping_returns_runtime_metadata', async () => {
    const authToken = 'bridge-contract-token';
    const anvil = await startAnvilFork(forkRpc);
    const env = makeBridgeEnv({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ env, token: authToken });
    try {
        const response = await fetch(`${bridge.baseUrl}/ping`, {
            headers: authHeaders(authToken),
        });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.status, 'ok');
        assert.equal(payload.exchange, 'gmx');
        assert.equal(payload.preloadMarkets, false);
        assert.ok(Number(payload.allowedMethods) > 0);
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify the bridge describe endpoint returns both bridge and exchange metadata.
Steps checked:
Start Anvil and the bridge, call /describe with auth, and assert the bridge metadata plus GMX describe payload.
*/
runForkTest('test_bridge_describe_returns_exchange_metadata', async () => {
    const authToken = 'bridge-contract-describe-token';
    const anvil = await startAnvilFork(forkRpc);
    const env = makeBridgeEnv({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ env, token: authToken });
    try {
        const response = await fetch(`${bridge.baseUrl}/describe`, {
            headers: authHeaders(authToken),
        });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.bridge.exchange, 'gmx');
        assert.ok(Array.isArray(payload.bridge.allowedMethods));
        assert.ok(Array.isArray(payload.bridge.readOnlyMethods));
        assert.ok(payload.bridge.readOnlyMethods.includes('fetch_status'));
        assert.ok(!payload.bridge.readOnlyMethods.includes('create_order'));
        assert.equal(payload.exchange.id, 'gmx');
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify the RPC-style /call endpoint returns a serialized success envelope.
Steps checked:
Invoke the describe method through /call and assert the response id, ok flag, and serialized exchange fields.
*/
runForkTest('test_bridge_call_returns_serialized_describe_payload', async () => {
    const authToken = 'bridge-contract-call-token';
    const anvil = await startAnvilFork(forkRpc);
    const env = makeBridgeEnv({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ env, token: authToken });
    try {
        const response = await postCall(bridge.baseUrl, authToken, {
            id: 'call-describe',
            method: 'describe',
            args: [],
            kwargs: {},
        });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.id, 'call-describe');
        assert.equal(payload.ok, true);
        assert.equal(payload.result.id, 'gmx');
        assert.equal(payload.result.name, 'GMX');
        assert.equal(payload.result.has.fetchMarkets, true);
        assert.equal(payload.result.has.fetchStatus, true);
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify the generated CCXT adapter exposes the configured wallet address through fetchStatus info.
Steps checked:
Start a read-only fork bridge, compare /ping wallet metadata with exchange.fetchStatus(), and assert both return the same wallet address.
*/
runForkTest('test_bridge_fetch_status_info_includes_wallet_address', async () => {
    const authToken = 'bridge-contract-status-wallet-token';
    const walletAddress = '0x1111111111111111111111111111111111111111';
    const anvil = await startAnvilFork(forkRpc);
    const env = makeBridgeEnv({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
        walletAddress,
    });
    const bridge = await startBridgeServer({ env, token: authToken });
    try {
        const pingResponse = await fetch(`${bridge.baseUrl}/ping`, {
            headers: authHeaders(authToken),
        });
        assert.equal(pingResponse.status, 200);
        const pingPayload = await pingResponse.json();

        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 30000,
        });
        const status = await exchange.fetchStatus();

        assert.equal(pingPayload.chain, 'arbitrum');
        assert.equal(pingPayload.chainId, 42161);
        assert.equal(pingPayload.walletAddress, walletAddress);
        assert.equal(status.status, 'ok');
        assert.equal(status.info.chain, 'arbitrum');
        assert.equal(Number(status.info.chainId), 42161);
        assert.equal(status.info.gasTokenSymbol, 'ETH');
        assert.ok(Number(status.info.gasTokenBalance) >= 0);
        assert.ok(Number(status.info.gasTokenBalanceWei) >= 0);
        assert.equal(status.info.walletAddress, walletAddress);
        assert.equal(status.info.chain, pingPayload.chain);
        assert.equal(Number(status.info.chainId), pingPayload.chainId);
        assert.equal(status.info.walletAddress, pingPayload.walletAddress);
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify the bridge rejects non-whitelisted methods with a serialized error payload.
Steps checked:
Call /call with an invalid method name and assert the returned error type, message, and details.
*/
runForkTest('test_bridge_call_rejects_unknown_method_with_serialized_error', async () => {
    const authToken = 'bridge-contract-call-error-token';
    const anvil = await startAnvilFork(forkRpc);
    const env = makeBridgeEnv({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ env, token: authToken });
    try {
        const response = await postCall(bridge.baseUrl, authToken, {
            id: 'call-unknown-method',
            method: 'definitely_not_allowed',
            args: [],
            kwargs: {},
        });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.id, 'call-unknown-method');
        assert.equal(payload.ok, false);
        assert.equal(payload.error.type, 'MethodNotAllowedError');
        assert.equal(payload.error.ccxt_error, 'MethodNotAllowedError');
        assert.match(payload.error.message, /not allowed/);
        assert.ok(Array.isArray(payload.error.details.args));
        assert.equal(payload.error.details.args[0], "Method 'definitely_not_allowed' is not allowed by the bridge");
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify bridge bearer authentication is enforced on protected endpoints.
Steps checked:
Call /ping without auth and with the wrong token, then assert both requests return 401.
*/
runForkTest('test_bridge_rejects_missing_or_invalid_bearer_token', async () => {
    const authToken = 'bridge-contract-auth-token';
    const anvil = await startAnvilFork(forkRpc);
    const env = makeBridgeEnv({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ env, token: authToken });
    try {
        const unauthorizedResponse = await fetch(`${bridge.baseUrl}/ping`);
        assert.equal(unauthorizedResponse.status, 401);

        const invalidResponse = await fetch(`${bridge.baseUrl}/ping`, {
            headers: authHeaders('wrong-token'),
        });
        assert.equal(invalidResponse.status, 401);
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});
