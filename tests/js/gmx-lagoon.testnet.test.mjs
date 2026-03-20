// Sepolia Lagoon vault tests covering account and market flows against the remote adapter.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    getFreePort,
    importGeneratedExchange,
    makeBridgeEnv,
    pickTestSymbol,
    spawnManaged,
    startBridgeServer,
    waitForPing,
} from './helpers/bridge-test-helpers.mjs';

// Sepolia RPC used for Lagoon testnet coverage.
const sepoliaRpc = process.env.JSON_RPC_ARBITRUM_SEPOLIA;
// Lagoon vault address for Sepolia-specific bridge bootstrapping.
const lagoonVaultAddress = (process.env.GMX_LAGOON_TESTNET_VAULT_ADDRESS ?? '').trim();
// TradingStrategyModule address for the Lagoon Sepolia vault.
const lagoonTradingStrategyModuleAddress = (process.env.GMX_LAGOON_TESTNET_TRADING_STRATEGY_MODULE_ADDRESS ?? '').trim();
// Asset-manager key used to sign Lagoon Sepolia actions.
const lagoonAssetManagerPrivateKey = (process.env.GMX_LAGOON_TESTNET_ASSET_MANAGER_PRIVATE_KEY ?? '').trim();
// Optional flag controlling forwarded ETH execution-fee behavior.
const lagoonForwardEth = (process.env.GMX_LAGOON_TESTNET_FORWARD_ETH ?? '').trim().toLowerCase() === 'true';
// Explicit safety gate for real Lagoon trade-lifecycle tests.
const lagoonAllowTrades = (process.env.GMX_LAGOON_TESTNET_ALLOW_TRADES ?? '').trim().toLowerCase() === 'true';

// Whether the minimum Lagoon bridge configuration is present on Sepolia.
const hasLagoonBridgeEnv = Boolean(
    sepoliaRpc
    && lagoonVaultAddress
    && lagoonTradingStrategyModuleAddress
    && lagoonAssetManagerPrivateKey,
);

// Test runner selection for Sepolia bootstrap coverage.
const runBootstrapTest = sepoliaRpc ? test : test.skip;
// Test runner selection for Lagoon Sepolia read-path coverage.
const runLagoonTest = hasLagoonBridgeEnv ? test : test.skip;
// Test runner selection for Lagoon Sepolia trade-lifecycle coverage.
const runLagoonTradeTest = (hasLagoonBridgeEnv && lagoonAllowTrades) ? test : test.skip;

function bearerHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function extractOrderId(order) {
    return order?.id || order?.info?.order_key || order?.info?.tx_hash || null;
}

