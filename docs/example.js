const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Bridge base URL for the Dockerised GMX CCXT middleware.
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:8000';
// Optional bearer token configured on the bridge container.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
// Hardcoded GMX ETH perpetual symbol used in this example.
const SYMBOL = 'ETH/USDC:USDC';
// Hardcoded example trade size expressed in USD.
const POSITION_SIZE_USD = 5.0;
// Hardcoded example leverage for the demo long position.
const POSITION_LEVERAGE = 2.0;

/*
Purpose:
Demonstrate a real mainnet bridge flow end to end.
Steps checked:
Connect to the Dockerised bridge, load markets, open a 5 USD ETH long with USDC collateral, inspect positions, then close the long.
*/
async function main() {
    console.warn('Warning: this script places real Arbitrum mainnet trades through the configured bridge wallet.');

    const adapterPath = path.resolve(__dirname, '../ccxt/js/src/gmx.js');
    const { default: GmxExchange } = await import(pathToFileURL(adapterPath).href);

    const exchange = new GmxExchange({
        bridgeUrl: BRIDGE_URL,
        token: BRIDGE_TOKEN,
        timeout: 180000,
    });

    const markets = await exchange.loadMarkets();
    // `loadMarkets()` returns a symbol-keyed map, but its insertion order is not a useful ranking.
    // Fetch open interest explicitly and sort descending so "top 5 markets" has a clear meaning.
    const openInterests = await exchange.fetchOpenInterests(Object.keys(markets));
    const topMarkets = Object.keys(markets)
        .map((symbol) => ({
            symbol,
            openInterestValue: Number(openInterests?.[symbol]?.openInterestValue ?? 0),
        }))
        .sort((left, right) => right.openInterestValue - left.openInterestValue)
        .slice(0, 5);
    console.log('Top 5 markets by open interest (USD):', topMarkets);

    const openOrder = await exchange.createMarketBuyOrder(SYMBOL, 0, {
        size_usd: POSITION_SIZE_USD,
        leverage: POSITION_LEVERAGE,
        collateral_symbol: 'USDC',
        wait_for_execution: true,
        slippage_percent: 0.005,
    });
    console.log('Opened ETH long:', openOrder);

    const positionsAfterOpen = await exchange.fetchPositions([SYMBOL]);
    console.log('Positions after open:', positionsAfterOpen);

    const closeOrder = await exchange.createOrder(SYMBOL, 'market', 'sell', 0, undefined, {
        size_usd: POSITION_SIZE_USD,
        collateral_symbol: 'USDC',
        reduceOnly: true,
        wait_for_execution: true,
        slippage_percent: 0.005,
    });
    console.log('Closed ETH long:', closeOrder);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
