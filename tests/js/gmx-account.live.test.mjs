// Live Arbitrum account-read tests covering balances, positions, and account state queries.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeConfigText,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Default EOA address used when live account reads need a target address.
const DEFAULT_GMX_WALLET_ADDRESS = '0xdcc6D3A3C006bb4a10B448b1Ee750966395622c6';
// Live Arbitrum RPC used for account-read coverage.
const arbitrumRpc = process.env.JSON_RPC_ARBITRUM;
// Optional account address override for live account-read tests.
const walletAddress = process.env.GMX_WALLET_ADDRESS ?? DEFAULT_GMX_WALLET_ADDRESS;
// Optional signing key that also enables account-context reads.
const privateKey = process.env.GMX_PRIVATE_KEY ?? '';

// Whether we have enough account configuration to execute account-read tests.
const hasAccountConfig = Boolean(walletAddress || privateKey);
// Test runner selection for live account coverage.
const runLiveAccountTest = (arbitrumRpc && hasAccountConfig) ? test : test.skip;

async function createLiveAccountExchange() {
    const authToken = 'live-account-token';
    const configText = makeConfigText({
        rpcUrl: arbitrumRpc,
        authToken,
        walletAddress,
        privateKey,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    const GmxExchange = await importGeneratedExchange();
    const exchange = new GmxExchange({
        bridgeUrl: bridge.baseUrl,
        token: authToken,
        timeout: 30000,
    });
    return { bridge, exchange, authToken };
}

/*
Purpose:
Verify live account reads return a CCXT-style balance object for the configured account.
Steps checked:
Start the live bridge, call fetchBalance, and assert the returned object has the expected top-level balance structure.
*/
runLiveAccountTest('live account reads: fetchBalance returns a valid CCXT balance shape', async () => {
    const { bridge, exchange } = await createLiveAccountExchange();
    try {
        const balance = await exchange.fetchBalance();

        assert.equal(typeof balance, 'object');
        assert.ok(balance !== null);
        assert.ok(balance.info !== undefined || balance.free !== undefined || balance.total !== undefined);
        assert.equal(Array.isArray(balance.free), false);
        assert.equal(Array.isArray(balance.total), false);
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify live account reads return positions in a stable array shape.
Steps checked:
Start the live bridge, call fetchPositions, and assert each returned position object exposes a symbol.
*/
runLiveAccountTest('live account reads: fetchPositions returns a list for configured account mode', async () => {
    const { bridge, exchange } = await createLiveAccountExchange();
    try {
        const positions = await exchange.fetchPositions();

        assert.ok(Array.isArray(positions));
        for (const position of positions) {
            assert.equal(typeof position, 'object');
            assert.ok(position !== null);
            assert.equal(typeof position.symbol, 'string');
        }
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify live account reads return open orders in a stable array shape.
Steps checked:
Start the live bridge, call fetchOpenOrders, and assert each returned order object exposes a symbol.
*/
runLiveAccountTest('live account reads: fetchOpenOrders returns an array for configured account mode', async () => {
    const { bridge, exchange } = await createLiveAccountExchange();
    try {
        const openOrders = await exchange.fetchOpenOrders();

        assert.ok(Array.isArray(openOrders));
        for (const order of openOrders) {
            assert.equal(typeof order, 'object');
            assert.ok(order !== null);
            assert.equal(typeof order.symbol, 'string');
        }
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify live account reads return private trade history in a stable array shape.
Steps checked:
Start the live bridge, call fetchMyTrades, and assert each returned trade object exposes a symbol.
*/
runLiveAccountTest('live account reads: fetchMyTrades returns an array for configured account mode', async () => {
    const { bridge, exchange } = await createLiveAccountExchange();
    try {
        const trades = await exchange.fetchMyTrades();

        assert.ok(Array.isArray(trades));
        for (const trade of trades) {
            assert.equal(typeof trade, 'object');
            assert.ok(trade !== null);
            assert.equal(typeof trade.symbol, 'string');
        }
    } finally {
        await bridge.stop();
    }
});
