.PHONY: install server ccxt-build test-js test-fork test-live test-testnet test-smoke-live

install:
	poetry install
	cd ccxt && npm install

server:
	poetry run python -m gmx_ccxt_server

ccxt-build:
	cd ccxt && npm run export-exchanges && npm run emitAPI && npm run tsBuild && npm run transpileRest && npm run copy-python-files

test-js: ccxt-build
	node --test --test-concurrency=1 tests/js/*.test.mjs

test-fork: ccxt-build
	node --test --test-concurrency=1 tests/js/gmx-smoke.test.mjs tests/js/bridge-contract.test.mjs tests/js/gmx-errors.test.mjs tests/js/gmx-trading.fork.test.mjs

test-live: ccxt-build
	node --test --test-concurrency=1 tests/js/gmx-smoke.test.mjs tests/js/gmx-market-data.live.test.mjs tests/js/gmx-account.live.test.mjs

test-smoke-live: ccxt-build
	node --test --test-concurrency=1 tests/js/gmx-smoke.test.mjs

test-testnet: ccxt-build
	node --test --test-concurrency=1 tests/js/gmx-smoke.test.mjs tests/js/gmx-trading.testnet.test.mjs tests/js/gmx-margin.testnet.test.mjs tests/js/gmx-lagoon.testnet.test.mjs
