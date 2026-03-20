# syntax=docker/dockerfile:1.7

FROM python:3.11-slim

ARG POETRY_VERSION=2.1.4
ARG GIT_VERSION_TAG=dev
ARG GIT_COMMIT_MESSAGE=unknown
ARG GIT_VERSION_HASH=unknown

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    POETRY_NO_INTERACTION=1 \
    PIP_CACHE_DIR=/root/.cache/pip \
    POETRY_CACHE_DIR=/root/.cache/pypoetry \
    GMX_SERVER_ADDRESS=0.0.0.0:8000

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential curl git \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install "poetry==${POETRY_VERSION}"

COPY pyproject.toml poetry.lock README.md /app/
COPY src /app/src
COPY web3-ethereum-defi /app/web3-ethereum-defi

RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=cache,target=/root/.cache/pypoetry \
    poetry install --only main --no-ansi

LABEL org.opencontainers.image.title="GMX CCXT Middleware" \
      org.opencontainers.image.description="FastAPI bridge for the GMX CCXT Python adapter" \
      org.opencontainers.image.version="${GIT_VERSION_TAG}" \
      org.opencontainers.image.revision="${GIT_VERSION_HASH}"

EXPOSE 8000

CMD ["python", "-m", "gmx_ccxt_server"]
