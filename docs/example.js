const path = require("node:path");
const util = require("node:util");
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
// Optional verbose mode for dumping raw exchange payloads during debugging.
const VERBOSE_OUTPUT = /^(1|true|yes)$/i.test(
  String(process.env.VERBOSE_OUTPUT || process.env.DEBUG_OUTPUT || "").trim(),
);
// Small gas reserve to avoid starting a trade when the wallet is nearly empty.
const MIN_ETH_GAS_BALANCE = Number(process.env.MIN_ETH_GAS_BALANCE || "0.002");
// Conservative USDC requirement: position collateral plus a small operational cushion.
const MIN_USDC_BALANCE = Number(
  process.env.MIN_USDC_BALANCE ||
    String(POSITION_SIZE_USD / POSITION_LEVERAGE + 1.0),
);
/*
Position reads versus order reads
================================

This example intentionally uses `fetchPositions(..., { open_positions_source: "rpc" })`
for position snapshots, but it is important to understand what that means:

1. `fetchOrder(orderId)` tracks the lifecycle of a specific GMX order.
   The adapter stores the GMX `order_key`, checks whether the order is still
   pending in the GMX DataStore, and then resolves the final keeper execution
   result. For order-status questions such as "did my close order execute?" or
   "what was the final execution tx/hash/price?", `fetchOrder()` is the
   authoritative API.

2. `fetchPositions()` is different. It is only a point-in-time position
   snapshot. Even with the RPC source it does not reconcile against a specific
   order id; it simply asks GMX for current position state and formats the
   response. Immediately after a close order, that snapshot can still show the
   previous position for a short period, or show an in-flight state while GMX
   keeper/oracle updates settle.

3. Because of that distinction, this example uses `fetchPositions()` for
   human-readable before/after context, but the order returned by
   `createOrder()` / `createMarketBuyOrder()` is the thing to trust for order
   execution status. If you need strict confirmation that the close completed,
   poll `fetchOrder(closeOrder.id)` first and treat `fetchPositions()` as a
   follow-up verification step instead of the primary signal.
*/
const AUTHORITATIVE_POSITION_PARAMS = {
  open_positions_source: "rpc",
};
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const USE_COLOUR =
  Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);

// Wrap text in ANSI styles when the current terminal supports colour.
function colourise(text, ...styles) {
  if (!USE_COLOUR) {
    return text;
  }

  return `${styles.join("")}${text}${ANSI.reset}`;
}

// Print a highlighted section heading for the current script phase.
function logSection(title) {
  console.log(`\n${colourise(title, ANSI.bold, ANSI.cyan)}`);
}

// Print one labelled value inside the current output section.
function logField(label, value) {
  console.log(`  ${colourise(`${label}:`, ANSI.dim)} ${value}`);
}

// Print an informational message with the standard accent colour.
function logInfo(message) {
  console.log(colourise(message, ANSI.cyan));
}

// Print a success message for a completed step.
function logSuccess(message) {
  console.log(colourise(message, ANSI.green));
}

// Print a warning message for risky or important operator attention.
function logWarning(message) {
  console.warn(colourise(message, ANSI.bold, ANSI.yellow));
}

// Print an error message in a visibly distinct style.
function logError(message) {
  console.error(colourise(message, ANSI.bold, ANSI.red));
}

// Format a numeric value with consistent decimal precision for console output.
function formatNumber(value, options = {}) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 6,
  }).format(numberValue);
}

// Format a value as a USD amount for human-readable summaries.
function formatUsd(value) {
  const formatted = formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatted === "n/a" ? formatted : `$${formatted}`;
}

// Format a token amount with an optional token symbol suffix.
function formatTokenAmount(value, symbol) {
  const formatted = formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
  if (formatted === "n/a") {
    return formatted;
  }

  return symbol ? `${formatted} ${symbol}` : formatted;
}

// Format a numeric value as a human-readable USD price.
function formatPrice(value) {
  const formatted = formatNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  return formatted === "n/a" ? formatted : `$${formatted}`;
}

// Format a numeric value as a percentage string.
function formatPercent(value) {
  const formatted = formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
  return formatted === "n/a" ? formatted : `${formatted}%`;
}

// Format a numeric value as a leverage-style multiple.
function formatMultiple(value) {
  const formatted = formatNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
  return formatted === "n/a" ? formatted : `${formatted}x`;
}

// Shorten a long identifier by keeping the start and end visible.
function truncateMiddle(value, startLength = 8, endLength = 6) {
  const text = String(value || "");
  if (!text) {
    return "n/a";
  }

  if (text.length <= startLength + endLength + 3) {
    return text;
  }

  return `${text.slice(0, startLength)}...${text.slice(-endLength)}`;
}

// Render a raw object for opt-in verbose debugging output.
function inspectVerbose(value) {
  return util.inspect(value, {
    depth: null,
    colors: USE_COLOUR,
    compact: false,
  });
}

// Print a verbose object dump only when debug-style output is enabled.
function logVerboseBlock(title, value) {
  if (!VERBOSE_OUTPUT) {
    return;
  }

  console.log(`\n${colourise(`${title} (verbose)`, ANSI.bold, ANSI.dim)}`);
  console.log(inspectVerbose(value));
}

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

