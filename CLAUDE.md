# Instructions to work with this repository

## Project overview

This repository exposes the Python GMX CCXT-compatible exchange from the `web3-ethereum-defi` submodule over HTTP and adds a remote `gmx` exchange to the `ccxt` submodule.

The main moving parts are:

- `src/gmx_ccxt_server/`: FastAPI GMX CCXT Middleware Server, config loading, runtime, serialisation
- `docker-compose.yaml`: default runtime entrypoint for the published GHCR image
- `tests/python/`: Python unit tests for the GMX CCXT Middleware Server runtime and HTTP contract
- `tests/js/`: JavaScript integration and smoke tests against the transpiled CCXT adapter
- `ccxt/`: upstream CCXT checkout and generated outputs
- `web3-ethereum-defi/`: upstream Python GMX implementation

## Working conventions

- Use British English in prose and documentation
- When running Python from this repository, prefer `poetry run python`
- Keep secrets and machine-specific RPC settings outside committed files
- Prefer targeted tests over running everything blindly

## Generated code rules

The `ccxt` submodule contains generated files. For adapter changes:

1. Edit the TypeScript source in `ccxt/ts/src/gmx.ts`
2. Rebuild generated outputs with `make ccxt-build`
3. Do not hand-edit generated files such as:
   - `ccxt/js/src/gmx.js`
   - `ccxt/python/ccxt/gmx.py`
   - `ccxt/php/gmx.php`

If the GMX CCXT Middleware Server contract changes, update the TypeScript adapter and regenerate the CCXT outputs in the same change.

## Install and build

Install dependencies:

```shell
make install
```

Build the CCXT adapter outputs:

```shell
make ccxt-build
```

## Running the GMX CCXT Middleware Server

Export GMX CCXT Middleware Server environment variables first:

```shell
export GMX_PRIVATE_KEY="0xyourprivatekey"
export GMX_SERVER_AUTH_TOKEN="change-me"
export GMX_SERVER_ADDRESS="127.0.0.1:8000"
```

Start the server:

```shell
make server
```

You can also run it directly:

```shell
poetry run python -m gmx_ccxt_server
```

## Test setup

The repository uses `.local-test.env` as a small shell entrypoint for local secrets. Source it before any RPC-backed tests:

```shell
source .local-test.env
```

Useful environment variables for this project:

- `JSON_RPC_ARBITRUM`
- `JSON_RPC_ARBITRUM_SEPOLIA`
- `GMX_PRIVATE_KEY`
- `GMX_WALLET_ADDRESS`
- `GMX_RPC_URL`
- `GMX_SERVER_ADDRESS`
- `GMX_SERVER_AUTH_TOKEN`

Not every workflow needs every variable. Read-only smoke tests can run without private key material.

## Running tests

Run the Python GMX CCXT Middleware Server tests:

```shell
poetry run pytest tests/python/test_runtime.py
```

Run the JavaScript suite against the transpiled adapter:

```shell
make test-js
```

Run fork-based integration tests:

```shell
source .local-test.env
make test-fork
```

Run live smoke tests:

```shell
source .local-test.env
make test-smoke-live
```

## GMX and Anvil caveat

GMX order execution depends on keeper and oracle mechanics. Anvil is suitable for read-heavy coverage and some pending-order lifecycle checks, but it is not the default place to require successful end-to-end GMX trade execution.

Do not treat failed live execution on a plain fork as an automatic GMX CCXT Middleware Server or adapter regression unless the test specifically sets up the extra execution machinery required by GMX.

## Formatting code

Run ruff to format code using Poetry:

```shell
poetry run ruff format
```

## Pull requests

- Pull request description must have sections Why (the rational of change), Lessons learnt (memory for future agents) and Summary (what was changed). No test plan or verification section.
- Only push changes to remote when asked, never update pull requess automatically.
- Never push directly to a master if not told explicitly
- If the user ask to open a pull request as feature then start the PR title with "feat:" prefix and also add one line about the feature into `CHANGELOG.md`
- Each changelog entry should follow the date of the PR in YYYY-MM-DD format. Example: Something was updated (2026-01-01).
- Before opening or updating a pull request, format the code
- When merging pull request, squash and merge commits and use the PR description as the commit message
- If continuous integration (CI) tests fail on your PR, and they are marked flaky, run tests locally to repeat the issue if it is real flakiness or regression

## Specific rules

### Python rules

- For data structures, prefer `dataclass(slots=True)`
- Use threaded instead of async Python code
- Always type hint function arguments and return values
- Try to use Python and Pandas `apply()` and other functional helpers instead of slow for and while loops
- Use `any()` and `all()` with generators and list comprehension when checking if a collection member has one or more matches, instead of using slow for loops
- All functions that do network reads to get data should be prefixed with `fetch_` instead of `get_`
- Always try to return `Iterator` instead of `list` from a function call to make functions faster
- For long runnign for loops, use `tqdm` and `tqdm_loggable.auto` module for progress bar. As an example, see `lead_scan_core.py`.
- For visualusations, use Plotly. For chart titles, use heading case as explained above.
- Use module level imports, not function level lazy imports, whenever possible
- Never write generic `Exception e:` catch but always catch a specific exception if we can
- Never silently swallow exceptions and th

### Code comments

- For code comments, Use Sphinx restructured text style
- For documenting dataclass and Enum members, use Sphinx `#: comment here` line comment above variable, not `:param:`
- If a. class function overloads a function inherited from the parent, and there is nothing to comment, do not repeat the code comment and leave it empty instead

### Type hinting

- Use `HexAddress` instead of `str` for blockchain addresses
- For percent like numbers, do not use raw float, but use `eth_defi.types.Percent` type alias

### Logging

- For logging, use the module level `logger = logging.getLogger(__name__)` pattern
- When logging using `logger.info()`, `logging.debug()` or similar,
  prefer %s and %f unexpanded string syntax instead of Python string interpolation, because of performance reasons

### Documentation

- All API modules should have stub entry under `docs/source/api` and cross-referenced in `docs/source/api/index` table of contents
- See `docs/source/api/index.rst` and `docs/source/api/lagoon/index.rst` as examples
- When writing documentation, in sentences, include inline links to the source pages. Link each page only once, preferably earler in the text.

### datetime

- Use naive UTC datetimes everywhere
- When using datetime class use `import datetime.datetime` and use `datetime.datetime` and `datetime.timedelta` as type hints
- Instead of `datetime.datetime.utcnow()` use `native_datetime_utc_now()` that is compatible across Python versions

### Enum

- For string enums, both members and values must in snake_case

### Pytest

- Never use test classes in pytest
- `pytest` tests should not have stdout output like `print`
- Instead of manual float fuzzy comparison like `assert abs(aave_total_pnl - 96.6087) < 0.01` use `pytest.approx()`
- For DuckDB testing, make sure the database is always closed using finally clause or fixtures
- Always use fixture and test functions, never use test classes
- For Anvil mainnet fork based tests, whici use a fixed block number, in asserts check for absolute number values instead of relative values like above zero, because values never change.
  Expect for Monad, as Monad blockchain does not support archive nodes and historical state.
- For reuseable testing code, use `testing` modules under `eth_defi` - do not nyt try to import "tests" as it does not work with pytest
