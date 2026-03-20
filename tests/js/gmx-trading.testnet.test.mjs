// Sepolia trading tests covering EOA-backed order and position flows through the bridge.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeBridgeEnv,
    pickTestSymbol,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Sepolia RPC used for EOA trading coverage.
const sepoliaRpc = process.env.JSON_RPC_ARBITRUM_SEPOLIA;
// Signing key used for Sepolia EOA trading operations.
const privateKey = (process.env.GMX_PRIVATE_KEY ?? '').trim();
// Optional wallet address override passed alongside the Sepolia signing key.
const walletAddress = (process.env.GMX_WALLET_ADDRESS ?? '').trim();
// Whether we have the signing material needed for Sepolia write-path tests.
const hasSigningCredentials = privateKey !== '';

// Test runner selection for Sepolia bootstrap coverage.
const runBootstrapTest = sepoliaRpc ? test : test.skip;
// Test runner selection for Sepolia trading coverage.
const runTradingTest = (sepoliaRpc && hasSigningCredentials) ? test : test.skip;

function bearerHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function startSepoliaBridge({ authToken, includeSigning = false }) {
    const env = makeBridgeEnv({
        rpcUrl: sepoliaRpc,
        authToken,
        chainId: 421614,
        privateKey: includeSigning ? privateKey : '',
        walletAddress: includeSigning ? walletAddress : '',
        preloadMarkets: false,
    });
    return await startBridgeServer({ env, token: authToken });
}

function extractOrderId(order) {
    return order?.id || order?.info?.order_key || order?.info?.tx_hash || null;
}

function isMatchingLimitOrder(order, { symbol, side, price }) {
    if (!order) {
        return false;
    }
    const sameSymbol = order.symbol === symbol;
    const sameSide = order.side === side;
    const sameType = order.type === 'limit';
    const orderPrice = Number(order.price);
    const samePrice = Number.isFinite(orderPrice) && Math.abs(orderPrice - price) < 1e-9;
    return sameSymbol && sameSide && sameType && samePrice;
}

