// Fork-backed trading tests covering order and position flows against an Anvil Arbitrum fork.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeBridgeEnv,
    startAnvilFork,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Whether Anvil is available for fork trading tests.
const hasAnvil = spawnSync('which', ['anvil'], { stdio: 'ignore' }).status === 0;
// Source RPC used to create the Arbitrum fork.
const forkRpc = process.env.JSON_RPC_ARBITRUM;
// Test runner selection for fork trading coverage.
const runForkTest = (forkRpc && hasAnvil) ? test : test.skip;

// Default Anvil dev account used to exercise the fork write path.
const ANVIL_DEV_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// Order methods used to assert consistent fork-side error handling.
const ORDER_METHODS = [
    ['createOrder', (exchange) => exchange.createOrder('ETH/USDC:USDC', 'limit', 'buy', 0.001, 1000)],
    ['createLimitOrder', (exchange) => exchange.createLimitOrder('ETH/USDC:USDC', 'buy', 0.001, 1000)],
    ['createMarketBuyOrder', (exchange) => exchange.createMarketBuyOrder('ETH/USDC:USDC', 0.001)],
    ['createMarketSellOrder', (exchange) => exchange.createMarketSellOrder('ETH/USDC:USDC', 0.001)],
];

async function startForkBridge({ privateKey = '', walletAddress = '' } = {}) {
    const authToken = privateKey ? 'fork-private-token' : 'fork-view-token';
    const anvil = await startAnvilFork(forkRpc);
    const bridge = await startBridgeServer({
        env: makeBridgeEnv({
            rpcUrl: anvil.rpcUrl,
            authToken,
            privateKey,
            walletAddress,
            chainId: 42161,
            preloadMarkets: false,
        }),
        token: authToken,
    });
    const GmxExchange = await importGeneratedExchange();
    const exchange = new GmxExchange({
        bridgeUrl: bridge.baseUrl,
        token: authToken,
        timeout: 30000,
    });
    return { anvil, bridge, exchange };
}

async function expectExchangeError(promise, messagePattern) {
    await assert.rejects(promise, (error) => {
        assert.ok(['ExchangeError', 'PermissionDenied', 'RequestTimeout'].includes(error.name));
        assert.match(error.message, messagePattern);
        return true;
    });
}

/*
Purpose:
Verify fork write methods fail cleanly when the bridge has no wallet configured.
Steps checked:
Start the fork bridge in view-only mode, call the main order methods, and assert each one returns the expected wallet-required error.
*/
runForkTest('fork trading: order methods reject cleanly in view-only mode', async () => {
    const { anvil, bridge, exchange } = await startForkBridge();
    try {
        for (const [label, invoke] of ORDER_METHODS) {
            await expectExchangeError(
                invoke(exchange),
                /read-only mode|GMX_PRIVATE_KEY is not configured/,
            );
        }
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Verify the fork bridge can progress past wallet setup into the GMX contract path.
Steps checked:
Start the fork bridge with a dev private key, call createLimitOrder, and assert the failure comes from the chain/integration layer rather than wallet setup.
*/
runForkTest('fork trading: private-key wallet reaches chain execution path before failing', async () => {
    const { anvil, bridge, exchange } = await startForkBridge({ privateKey: ANVIL_DEV_PRIVATE_KEY });
    try {
        await expectExchangeError(
            exchange.createLimitOrder('ETH/USDC:USDC', 'buy', 0.001, 1000),
            /Could not transact with\/call contract function, is contract deployed correctly and chain synced\?|request timed out/i,
        );
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Keep the unsupported Anvil pending-order lifecycle visible without failing the suite.
Steps checked:
Record the keeper-dependent lifecycle case as an explicit skip until fork execution support is made reliable.
*/
test.skip('fork trading: pending-order lifecycle remains non-default because GMX keeper execution is not reliable on Anvil forks', async () => {});