function hasAnyPositiveBalance(balance) {
    for (const bucket of [balance?.free, balance?.total, balance?.used]) {
        if (!bucket || typeof bucket !== 'object') {
            continue;
        }
        for (const value of Object.values(bucket)) {
            const numericValue = Number(value);
            if (Number.isFinite(numericValue) && numericValue > 0) {
                return true;
            }
        }
    }
    return false;
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

async function startSepoliaBridge({ authToken }) {
    const env = makeBridgeEnv({
        rpcUrl: sepoliaRpc,
        authToken,
        chainId: 421614,
        preloadMarkets: false,
    });
    return await startBridgeServer({ env, token: authToken });
}

async function startLagoonBridge({ authToken }) {
    const port = await getFreePort();
    const env = makeBridgeEnv({
        rpcUrl: sepoliaRpc,
        authToken,
        chainId: 421614,
        preloadMarkets: false,
        port,
        vaultAddress: lagoonVaultAddress,
    });
    const script = String.raw`
import asyncio
import os

import uvicorn

from eth_defi.gmx.ccxt.exchange import GMX
from eth_defi.gmx.lagoon.wallet import LagoonGMXTradingWallet
from eth_defi.erc_4626.vault_protocol.lagoon.vault import LagoonVault
from eth_defi.hotwallet import HotWallet
from eth_defi.vault.base import VaultSpec

from gmx_ccxt_server.app import create_app
from gmx_ccxt_server.runtime import BridgeRuntime

runtime = asyncio.run(BridgeRuntime.from_env())

vault = LagoonVault(
    runtime.exchange.web3,
    VaultSpec(chain_id=runtime.exchange.web3.eth.chain_id, vault_address=os.environ["GMX_LAGOON_TESTNET_VAULT_ADDRESS"]),
    trading_strategy_module_address=os.environ["GMX_LAGOON_TESTNET_TRADING_STRATEGY_MODULE_ADDRESS"],
)
asset_manager = HotWallet.from_private_key(os.environ["GMX_LAGOON_TESTNET_ASSET_MANAGER_PRIVATE_KEY"])
asset_manager.sync_nonce(runtime.exchange.web3)
lagoon_wallet = LagoonGMXTradingWallet(
    vault,
    asset_manager,
    forward_eth=os.environ.get("GMX_LAGOON_TESTNET_FORWARD_ETH", "").lower() in ("1", "true", "yes"),
)

params = runtime.config.gmx.to_exchange_parameters()
params["wallet"] = lagoon_wallet
runtime.exchange = GMX(params)

app = create_app(runtime)
uvicorn.run(
    app,
    host=runtime.config.server.host,
    port=runtime.config.server.port,
    log_level=runtime.config.server.log_level,
)
`;
    const childProcess = spawnManaged('poetry', ['run', 'python', '-u', '-c', script], {
        env: {
            ...env,
            GMX_LAGOON_TESTNET_VAULT_ADDRESS: lagoonVaultAddress,
            GMX_LAGOON_TESTNET_TRADING_STRATEGY_MODULE_ADDRESS: lagoonTradingStrategyModuleAddress,
            GMX_LAGOON_TESTNET_ASSET_MANAGER_PRIVATE_KEY: lagoonAssetManagerPrivateKey,
            GMX_LAGOON_TESTNET_FORWARD_ETH: String(lagoonForwardEth),
        },
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await waitForPing(`${baseUrl}/ping`, authToken);
    } catch (error) {
        const output = childProcess.getOutput();
        await childProcess.stop();
        throw new Error(`Lagoon bridge server failed to start\nSTDOUT:\n${output.stdout}\nSTDERR:\n${output.stderr}`);
    }
    return {
        baseUrl,
        async stop() {
            await childProcess.stop();
        },
    };
}

/*
Purpose:
Verify the generic Sepolia bridge bootstraps before any Lagoon-specific setup is involved.
Steps checked:
Start the standard Sepolia bridge, load markets, fetch status, and assert the public adapter path works.
*/
runBootstrapTest('testnet bootstrap: compiled JS adapter works with Sepolia market data and status', async () => {
    const authToken = 'lagoon-testnet-bootstrap-token';
    const bridge = await startSepoliaBridge({ authToken });
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
Verify Lagoon Sepolia read paths work when explicit Lagoon bridge configuration is present.
Steps checked:
Start the Lagoon bridge, inspect describe, then assert markets, status, balance, and positions are readable.
*/
runLagoonTest('lagoon testnet read-path: Lagoon bridge exposes status, balance, and positions', async () => {
    const authToken = 'lagoon-testnet-read-token';
    const bridge = await startLagoonBridge({ authToken });
    try {
        const response = await fetch(`${bridge.baseUrl}/describe`, {
            headers: bearerHeaders(authToken),
        });
        assert.equal(response.status, 200);

        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 120000,
        });

        const markets = await exchange.loadMarkets();
        const symbol = pickTestSymbol(markets);
        const balance = await exchange.fetchBalance();
        const positions = await exchange.fetchPositions();
        const status = await exchange.fetchStatus();

        assert.ok(Object.keys(markets).length > 0);
        assert.ok(symbol);
        assert.ok(balance.info !== undefined || balance.free !== undefined || balance.total !== undefined);
        assert.ok(Array.isArray(positions));
        assert.ok(status.status);
        assert.ok(hasAnyPositiveBalance(balance) || balance.info !== undefined);
    } finally {
        await bridge.stop();
    }
});

/*
Purpose:
Verify the guarded Lagoon Sepolia trade lifecycle once explicit trade enablement is provided.
Steps checked:
Start the Lagoon bridge, create a limit order, confirm it appears in open orders, fetch it by id, and cancel it.
*/
runLagoonTradeTest('lagoon testnet trade lifecycle: createLimitOrder and cancelOrder through Lagoon bridge', async () => {
    const authToken = 'lagoon-testnet-trade-token';
    const bridge = await startLagoonBridge({ authToken });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 120000,
        });

        const markets = await exchange.loadMarkets();
        const symbol = pickTestSymbol(markets);
        const createResult = await exchange.createLimitOrder(
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
        );

        const orderId = extractOrderId(createResult);
        assert.ok(orderId, 'createLimitOrder should return an id');
        assert.ok(createResult.status === 'open' || createResult.status === 'pending');

        const openOrders = await exchange.fetchOpenOrders(symbol, undefined, undefined, { pending_orders_only: true });
        const matchingOrder = openOrders.find((order) => extractOrderId(order) === orderId || isMatchingLimitOrder(order, { symbol, side: 'buy', price: 1 }));
        assert.ok(matchingOrder, 'expected created Lagoon order to appear in open orders');

        const fetchedOrder = await exchange.fetchOrder(orderId, symbol);
        assert.equal(extractOrderId(fetchedOrder), orderId);

        const cancelled = await exchange.cancelOrder(orderId, symbol);
        assert.ok(['cancelled', 'canceled', 'open'].includes(cancelled.status));
    } finally {
        await bridge.stop();
    }
});
