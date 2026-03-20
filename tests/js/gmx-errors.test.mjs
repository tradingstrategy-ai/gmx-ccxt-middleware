// Fork-backed error-handling tests covering auth failures and unsupported adapter operations.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { AuthenticationError, NotSupported } from '../../ccxt/js/src/base/errors.js';
import {
    importGeneratedExchange,
    makeConfigText,
    startAnvilFork,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Whether Anvil is available for fork-backed adapter error tests.
const hasAnvil = spawnSync('which', ['anvil'], { stdio: 'ignore' }).status === 0;
// Source RPC used to create the Arbitrum fork.
const forkRpc = process.env.JSON_RPC_ARBITRUM;
// Test runner selection for fork error-parity coverage.
const runForkTest = (forkRpc && hasAnvil) ? test : test.skip;

function makeExchange(GmxExchange, bridgeUrl, token) {
    return new GmxExchange({
        bridgeUrl,
        token,
        timeout: 30000,
    });
}

/*
Purpose:
Verify unsupported order-book calls keep CCXT parity through the bridge.
Steps checked:
Start a fork bridge, call fetchOrderBook, and assert the adapter raises NotSupported.
*/
runForkTest('unsupported fetchOrderBook maps to NotSupported', async () => {
    const authToken = 'errors-not-supported-token';
    const anvil = await startAnvilFork(forkRpc);
    const configText = makeConfigText({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = makeExchange(GmxExchange, bridge.baseUrl, authToken);

        await assert.rejects(
            exchange.fetchOrderBook('ETH/USDC:USDC'),
            (error) => error instanceof NotSupported,
        );
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify unsupported closed-order calls keep CCXT parity through the bridge.
Steps checked:
Start a fork bridge, call fetchClosedOrders, and assert the adapter raises NotSupported.
*/
runForkTest('unsupported fetchClosedOrders maps to NotSupported', async () => {
    const authToken = 'errors-closed-orders-token';
    const anvil = await startAnvilFork(forkRpc);
    const configText = makeConfigText({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = makeExchange(GmxExchange, bridge.baseUrl, authToken);

        await assert.rejects(
            exchange.fetchClosedOrders('ETH/USDC:USDC'),
            (error) => error instanceof NotSupported,
        );
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify bridge auth failures are remapped to CCXT AuthenticationError.
Steps checked:
Start a fork bridge, use the wrong token in the adapter, and assert the resulting error class is AuthenticationError.
*/
runForkTest('bridge auth failures map to AuthenticationError through the adapter', async () => {
    const authToken = 'errors-auth-token';
    const anvil = await startAnvilFork(forkRpc);
    const configText = makeConfigText({
        rpcUrl: anvil.rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = makeExchange(GmxExchange, bridge.baseUrl, 'wrong-token');

        await assert.rejects(
            exchange.fetchOrderBook('ETH/USDC:USDC'),
            (error) => error instanceof AuthenticationError,
        );
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});