// Print the current gas and collateral balances in a compact operator-friendly format.
function logBalances(gasBalance, usdcBalance) {
  logSection("Wallet Balances");
  logField(
    gasBalance.currency,
    `${formatTokenAmount(gasBalance.free, gasBalance.currency)} free`,
  );
  logField("USDC", `${formatUsd(usdcBalance.free)} free`);
  logField(
    "Minimum required",
    `${formatTokenAmount(MIN_ETH_GAS_BALANCE, gasBalance.currency)} gas, ${formatUsd(MIN_USDC_BALANCE)} collateral`,
  );
}

// Fetch wallet balances, log them, and enforce the demo minimums.
async function validateAndLogWalletBalances(exchange, gasBalance) {
  const balance = await exchange.fetchBalance();
  const usdcBalance = getCurrencyBalance(balance, "USDC");
  logBalances(gasBalance, usdcBalance);
  logVerboseBlock("Wallet balances", {
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

// Print the currently configured server, chain, wallet, and gas context.
function logWalletContext(serverPing, status, gasBalance) {
  logSection("Wallet Context");
  logField("Server", GMX_SERVER_URL);
  logField("Trade mode", TRADE_MODE);
  logField(
    "Chain",
    `${serverPing.chain ?? "n/a"} (${serverPing.chainId ?? "n/a"})`,
  );
  logField(
    "Wallet",
    serverPing.walletConfigured
      ? truncateMiddle(serverPing.walletAddress)
      : colourise("not configured", ANSI.red),
  );
  logField(
    "Expected wallet",
    GMX_WALLET_ADDRESS ? truncateMiddle(GMX_WALLET_ADDRESS) : "not set",
  );
  logField(
    "Gas balance",
    formatTokenAmount(gasBalance.total, status?.info?.gasTokenSymbol ?? "ETH"),
  );
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
    position?.sizeUsd,
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
    position?.profitUsd,
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
      position?.profitPercent,
      position?.percentage,
      position?.info?.percent_profit,
    ),
    contracts: pickFirstFiniteNumber(position?.contracts),
    entryPrice: pickFirstFiniteNumber(position?.entryPrice),
    markPrice: pickFirstFiniteNumber(position?.markPrice),
    leverage: pickFirstFiniteNumber(
      position?.leverage,
      position?.info?.leverage,
    ),
    collateral: pickFirstFiniteNumber(
      position?.collateral,
      position?.initialMargin,
      position?.info?.initial_collateral_amount_usd,
    ),
  };
}

// Convert a parsed position summary into a single readable headline line.
function formatPositionSummary(summary) {
  return [
    `${summary.symbol ?? "unknown"} ${summary.side ?? "position"}`,
    `size ${formatUsd(summary.sizeUsd)}`,
    `entry ${formatPrice(summary.entryPrice)}`,
    `mark ${formatPrice(summary.markPrice)}`,
    `PnL ${formatUsd(summary.profitUsd)} (${formatPercent(summary.profitPercent)})`,
    `lev ${formatMultiple(summary.leverage)}`,
  ].join(" | ");
}

// Build the display headline for one position row.
function getPositionHeadline(position) {
  return formatPositionSummary(summarisePosition(position));
}

// Print zero or more positions as compact one-line summaries.
function logPositionList(title, positions) {
  logSection(title);

  if (!positions.length) {
    logField("Positions", colourise("none", ANSI.green));
    return;
  }

  positions.forEach((position, index) => {
    console.log(`  ${index + 1}. ${getPositionHeadline(position)}`);
  });
}

// Extract the order fields that matter most for console reporting.
function summariseOrder(order) {
  return {
    symbol: order?.symbol ?? null,
    side: order?.side ?? null,
    status: order?.status ?? null,
    sizeUsd: pickFirstFiniteNumber(order?.cost, order?.info?.size_delta_usd),
    filledAmount: pickFirstFiniteNumber(order?.filled, order?.amount),
    averagePrice: pickFirstFiniteNumber(
      order?.average,
      order?.price,
      order?.info?.execution_price,
    ),
    feeCost: pickFirstFiniteNumber(order?.fee?.cost),
    feeCurrency: order?.fee?.currency ?? null,
    executionFeeEth: pickFirstFiniteNumber(order?.info?.execution_fee_eth),
    txHash: order?.info?.tx_hash ?? order?.id ?? null,
    executionTxHash: order?.info?.execution_tx_hash ?? null,
    datetime: order?.datetime ?? null,
  };
}

// Format the order fee breakdown into one readable string.
function formatFeeSummary(summary) {
  const parts = [];
  if (summary.feeCurrency && summary.feeCost !== null) {
    parts.push(formatTokenAmount(summary.feeCost, summary.feeCurrency));
  }
  if (summary.executionFeeEth !== null) {
    parts.push(
      `${formatTokenAmount(summary.executionFeeEth, "ETH")} execution`,
    );
  }

  return parts.length ? parts.join(" + ") : "n/a";
}

// Print a compact summary of one submitted or executed order.
function logOrderSummary(title, order) {
  const summary = summariseOrder(order);

  logSection(title);
  logField("Symbol", summary.symbol ?? "n/a");
  logField("Side", summary.side ?? "n/a");
  logField("Status", colourise(summary.status ?? "n/a", ANSI.green));
  logField("Size", formatUsd(summary.sizeUsd));
  logField(
    "Filled",
    formatNumber(summary.filledAmount, { maximumFractionDigits: 8 }),
  );
  logField("Average price", formatPrice(summary.averagePrice));
  logField("Fee", formatFeeSummary(summary));
  logField("Created at", summary.datetime ?? "n/a");
  logField("Submit tx", truncateMiddle(summary.txHash, 12, 10));
  logField("Execution tx", truncateMiddle(summary.executionTxHash, 12, 10));
}

// Print the ranked open-interest market list in a compact table-like form.
function logTopMarkets(topMarkets) {
  logSection("Top Markets By Open Interest");
  topMarkets.forEach((market, index) => {
    console.log(
      `  ${index + 1}. ${market.symbol} | OI ${formatUsd(market.openInterestValue)}`,
    );
  });
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
  logTopMarkets(topMarkets);
  logVerboseBlock("Top 5 markets by open interest", topMarkets);
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
  logWarning(
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
  logWalletContext(serverPing, status, gasBalance);
  logVerboseBlock("GMX CCXT Middleware Server wallet context", {
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

  // This is a position snapshot only.
  // It answers "what position state does GMX report right now?" but it does not
  // answer "did a specific order finish executing?".
  //
  // In other words:
  // - `fetchPositions()` is good for operator visibility
  // - `fetchOrder(orderId)` is the correct API for order lifecycle tracking
  //
  // We still use the RPC-backed position view here because it is the most
  // authoritative read-side source exposed by the adapter, but it is still a
  // snapshot and may briefly lag a just-executed close.
  const positionsBeforeOpen = await exchange.fetchPositions(
    [SYMBOL],
    AUTHORITATIVE_POSITION_PARAMS,
  );
  logPositionList("Positions Before Open", positionsBeforeOpen);
  logVerboseBlock("Positions before open", positionsBeforeOpen);
  let activePosition = positionsBeforeOpen.find(
    (position) => position.symbol === SYMBOL,
  );
  if (activePosition) {
    const existingPositionSummary = summarisePosition(activePosition);
    logInfo(
      `Existing ${SYMBOL} position detected. Skipping the demo open and reusing it for the close step.`,
    );
    logField("Reused position", formatPositionSummary(existingPositionSummary));
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
    logOrderSummary("Open Order", openOrder);
    logVerboseBlock("Opened ETH long", openOrder);

    // This second position read is only a convenience snapshot so the example
    // can show the newly opened exposure in a friendly format.
    //
    // If this example ever needs stricter sequencing around order completion,
    // the correct next step would be:
    //   `await exchange.fetchOrder(openOrder.id, SYMBOL)`
    // because `fetchOrder()` follows the GMX order key and keeper execution
    // flow, whereas `fetchPositions()` only reports the latest visible position
    // state.
    const positionsAfterOpen = await exchange.fetchPositions(
      [SYMBOL],
      AUTHORITATIVE_POSITION_PARAMS,
    );
    logPositionList("Positions After Open", positionsAfterOpen);
    logVerboseBlock("Positions after open", positionsAfterOpen);
    activePosition = positionsAfterOpen.find(
      (position) => position.symbol === SYMBOL,
    );
  } else {
    logPositionList("Positions After Open", positionsBeforeOpen);
    logVerboseBlock("Positions after open", positionsBeforeOpen);
  }

  if (TRADE_MODE === "open_only") {
    logSuccess(
      `Leaving the active ${SYMBOL} position in place because TRADE=open_only.`,
    );
    return;
  }

  if (!activePosition) {
    throw new Error(
      `Expected an active ${SYMBOL} position to close, but none was found.`,
    );
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
  logOrderSummary("Close Order", closeOrder);
  logVerboseBlock("Closed active ETH position", closeOrder);

  // Confirm the final close result through the order-centric API instead of a
  // fresh position snapshot. `fetchOrder()` follows the GMX order key and is
  // the correct source for "did this close order actually execute?".
  const confirmedCloseOrder = await exchange.fetchOrder(closeOrder.id, SYMBOL);
  logOrderSummary("Close Order Confirmed", confirmedCloseOrder);
  logVerboseBlock("Close order confirmed", confirmedCloseOrder);

  if (confirmedCloseOrder?.status !== "closed") {
    throw new Error(
      `Close order ${closeOrder.id} did not resolve to status=closed. Actual status: ${confirmedCloseOrder?.status ?? "unknown"}.`,
    );
  }

  logSuccess("Close order confirmed. All ok.");
}

// Print the top-level script failure and propagate a non-zero exit code.
main().catch((error) => {
  logError(error instanceof Error ? error.message : String(error));
  if (VERBOSE_OUTPUT) {
    console.error(inspectVerbose(error));
  }
  process.exitCode = 1;
});
