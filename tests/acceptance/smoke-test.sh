#!/usr/bin/env bash

set -euo pipefail

# Acceptance smoke test for the Dockerised GMX CCXT bridge.
#
# What this script does:
# 1. Optionally loads local RPC and wallet secrets from .local-test.env.
# 2. Builds the middleware Docker image from the current checkout.
# 3. Rebuilds the local generated CCXT adapter used by docs/example.js.
# 4. Starts docker-compose.yaml against Arbitrum Sepolia with a signing wallet.
# 5. Waits for the bridge health endpoint to become ready.
# 6. Runs docs/example.js against that live bridge instance.
# 7. Always tears the Compose stack down, even if the example fails.
#
# Why Sepolia:
# The example opens and then closes a live GMX position. Running this flow on
# Arbitrum Sepolia keeps the test realistic while avoiding mainnet funds.
#
# Required environment:
# - JSON_RPC_ARBITRUM_SEPOLIA
# - GMX_PRIVATE_KEY
#
# Optional environment:
# - LOCAL_IMAGE_TAG
# - COMPOSE_PROJECT_NAME

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yaml"
LOCAL_ENV_FILE="${REPO_ROOT}/.local-test.env"

# Keep the default project name unique enough that it does not collide with a
# developer's normal local stack.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-gmx-ccxt-acceptance}"

# Build the image under a local tag so Compose can be forced to use the current
# checkout instead of the published GHCR image.
LOCAL_IMAGE_TAG="${LOCAL_IMAGE_TAG:-gmx-ccxt-middleware:local}"

# Intentionally use the checked-in Docker Compose default publish address so
# this script also validates the default bridge URL and no-auth startup path.
BRIDGE_URL="http://127.0.0.1:8000"

# Track success so cleanup can print logs only when something actually fails.
SMOKE_TEST_FAILED=1

require_command() {
    local command_name="$1"
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        echo "Required command not found: ${command_name}" >&2
        exit 1
    fi
}

require_env() {
    local variable_name="$1"
    if [[ -z "${!variable_name:-}" ]]; then
        echo "Required environment variable is not set: ${variable_name}" >&2
        exit 1
    fi
}

cleanup() {
    set +e

    # On failure, surface the container logs before tearing everything down so
    # the next debugging step is immediately visible.
    if [[ "${SMOKE_TEST_FAILED}" -ne 0 ]]; then
        echo
        echo "Smoke test failed. Recent bridge logs:"
        docker compose -f "${COMPOSE_FILE}" --project-name "${COMPOSE_PROJECT_NAME}" logs --no-color gmx-ccxt-server 2>/dev/null || true
    fi

    docker compose -f "${COMPOSE_FILE}" --project-name "${COMPOSE_PROJECT_NAME}" down --remove-orphans --volumes >/dev/null 2>&1 || true
}

trap cleanup EXIT

# Load machine-specific secrets if the repository entrypoint exists.
# The file is expected to source a user-managed secret file outside git.
if [[ -f "${LOCAL_ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${LOCAL_ENV_FILE}"
fi

require_command docker
require_command curl
require_command node
require_command make

require_env JSON_RPC_ARBITRUM_SEPOLIA
require_env GMX_PRIVATE_KEY

cd "${REPO_ROOT}"

echo "==> Rebuilding generated CCXT adapter"
# docs/example.js imports the locally generated adapter directly from
# ccxt/js/src/gmx.js, so rebuild it before exercising the end-to-end flow.
make ccxt-build

echo "==> Building local Docker image ${LOCAL_IMAGE_TAG}"
docker build -t "${LOCAL_IMAGE_TAG}" .

echo "==> Starting docker-compose stack on ${BRIDGE_URL}"

# Ensure stale containers from a previous acceptance run do not interfere with
# the next one.
docker compose -f "${COMPOSE_FILE}" --project-name "${COMPOSE_PROJECT_NAME}" down --remove-orphans --volumes >/dev/null 2>&1 || true
GMX_IMAGE="${LOCAL_IMAGE_TAG}" \
GMX_RPC_URL="${JSON_RPC_ARBITRUM_SEPOLIA}" \
GMX_PRIVATE_KEY="${GMX_PRIVATE_KEY}" \
docker compose -f "${COMPOSE_FILE}" --project-name "${COMPOSE_PROJECT_NAME}" up -d --pull never

echo "==> Waiting for bridge readiness"

# Poll /ping until the FastAPI container is ready. Because GMX_AUTH_TOKEN is
# intentionally left unset, this also checks that the default unauthenticated
# bridge mode works as expected.
for _ in $(seq 1 120); do
    if curl --silent --show-error --fail "${BRIDGE_URL}/ping" >/dev/null; then
        break
    fi
    sleep 1
done

curl --silent --show-error --fail "${BRIDGE_URL}/ping" >/dev/null

# Reuse the public example exactly as a user would, only pointing it at the
# Sepolia-backed bridge that this script just started. The example performs the
# ETH and USDC minimum-balance checks via exchange.fetchBalance() before
# attempting any trade.
echo "==> Running docs/example.js against the Dockerised bridge"
node docs/example.js

SMOKE_TEST_FAILED=0

echo "==> Smoke test completed successfully"
