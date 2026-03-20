// Sepolia margin tests covering leverage, collateral, and position-management operations.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeConfigText,
    pickTestSymbol,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Sepolia RPC used for margin and leverage coverage.
const sepoliaRpc = process.env.JSON_RPC_ARBITRUM_SEPOLIA;
// Signing key used for Sepolia EOA margin operations.
const privateKey = (process.env.GMX_PRIVATE_KEY ?? '').trim();
// Optional wallet address override passed alongside the Sepolia signing key.
const walletAddress = (process.env.GMX_WALLET_ADDRESS ?? '').trim();
// Whether we have the signing material needed for Sepolia write-path tests.
const hasSigningCredentials = privateKey !== '';

// Test runner selection for Sepolia bootstrap coverage.
const runBootstrapTest = sepoliaRpc ? test : test.skip;
// Test runner selection for Sepolia margin/leverage coverage.
const runMarginTest = (sepoliaRpc && hasSigningCredentials) ? test : test.skip;

async function startSepoliaBridge({ authToken, includeSigning = false }) {
    const configText = makeConfigText({
        rpcUrl: sepoliaRpc,
        authToken,
        chainId: 421614,
        privateKey: includeSigning ? privateKey : '',
        walletAddress: includeSigning ? walletAddress : '',
        preloadMarkets: false,
    });
    return await startBridgeServer({ configText, token: authToken });
}

function extractResultId(result) {
    return result?.id || result?.info?.order_key || result?.info?.tx_hash || result?.info?.hash || null;
}

function hasNumericField(value, field) {
    const numberValue = Number(value?.[field]);
    return Number.isFinite(numberValue);
}

async function expectMarginIntegrationError(promise) {
    await assert.rejects(promise, (error) => {
        assert.equal(error.name, 'ExchangeError');
        assert.match(
            error.message,
            /requires GMX smart contract integration|will be implemented in a future update/i,
        );
        return true;
    });
}

/*
Purpose:
Verify Sepolia margin tests can bootstrap the adapter and read leverage data.
Steps checked:
Start the Sepolia bridge without signing, load markets, fetch leverage, and assert the read path works.
*/
runBootstrapTest('testnet margin: compiled JS adapter boots against Arbitrum Sepolia', async () => {
    const authToken = 'testnet-margin-bootstrap-token';
    const bridge = await startSepoliaBridge({ authToken, includeSigning: false });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 60000,
        });
        const markets = await exchange.loadMarkets();
        const symbol = pickTestSymbol(markets);
        const leverage = await exchange.fetchLeverage(symbol);

        assert.ok(Object.keys(markets).length > 0);
        assert.ok(symbol);
        assert.ok(leverage);
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify the implemented leverage update path works for a Sepolia signing wallet.
Steps checked:
Start the signed Sepolia bridge, set leverage, fetch leverage, and assert both result envelopes are usable.
*/
runMarginTest('testnet margin: setLeverage and fetchLeverage work for a signing wallet', async () => {
    const authToken = 'testnet-margin-leverage-token';
    const bridge = await startSepoliaBridge({ authToken, includeSigning: true });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 120000,
        });
        const markets = await exchange.loadMarkets();
        const symbol = pickTestSymbol(markets);

        const setResult = await exchange.setLeverage(2, symbol);
        assert.ok(setResult);
        assert.ok(extractResultId(setResult) || setResult.status || setResult.info);

        const leverage = await exchange.fetchLeverage(symbol);
        assert.ok(leverage);
        assert.ok(leverage.symbol === symbol || leverage.info);
        assert.ok(hasNumericField(leverage, 'leverage') || hasNumericField(leverage, 'longLeverage') || hasNumericField(leverage, 'shortLeverage'));
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify the current addMargin and reduceMargin limitation is reported consistently.
Steps checked:
Start the signed Sepolia bridge, call addMargin and reduceMargin, and assert both return the expected integration error.
*/
runMarginTest('testnet margin: addMargin and reduceMargin currently report the expected not-yet-implemented integration error', async () => {
    const authToken = 'testnet-margin-update-token';
    const bridge = await startSepoliaBridge({ authToken, includeSigning: true });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 120000,
        });
        const markets = await exchange.loadMarkets();
        const symbol = pickTestSymbol(markets);
        const leverage = await exchange.fetchLeverage(symbol);
        assert.ok(leverage);

        await expectMarginIntegrationError(exchange.addMargin(symbol, 1));
        await expectMarginIntegrationError(exchange.reduceMargin(symbol, 1));
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify implemented and not-yet-implemented margin paths behave predictably together.
Steps checked:
Start the signed Sepolia bridge, confirm setLeverage succeeds, then assert addMargin and reduceMargin fail with stable bridge errors.
*/
runMarginTest('testnet margin: leverage succeeds and margin update methods fail with stable bridge errors', async () => {
    const authToken = 'testnet-margin-envelope-token';
    const bridge = await startSepoliaBridge({ authToken, includeSigning: true });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 120000,
        });
        const markets = await exchange.loadMarkets();
        const symbol = pickTestSymbol(markets);

        const setResult = await exchange.setLeverage(2, symbol);
        assert.ok(setResult);
        assert.ok(typeof setResult === 'object');
        assert.ok(extractResultId(setResult) || setResult.status || setResult.info);

        await expectMarginIntegrationError(exchange.addMargin(symbol, 1));
        await expectMarginIntegrationError(exchange.reduceMargin(symbol, 1));
    } finally {
        await bridge.stop();
    }
});
