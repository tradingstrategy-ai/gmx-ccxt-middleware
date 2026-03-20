// Fork-backed Lagoon tests covering vault-oriented reads and lifecycle behaviour on Anvil.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeConfigText,
    startAnvilFork,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Whether Anvil is available for Lagoon fork tests.
const hasAnvil = spawnSync('which', ['anvil'], { stdio: 'ignore' }).status === 0;
// Source RPC used to create the Arbitrum fork.
const forkRpc = process.env.JSON_RPC_ARBITRUM;

// Safe address used by Lagoon fork read-path tests.
const lagoonSafeAddress = process.env.GMX_LAGOON_SAFE_ADDRESS
    ?? process.env.GMX_WALLET_ADDRESS
    ?? '';
// Asset-manager key used to model Lagoon signing behavior on the fork.
const lagoonAssetManagerPrivateKey = process.env.GMX_LAGOON_ASSET_MANAGER_PRIVATE_KEY
    ?? process.env.GMX_PRIVATE_KEY
    ?? process.env.LAGOON_MULTCHAIN_TEST_PRIVATE_KEY
    ?? '';

// Whether the minimum Lagoon fork configuration is present.
const lagoonConfigReady = Boolean(forkRpc && hasAnvil && lagoonSafeAddress && lagoonAssetManagerPrivateKey);
// Test runner selection for Lagoon fork coverage.
const runLagoonForkTest = lagoonConfigReady ? test : test.skip;

async function startLagoonBridge() {
    const authToken = 'lagoon-fork-token';
    const anvil = await startAnvilFork(forkRpc);
    const bridge = await startBridgeServer({
        configText: makeConfigText({
            rpcUrl: anvil.rpcUrl,
            authToken,
            privateKey: lagoonAssetManagerPrivateKey,
            walletAddress: lagoonSafeAddress,
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
    return { anvil, bridge, exchange, authToken };
}

/*
Purpose:
Verify Lagoon fork wiring can expose read-path data through the bridge when configured.
Steps checked:
Start the Lagoon-configured fork bridge, check health and describe, then assert balance and positions can be read.
*/
runLagoonForkTest('lagoon fork: bridge bootstrap exposes the Lagoon wallet-address read path', async () => {
    const { anvil, bridge, exchange } = await startLagoonBridge();
    try {
        const healthResponse = await fetch(`${bridge.baseUrl}/healthz`, {
            headers: { Authorization: 'Bearer lagoon-fork-token' },
        });
        assert.equal(healthResponse.status, 200);
        const healthPayload = await healthResponse.json();
        assert.equal(healthPayload.status, 'ok');
        assert.equal(healthPayload.walletConfigured, true);
        assert.equal(healthPayload.walletAddress, lagoonSafeAddress);

        const describeResponse = await fetch(`${bridge.baseUrl}/describe`, {
            headers: { Authorization: 'Bearer lagoon-fork-token' },
        });
        assert.equal(describeResponse.status, 200);
        const describePayload = await describeResponse.json();
        assert.equal(describePayload.bridge.exchange, 'gmx');
        assert.ok(Array.isArray(describePayload.bridge.allowedMethods));

        const balance = await exchange.fetchBalance();
        const positions = await exchange.fetchPositions();

        assert.equal(typeof balance, 'object');
        assert.ok(balance !== null);
        assert.ok(balance.info !== undefined || balance.free !== undefined || balance.total !== undefined);
        assert.ok(Array.isArray(positions));
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Document the current Lagoon fork write-path limitation in a stable test.
Steps checked:
Start the Lagoon-configured fork bridge, attempt createLimitOrder, and assert the bridge returns the expected guarded failure.
*/
runLagoonForkTest('lagoon fork: order construction remains guarded until Lagoon wallet wiring exists in the bridge', async () => {
    const { anvil, bridge, exchange } = await startLagoonBridge();
    try {
        await assert.rejects(
            exchange.createLimitOrder('ETH/USDC:USDC', 'buy', 0.001, 1000),
            (error) => {
                assert.equal(error.name, 'ExchangeError');
                assert.match(
                    error.message,
                    /Could not transact with\/call contract function|Wallet required for order creation|contract|sync/i,
                );
                return true;
            },
        );
    } finally {
        await bridge.stop();
        await anvil.stop();
    }
});

/*
Purpose:
Keep the missing full Lagoon execution path visible without failing the suite.
Steps checked:
Mark the performCall-backed execution case as an explicit skip until the bridge grows native Lagoon transaction support.
*/
test.skip('lagoon fork: full performCall-backed GMX execution is still not wired through the bridge', async () => {});
