// Fork-backed smoke tests covering basic market loading and read paths through the adapter.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeConfigText,
    pickTestSymbol,
    startAnvilFork,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Whether Anvil is available for fork smoke tests.
const hasAnvil = spawnSync('which', ['anvil'], { stdio: 'ignore' }).status === 0;
// Live Arbitrum RPC used for mainnet smoke coverage.
const arbitrumRpc = process.env.JSON_RPC_ARBITRUM;
// Sepolia RPC used for testnet smoke coverage.
const arbitrumSepoliaRpc = process.env.JSON_RPC_ARBITRUM_SEPOLIA;

// Test runner selection for fork smoke coverage.
const runForkTest = (arbitrumRpc && hasAnvil) ? test : test.skip;
// Test runner selection for live smoke coverage.
const runLiveTest = arbitrumRpc ? test : test.skip;
// Test runner selection for testnet smoke coverage.
const runTestnetTest = arbitrumSepoliaRpc ? test : test.skip;

function bearerHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/*
Purpose:
Verify the lightest live bridge bootstrap path works on Arbitrum One.
Steps checked:
Start the live bridge, call /describe through HTTP, and assert bridge plus exchange metadata are available.
*/
runLiveTest('live smoke: compiled JS adapter reads market data from Arbitrum One', async () => {
    const authToken = 'live-smoke-token';
    const configText = makeConfigText({
        rpcUrl: arbitrumRpc,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    try {
        const response = await fetch(`${bridge.baseUrl}/describe`, {
            headers: bearerHeaders(authToken),
        });
        assert.equal(response.status, 200);
        const payload = await response.json();

        assert.equal(payload.bridge.exchange, 'gmx');
        assert.equal(payload.exchange.id, 'gmx');
        assert.ok(Array.isArray(payload.bridge.allowedMethods));
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify the lightest fork bootstrap path works on an Anvil-backed bridge.
Steps checked:
Start Anvil and the bridge, call health and describe, and assert authenticated access works while unauthenticated access is rejected.
*/
runForkTest('fork smoke: bridge contract endpoints work on an Anvil fork', async () => {
    const authToken = 'fork-smoke-token';
    const anvil = await startAnvilFork(arbitrumRpc);
    const configText = makeConfigText({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    try {
        const healthResponse = await fetch(`${bridge.baseUrl}/healthz`, {
            headers: bearerHeaders(authToken),
        });
        assert.equal(healthResponse.status, 200);
        const healthPayload = await healthResponse.json();
        assert.equal(healthPayload.status, 'ok');
        assert.equal(healthPayload.exchange, 'gmx');
        assert.equal(healthPayload.preloadMarkets, false);

        const describeResponse = await fetch(`${bridge.baseUrl}/describe`, {
            headers: bearerHeaders(authToken),
        });
        assert.equal(describeResponse.status, 200);
        const describePayload = await describeResponse.json();
        assert.equal(describePayload.bridge.exchange, 'gmx');
        assert.ok(Array.isArray(describePayload.bridge.allowedMethods));
        assert.equal(describePayload.exchange.id, 'gmx');

        const unauthorizedResponse = await fetch(`${bridge.baseUrl}/healthz`);
        assert.equal(unauthorizedResponse.status, 401);
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify the lightest Sepolia bootstrap path works before deeper trading tests run.
Steps checked:
Start the Sepolia bridge, load markets, fetch status, and assert the adapter bootstraps successfully.
*/
runTestnetTest('testnet smoke: compiled JS adapter boots against Arbitrum Sepolia', async () => {
    const authToken = 'testnet-smoke-token';
    const configText = makeConfigText({
        rpcUrl: arbitrumSepoliaRpc,
        authToken,
        chainId: 421614,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 30000,
        });
        const markets = await exchange.loadMarkets();
        const symbol = pickTestSymbol(markets);
        const status = await exchange.fetchStatus();

        assert.ok(Object.keys(markets).length > 0);
        assert.ok(symbol);
        assert.ok(status.status);
    } finally {
        await bridge.stop();
    }
});
