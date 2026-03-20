// Live Arbitrum public-data tests covering market metadata, tickers, and read-only endpoints.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    importGeneratedExchange,
    makeConfigText,
    pickTestSymbol,
    startBridgeServer,
} from './helpers/bridge-test-helpers.mjs';

// Live Arbitrum RPC used for public market-data coverage.
const rpcUrl = process.env.JSON_RPC_ARBITRUM;
// Test runner selection for live public-data coverage.
const runLive = rpcUrl ? test : test.skip;

async function withLiveBridge(fn) {
    const authToken = 'live-market-data-token';
    const configText = makeConfigText({
        rpcUrl,
        authToken,
        chainId: 42161,
        preloadMarkets: false,
    });
    const bridge = await startBridgeServer({ configText, token: authToken });
    try {
        const GmxExchange = await importGeneratedExchange();
        const exchange = new GmxExchange({
            bridgeUrl: bridge.baseUrl,
            token: authToken,
            timeout: 120000,
        });
        return await fn(exchange);
    } finally {
        await bridge.stop();
    }
}

/*
Purpose:
Verify the live bridge exposes the core public metadata and status surface.
Steps checked:
Start the live bridge, fetch markets, currencies, time, and status, then assert the canonical market and metadata are present.
*/
runLive('live market data: fetchMarkets, fetchCurrencies, fetchTime, fetchStatus', async () => {
    await withLiveBridge(async (exchange) => {
        const fetchedMarkets = await exchange.fetchMarkets();
        const currencies = await exchange.fetchCurrencies();
        const time = await exchange.fetchTime();
        const status = await exchange.fetchStatus();
        const marketMap = Object.fromEntries(fetchedMarkets.map((market) => [market.symbol, market]));
        const canonicalSymbol = pickTestSymbol(marketMap);
        const fetchedSymbols = new Set(fetchedMarkets.map((market) => market.symbol));

        assert.ok(fetchedMarkets.length > 0);
        assert.ok(fetchedSymbols.has(canonicalSymbol));
        assert.ok(currencies.USDC);
        assert.ok(currencies.ETH);
        assert.match(String(time), /^\d+$/);
        assert.equal(status.status, 'ok');
    });
});

/*
Purpose:
Verify the live bridge exposes the main public price and trade feeds.
Steps checked:
Start the live bridge, fetch ticker, tickers, OHLCV, and trades for a symbol, then assert each payload has the expected CCXT shape.
*/
runLive('live market data: fetchTicker, fetchTickers, fetchOHLCV, fetchTrades', async () => {
    await withLiveBridge(async (exchange) => {
        const markets = await exchange.fetchMarkets();
        const marketMap = Object.fromEntries(markets.map((market) => [market.symbol, market]));
        const symbol = pickTestSymbol(marketMap);

        const ticker = await exchange.fetchTicker(symbol);
        const tickers = await exchange.fetchTickers([symbol]);
        const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, 2);
        const trades = await exchange.fetchTrades(symbol, undefined, 5);

        assert.equal(ticker.symbol, symbol);
        assert.ok(tickers[symbol]);
        assert.ok(Array.isArray(ohlcv));
        assert.ok(ohlcv.length > 0);
        assert.ok(ohlcv.every((candle) => Array.isArray(candle) && candle.length === 6));
        assert.ok(Array.isArray(trades));
        if (trades.length > 0) {
            assert.equal(trades[0].symbol, symbol);
        }
    });
});

/*
Purpose:
Verify the live bridge exposes funding-rate and open-interest data.
Steps checked:
Start the live bridge, fetch current and historical funding/open-interest values, and assert the returned shapes are populated.
*/
runLive('live market data: fetchFundingRate, fetchFundingRateHistory, fetchOpenInterest, fetchOpenInterestHistory, fetchOpenInterests', async () => {
    await withLiveBridge(async (exchange) => {
        const markets = await exchange.fetchMarkets();
        const marketMap = Object.fromEntries(markets.map((market) => [market.symbol, market]));
        const symbol = pickTestSymbol(marketMap);

        const fundingRate = await exchange.fetchFundingRate(symbol);
        const fundingRateHistory = await exchange.fetchFundingRateHistory(symbol, undefined, 5);
        const openInterest = await exchange.fetchOpenInterest(symbol);
        const openInterestHistory = await exchange.fetchOpenInterestHistory(symbol, '1h', undefined, 5);
        const openInterests = await exchange.fetchOpenInterests([symbol]);

        assert.equal(fundingRate.symbol, symbol);
        assert.ok(Array.isArray(fundingRateHistory));
        assert.ok(fundingRateHistory.length > 0);
        assert.equal(openInterest.symbol, symbol);
        assert.ok(Array.isArray(openInterestHistory));
        assert.ok(openInterestHistory.length > 0);
        assert.ok(openInterests[symbol]);
    });
});