async function waitForOrder(exchange, symbol, predicate, params = {}, timeoutMs = 60000) {
    const started = Date.now();
    let lastOrders = [];
    while ((Date.now() - started) < timeoutMs) {
        lastOrders = await exchange.fetchOpenOrders(symbol, undefined, undefined, params);
        const found = lastOrders.find(predicate);
        if (found) {
            return found;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Timed out waiting for order after ${timeoutMs}ms: ${JSON.stringify(lastOrders, null, 2)}`);
}

function hasAnyPositiveBalance(balance) {
    for (const bucket of [balance?.free, balance?.total, balance?.used]) {
        if (!bucket || typeof bucket !== 'object') {
            continue;
        }
        for (const value of Object.values(bucket)) {
            const numberValue = Number(value);
            if (Number.isFinite(numberValue) && numberValue > 0) {
                return true;
            }
        }
    }
    return false;
}

function isExpectedTestnetOrderFailure(error) {
    if (!error || typeof error !== 'object') {
        return false;
    }
    if (!['InvalidOrder', 'InsufficientFunds', 'ExchangeError'].includes(error.name)) {
        return false;
    }
    return /reverted|insufficient|collateral|allowance|approval|execution fee|not enough|order creation tx reverted/i.test(error.message ?? '');
}

async function createOrderOrAssertExpectedFailure(createPromise) {
    try {
        return await createPromise;
    } catch (error) {
        assert.ok(isExpectedTestnetOrderFailure(error), `Unexpected Sepolia order failure: ${error?.name}: ${error?.message}`);
        return null;
    }
}

/*
Purpose:
Verify the Sepolia adapter bootstraps correctly even without signing enabled.
Steps checked:
Start the unsigned Sepolia bridge, load markets, fetch status, and assert the public path is healthy.
*/
runBootstrapTest('testnet bootstrap: compiled JS adapter works with RPC-only Arbitrum Sepolia config', async () => {
    const authToken = 'testnet-bootstrap-token';
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
        const status = await exchange.fetchStatus();

        assert.ok(Object.keys(markets).length > 0);
        assert.ok(symbol);
        assert.ok(status.status);
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify the main Sepolia order lifecycle through the bridge for a signing wallet.
Steps checked:
Start the signed Sepolia bridge, create an order, handle the expected success-or-revert path, then fetch, list, cancel, and inspect private trade history when applicable.
*/
runTradingTest('testnet trading: createOrder, fetchOpenOrders, fetchOrder, cancelOrder, and fetchMyTrades work on Sepolia', async () => {
    const authToken = 'testnet-trading-order-token';
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
        const balance = await exchange.fetchBalance();
        assert.ok(balance);
        assert.ok(hasAnyPositiveBalance(balance) || balance.info !== undefined || balance.free !== undefined);

        const createResult = await createOrderOrAssertExpectedFailure(
            exchange.createOrder(
                symbol,
                'limit',
                'buy',
                0,
                1,
                {
                    size_usd: 10.0,
                    leverage: 2.0,
                    collateral_symbol: 'ETH',
                    wait_for_execution: false,
                    execution_buffer: 2.2,
                    slippage_percent: 0.005,
                },
            ),
        );
        if (createResult === null) {
            return;
        }

        const createOrderId = extractOrderId(createResult);
        assert.ok(createOrderId, 'createOrder should return an order id or tx hash');
        assert.ok(createResult.status === 'open' || createResult.status === 'pending');

        const openOrder = await waitForOrder(
            exchange,
            symbol,
            (order) => isMatchingLimitOrder(order, { symbol, side: 'buy', price: 1 }) || extractOrderId(order) === createOrderId,
            { pending_orders_only: true },
        );

        const openOrderId = extractOrderId(openOrder);
        assert.ok(openOrderId, 'open order should have an id');

        const fetchedOrder = await exchange.fetchOrder(openOrderId, symbol);
        assert.ok(fetchedOrder);
        assert.equal(extractOrderId(fetchedOrder), openOrderId);

        const openOrders = await exchange.fetchOpenOrders(symbol, undefined, undefined, { pending_orders_only: true });
        assert.ok(openOrders.some((order) => extractOrderId(order) === openOrderId));

        const orders = await exchange.fetchOrders(symbol);
        assert.ok(orders.some((order) => extractOrderId(order) === openOrderId));

        const cancelled = await exchange.cancelOrder(openOrderId, symbol);
        assert.ok(['cancelled', 'canceled', 'open'].includes(cancelled.status));

        const openAfter = await exchange.fetchOpenOrders(symbol, undefined, undefined, { pending_orders_only: true });
        assert.ok(!openAfter.some((order) => extractOrderId(order) === openOrderId));

        const myTrades = await exchange.fetchMyTrades(symbol);
        assert.ok(Array.isArray(myTrades));
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify the dedicated limit-order helper follows the same Sepolia lifecycle expectations.
Steps checked:
Start the signed Sepolia bridge, create a limit order, handle the expected success-or-revert path, then fetch and cancel the order when created.
*/
runTradingTest('testnet trading: createLimitOrder lifecycle works on Sepolia', async () => {
    const authToken = 'testnet-trading-limit-token';
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
        const createResult = await createOrderOrAssertExpectedFailure(
            exchange.createLimitOrder(
                symbol,
                'buy',
                0,
                1,
                {
                    size_usd: 10.0,
                    leverage: 2.0,
                    collateral_symbol: 'ETH',
                    wait_for_execution: false,
                    execution_buffer: 2.2,
                    slippage_percent: 0.005,
                },
            ),
        );
        if (createResult === null) {
            return;
        }

        const limitOrderId = extractOrderId(createResult);
        assert.ok(limitOrderId, 'createLimitOrder should return an order id or tx hash');
        assert.ok(createResult.status === 'open' || createResult.status === 'pending');

        const pendingOrder = await waitForOrder(
            exchange,
            symbol,
            (order) => isMatchingLimitOrder(order, { symbol, side: 'buy', price: 1 }) || extractOrderId(order) === limitOrderId,
            { pending_orders_only: true },
        );

        const pendingOrderId = extractOrderId(pendingOrder);
        assert.ok(pendingOrderId, 'pending order should expose an id');

        const fetchedOrder = await exchange.fetchOrder(pendingOrderId, symbol);
        assert.equal(extractOrderId(fetchedOrder), pendingOrderId);

        const cancelled = await exchange.cancelOrder(pendingOrderId, symbol);
        assert.ok(['cancelled', 'canceled', 'open'].includes(cancelled.status));
    } finally {
        await bridge.stop();
    }
});
