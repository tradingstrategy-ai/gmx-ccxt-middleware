const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Base URL for the Dockerised GMX CCXT Middleware Server.
const GMX_SERVER_URL =
  process.env.GMX_SERVER_URL ||
  process.env.BRIDGE_URL ||
  "http://127.0.0.1:8000";
// Optional bearer token configured on the server container.
const GMX_SERVER_TOKEN =
  process.env.GMX_SERVER_TOKEN || process.env.BRIDGE_TOKEN || "";
// Optional expected wallet address for an extra sanity check against the server-reported address.
const GMX_WALLET_ADDRESS = (process.env.GMX_WALLET_ADDRESS || "").trim();
// Hardcoded GMX ETH perpetual symbol used in this example.
const SYMBOL = "ETH/USDC:USDC";
// Hardcoded example trade size expressed in USD.
const POSITION_SIZE_USD = 5.0;
// Hardcoded example leverage for the demo long position.
const POSITION_LEVERAGE = 2.0;
// Small gas reserve to avoid starting a trade when the wallet is nearly empty.
const MIN_ETH_GAS_BALANCE = Number(process.env.MIN_ETH_GAS_BALANCE || "0.002");
// Conservative USDC requirement: position collateral plus a small operational cushion.
const MIN_USDC_BALANCE = Number(
  process.env.MIN_USDC_BALANCE ||
    String(POSITION_SIZE_USD / POSITION_LEVERAGE + 1.0),
);

function getCurrencyBalance(balance, currency) {
  const account = balance?.[currency] ?? {};
  const free = Number(balance?.free?.[currency] ?? account.free ?? 0);
  const used = Number(balance?.used?.[currency] ?? account.used ?? 0);
  const total = Number(
    balance?.total?.[currency] ?? account.total ?? free + used,
  );

  return {
    currency,
    free,
    used,
    total,
  };
}

function assertMinimumBalance(currencyBalance, minimumRequired, purpose) {
  if (
    !Number.isFinite(currencyBalance.total) ||
    currencyBalance.total < minimumRequired
  ) {
    throw new Error(
      `Insufficient ${currencyBalance.currency} for ${purpose}. ` +
        `Need at least ${minimumRequired}, wallet has ${currencyBalance.total}.`,
    );
  }
}

function getGasStatusBalance(status) {
  const info = status?.info ?? {};
  return {
    currency: info.gasTokenSymbol ?? "native gas token",
    free: Number(info.gasTokenBalance ?? 0),
    used: 0,
    total: Number(info.gasTokenBalance ?? 0),
  };
}

function normaliseAddress(address) {
  return String(address || "")
    .trim()
    .toLowerCase();
}

async function fetchServerPing() {
  const response = await fetch(`${GMX_SERVER_URL.replace(/\/+$/, "")}/ping`, {
    headers: GMX_SERVER_TOKEN
      ? { Authorization: `Bearer ${GMX_SERVER_TOKEN}` }
      : {},
  });

  if (!response.ok) {
    throw new Error(
      `Failed to query GMX CCXT Middleware Server /ping: ${response.status} ${response.statusText}`,
    );
  }

  return await response.json();
}

/*
Purpose:
Demonstrate a real GMX CCXT Middleware Server trading flow end to end.
Steps checked:
Connect to the Dockerised server, check gas and collateral balances, inspect currently open positions,
open a 5 USD ETH long with USDC collateral, inspect positions again, then close the long.
*/
async function main() {
  console.warn(
    "Warning: this script places a real GMX trade through the configured server wallet.",
  );

  const adapterPath = path.resolve(__dirname, "../ccxt/js/src/gmx.js");
  const { default: GmxExchange } = await import(
    pathToFileURL(adapterPath).href
  );

  const exchange = new GmxExchange({
    bridgeUrl: GMX_SERVER_URL,
    token: GMX_SERVER_TOKEN,
    timeout: 180000,
  });

  const serverPing = await fetchServerPing();
  const status = await exchange.fetchStatus();
  const gasBalance = getGasStatusBalance(status);
  console.log("GMX CCXT Middleware Server wallet context:", {
    serverUrl: GMX_SERVER_URL,
    chain: serverPing.chain ?? null,
    chainId: serverPing.chainId ?? null,
    walletConfigured: Boolean(serverPing.walletConfigured),
    walletAddress: serverPing.walletAddress ?? null,
    gasTokenSymbol: status?.info?.gasTokenSymbol ?? null,
    gasTokenBalance: status?.info?.gasTokenBalance ?? null,
    expectedWalletAddress: GMX_WALLET_ADDRESS || null,
  });

  if (
    GMX_WALLET_ADDRESS &&
    serverPing.walletAddress &&
    normaliseAddress(GMX_WALLET_ADDRESS) !==
      normaliseAddress(serverPing.walletAddress)
  ) {
    throw new Error(
      `Server wallet address ${serverPing.walletAddress} does not match GMX_WALLET_ADDRESS ${GMX_WALLET_ADDRESS}.`,
    );
  }

  const balance = await exchange.fetchBalance();
  const usdcBalance = getCurrencyBalance(balance, "USDC");
  console.log("Wallet balances:", {
    gas: gasBalance,
    collateral: usdcBalance,
  });

  assertMinimumBalance(gasBalance, MIN_ETH_GAS_BALANCE, "Arbitrum gas");
  assertMinimumBalance(usdcBalance, MIN_USDC_BALANCE, "USDC collateral");

  const positionsBeforeOpen = await exchange.fetchPositions([SYMBOL]);
  console.log("Currently opened positions:", positionsBeforeOpen);
  if (positionsBeforeOpen.some((position) => position.symbol === SYMBOL)) {
    throw new Error(
      `Refusing to run while ${SYMBOL} already has an open position for this wallet.`,
    );
  }

  const markets = await exchange.loadMarkets();
  // `loadMarkets()` returns a symbol-keyed map, but its insertion order is not a useful ranking.
  // Fetch open interest explicitly and sort descending so "top 5 markets" has a clear meaning.
  const openInterests = await exchange.fetchOpenInterests(Object.keys(markets));
  const topMarkets = Object.keys(markets)
    .map((symbol) => ({
      symbol,
      openInterestValue: Number(
        openInterests?.[symbol]?.openInterestValue ?? 0,
      ),
    }))
    .sort((left, right) => right.openInterestValue - left.openInterestValue)
    .slice(0, 5);
  console.log("Top 5 markets by open interest (USD):", topMarkets);

  const openOrder = await exchange.createMarketBuyOrder(SYMBOL, 0, {
    size_usd: POSITION_SIZE_USD,
    leverage: POSITION_LEVERAGE,
    collateral_symbol: "USDC",
    wait_for_execution: true,
    slippage_percent: 0.005,
  });
  console.log("Opened ETH long:", openOrder);

  const positionsAfterOpen = await exchange.fetchPositions([SYMBOL]);
  console.log("Positions after open:", positionsAfterOpen);

  const closeOrder = await exchange.createOrder(
    SYMBOL,
    "market",
    "sell",
    0,
    undefined,
    {
      size_usd: POSITION_SIZE_USD,
      collateral_symbol: "USDC",
      reduceOnly: true,
      wait_for_execution: true,
      slippage_percent: 0.005,
    },
  );
  console.log("Closed ETH long:", closeOrder);

  const positionsAfterClose = await exchange.fetchPositions([SYMBOL]);
  console.log("Positions after close:", positionsAfterClose);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
