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
// Demo trade mode: open and close by default, or leave the opened position in place.
const TRADE_MODE = String(process.env.TRADE || "open_and_close")
  .trim()
  .toLowerCase();
// Small gas reserve to avoid starting a trade when the wallet is nearly empty.
const MIN_ETH_GAS_BALANCE = Number(process.env.MIN_ETH_GAS_BALANCE || "0.002");
// Conservative USDC requirement: position collateral plus a small operational cushion.
const MIN_USDC_BALANCE = Number(
  process.env.MIN_USDC_BALANCE ||
    String(POSITION_SIZE_USD / POSITION_LEVERAGE + 1.0),
);
const AUTHORITATIVE_POSITION_PARAMS = {
  open_positions_source: "rpc",
};

// Extract a normalised free/used/total balance triplet for one currency.
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

// Stop the demo early if the wallet does not meet a minimum balance requirement.
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

// Fetch wallet balances, log them, and enforce the demo minimums.
async function validateAndLogWalletBalances(exchange, gasBalance) {
  const balance = await exchange.fetchBalance();
  const usdcBalance = getCurrencyBalance(balance, "USDC");
  console.log("Wallet balances:", {
    gas: gasBalance,
    collateral: usdcBalance,
  });

  assertMinimumBalance(gasBalance, MIN_ETH_GAS_BALANCE, "Arbitrum gas");
  assertMinimumBalance(usdcBalance, MIN_USDC_BALANCE, "USDC collateral");
}

// Read the native gas token balance from fetchStatus() output.
function getGasStatusBalance(status) {
  const info = status?.info ?? {};
  return {
    currency: info.gasTokenSymbol ?? "native gas token",
    free: Number(info.gasTokenBalance ?? 0),
    used: 0,
    total: Number(info.gasTokenBalance ?? 0),
  };
}

// Compare wallet addresses without case or surrounding whitespace differences.
function normaliseAddress(address) {
  return String(address || "")
    .trim()
    .toLowerCase();
}

// Reject unsupported TRADE modes before the script submits any orders.
function validateTradeMode(tradeMode) {
  if (!["open_and_close", "open_only"].includes(tradeMode)) {
    throw new Error(
      `Unsupported TRADE mode "${tradeMode}". Expected "open_and_close" or "open_only".`,
    );
  }
}

// Return the first value that can be safely converted to a finite number.
function pickFirstFiniteNumber(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return null;
}

// Derive a USD position size from the best available position fields.
function getPositionSizeUsd(position) {
  return pickFirstFiniteNumber(
    position?.info?.position_size,
    position?.notional,
    position?.contracts && position?.entryPrice
      ? Number(position.contracts) * Number(position.entryPrice)
      : null,
  );
}

// Derive a USD profit figure from the best available position fields.
function getPositionProfitUsd(position) {
  return pickFirstFiniteNumber(
    position?.unrealizedPnl,
    position?.info?.pnl_usd,
    position?.info?.pnlUsd,
  );
}

// Format the most useful live position details for console logging.
function summarisePosition(position) {
  return {
    symbol: position?.symbol ?? null,
    side: position?.side ?? null,
    sizeUsd: getPositionSizeUsd(position),
    profitUsd: getPositionProfitUsd(position),
    profitPercent: pickFirstFiniteNumber(
      position?.percentage,
      position?.info?.percent_profit,
    ),
    contracts: pickFirstFiniteNumber(position?.contracts),
    entryPrice: pickFirstFiniteNumber(position?.entryPrice),
    markPrice: pickFirstFiniteNumber(position?.markPrice),
  };
}

// Load markets, rank them by open interest, and log the top five symbols.
async function logTopMarketsByOpenInterest(exchange) {
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
}

// Query the bridge /ping endpoint to confirm server health and wallet context.
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
reuse any pre-existing ETH position or otherwise open a 5 USD ETH long with USDC collateral, inspect positions again, then optionally close the active position depending on TRADE mode.
*/
// Run the end-to-end demo trade flow against the configured GMX bridge.
async function main() {
  console.warn(
    "Warning: this script places a real GMX trade through the configured server wallet.",
  );
  validateTradeMode(TRADE_MODE);

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
    tradeMode: TRADE_MODE,
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

  await validateAndLogWalletBalances(exchange, gasBalance);

  const positionsBeforeOpen = await exchange.fetchPositions(
    [SYMBOL],
    AUTHORITATIVE_POSITION_PARAMS,
  );
  console.log("Currently opened positions:", positionsBeforeOpen);
  let activePosition = positionsBeforeOpen.find(
    (position) => position.symbol === SYMBOL,
  );
  if (activePosition) {
    const existingPositionSummary = summarisePosition(activePosition);
    console.log(
      `Existing ${SYMBOL} position detected, skipping the demo open and reusing it for the close step:`,
      existingPositionSummary,
    );
  }

  await logTopMarketsByOpenInterest(exchange);

  if (!activePosition) {
    const openOrder = await exchange.createMarketBuyOrder(SYMBOL, 0, {
      size_usd: POSITION_SIZE_USD,
      leverage: POSITION_LEVERAGE,
      collateral_symbol: "USDC",
      wait_for_execution: true,
      slippage_percent: 0.005,
    });
    console.log("Opened ETH long:", openOrder);

    const positionsAfterOpen = await exchange.fetchPositions(
      [SYMBOL],
      AUTHORITATIVE_POSITION_PARAMS,
    );
    console.log("Positions after open:", positionsAfterOpen);
    activePosition = positionsAfterOpen.find(
      (position) => position.symbol === SYMBOL,
    );
  } else {
    console.log("Positions after open:", positionsBeforeOpen);
  }

  if (TRADE_MODE === "open_only") {
    console.log(
      `Leaving the active ${SYMBOL} position in place because TRADE=open_only.`,
    );
    return;
  }

  if (!activePosition) {
    throw new Error(`Expected an active ${SYMBOL} position to close, but none was found.`);
  }

  const activePositionSummary = summarisePosition(activePosition);
  const closeParams = {
    collateral_symbol: "USDC",
    reduceOnly: true,
    wait_for_execution: true,
    slippage_percent: 0.005,
  };
  if (activePositionSummary.sizeUsd !== null) {
    closeParams.size_usd = activePositionSummary.sizeUsd;
  }

  const closeOrder = await exchange.createOrder(
    SYMBOL,
    "market",
    activePosition.side === "short" ? "buy" : "sell",
    0,
    undefined,
    closeParams,
  );
  console.log("Closed active ETH position:", closeOrder);

  const positionsAfterClose = await exchange.fetchPositions(
    [SYMBOL],
    AUTHORITATIVE_POSITION_PARAMS,
  );
  console.log("Positions after close:", positionsAfterClose);
}

// Print the top-level script failure and propagate a non-zero exit code.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
