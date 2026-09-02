# 💰 GoldenEra Wallet

**GoldenEra Wallet** is the official web-based wallet application for the GoldenEra blockchain. It provides a user-friendly interface for managing your GoldenEra assets, sending and receiving transactions, and interacting with the blockchain through connected nodes.

## ✨ Features

- 🔐 **Secure wallet management** - Create and manage multiple wallets
- 💸 **Send & Receive** - Easy transaction creation and QR code support
- 📊 **Transaction history** - View all your transfers, including pending transactions
- 📱 **PWA support** - Install as a progressive web app on mobile devices
- 🔑 **Biometric authentication** - Secure access with fingerprint/Face ID (on supported devices)

---

## CI image publication

- A push to a non-default internal branch publishes the verified multi-platform image as the mutable `ghcr.io/goldeneraglobal/goldenera-wallet:dev` alias and also preserves `sha-<full-commit-sha>`.
- A push to the current default-branch head publishes only the immutable full-SHA alias.
- An approved `vX.Y.Z` tag publishes immutable full-SHA and semantic-version aliases plus the GitHub Release.
- Pull requests and manual validation runs never write images or releases.

The `dev` alias is intentionally mutable and must not be used for production deployment. Production must use the tag-and-digest form documented below.

---

## �️ Prerequisites

- **Docker** and **Docker Compose** plugin installed
- A running **GoldenEra Node** to connect to

### Verify Docker Installation

```bash
docker --version
docker compose version
```

---

## 🚀 Quick Start

### 1. Create Project Directory

```bash
mkdir goldenera-wallet && cd goldenera-wallet
```

### 2. Create `docker-compose.yml`

```yaml
services:
  wallet:
    image: ${WALLET_IMAGE:?Set WALLET_IMAGE to an immutable tag-and-digest reference from the release notes}
    container_name: goldenera_wallet
    restart: unless-stopped
    pull_policy: missing
    env_file:
      - .env
    environment:
      - POSTGRESQL_HOST=db
      # Keep the in-container log path fixed; .env LOGGING_DIR selects the host bind source below.
      - LOGGING_DIR=/app/wallet_logs
      - LOGGING_FILE=${LOGGING_FILE:-wallet.log}
      - JAVA_TOOL_OPTIONS=-Xmx4g -Xms1g
    ports:
      - "127.0.0.1:${LISTEN_PORT:-8080}:${LISTEN_PORT:-8080}"
    volumes:
      - ${LOGGING_DIR:-./wallet_logs}:/app/wallet_logs
    networks:
      - app_network
    depends_on:
      db:
        condition: service_healthy

  db:
    image: ${POSTGRES_IMAGE:?Set POSTGRES_IMAGE to a reviewed PostgreSQL tag-and-digest reference}
    container_name: goldenera_db
    restart: unless-stopped
    env_file:
      - .env
    environment:
      POSTGRES_DB: ${POSTGRESQL_DB_NAME:-wallet_db}
      POSTGRES_USER: ${POSTGRESQL_USERNAME:-postgres}
      POSTGRES_PASSWORD: ${POSTGRESQL_PASSWORD:-password}
      POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"
    volumes:
      - ./db_data:/var/lib/postgresql
    networks:
      - app_network
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "pg_isready -U ${POSTGRESQL_USERNAME:-postgres} -d ${POSTGRESQL_DB_NAME:-wallet_db}",
        ]
      interval: 5s
      timeout: 5s
      retries: 5

networks:
  app_network:
    driver: bridge
    name: goldenera_network
```

#### `.env` Configuration

Create a file named `.env`. You **must** configure the variables marked as required below.

```dotenv
# ===========================================
# GoldenEra Wallet Configuration
# ===========================================

# Spring profile
SPRING_PROFILES_ACTIVE=prod

# Required immutable image references. Copy the wallet tag/digest from its release notes
# and resolve the reviewed PostgreSQL multi-platform digest before deployment.
WALLET_IMAGE=ghcr.io/goldeneraglobal/goldenera-wallet:sha-<full-commit-sha>@sha256:<manifest-digest>
POSTGRES_IMAGE=postgres:18.6-alpine@sha256:<reviewed-index-digest>

# Wallet API Port
LISTEN_PORT=8080

# ===========================================
# PostgreSQL Database
# ===========================================
POSTGRESQL_HOST=localhost
POSTGRESQL_PORT=5432
POSTGRESQL_DB_NAME=wallet_db
POSTGRESQL_USERNAME=postgres
POSTGRESQL_PASSWORD=your_strong_password_here

# ===========================================
# Admin Credentials
# ===========================================
# ⚠️ IMPORTANT: Change these immediately!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_me_immediately

# ===========================================
# Node Connection
# ===========================================
# Configure connection to your GoldenEra Node
NODE_BASE_URL=https://your-node.example.com
NODE_API_KEY=your_node_api_key
NODE_WEBHOOK_SECRET_KEY=your_webhook_secret
NODE_WEBHOOK_UID=replace_with_existing_webhook_uuid

# Optional node request deadlines; durations such as 500ms or 3s
NODE_CONNECT_TIMEOUT=2s
NODE_READ_TIMEOUT=3s

# Empty by default: do not trust any client-supplied forwarding headers.
# Set this only to the exact trusted reverse-proxy address regex for your deployment.
TRUSTED_PROXY_REGEX=

# Device-registration retirement rollout (see Deployment safety below)
DEVICE_REGISTRATION_MUTATIONS_ENABLED=true
DEVICE_CLEANUP_ENABLED=false
DEVICE_CLEANUP_BATCH_SIZE=500
DEVICE_CLEANUP_MAX_BATCHES_PER_RUN=100

# ===========================================
# Logging
# ===========================================
LOGGING_DIR=./wallet_logs
LOGGING_FILE=wallet.log
LOGGING_LEVEL_ROOT=INFO
LOGGING_LEVEL_GLOBAL_GOLDENERA=INFO

# ===========================================
# Rate Limiting
# ===========================================
# Global rate limit (requests per second per IP)
THROTTLING_GLOBAL_CAPACITY=500
THROTTLING_GLOBAL_REFILL_TOKENS=500

# PUBLIC CORE (Per IP) - Unauthenticated access to Core
# Strict: 100 tokens capacity, refills 50 per second.
THROTTLING_PUBLIC_CORE_CAPACITY=100
THROTTLING_PUBLIC_CORE_REFILL_TOKENS=50

# Concurrent Core API admission
THROTTLING_GLOBAL_IN_FLIGHT_REQUESTS=256
THROTTLING_GLOBAL_IN_FLIGHT_BYTES=268435456
THROTTLING_PER_IP_IN_FLIGHT_REQUESTS=32
THROTTLING_PER_IP_IN_FLIGHT_BYTES=67108864
```

### 4. Configuration Guide

| Variable | Description |
|:---------|:------------|
| `WALLET_IMAGE` | **Required.** Immutable wallet tag plus manifest digest copied from the verified release notes |
| `POSTGRES_IMAGE` | **Required.** Reviewed PostgreSQL tag plus multi-platform manifest digest |
| `LISTEN_PORT` | Port where the wallet UI will be accessible. Default: `8080` |
| `POSTGRESQL_PASSWORD` | **Required.** Set a strong database password |
| `ADMIN_USERNAME` | Admin panel username. **Change from default!** |
| `ADMIN_PASSWORD` | Admin panel password. **Change from default!** |
| `NODE_BASE_URL` | **Required.** URL of your GoldenEra node |
| `NODE_API_KEY` | **Required.** API key for node authentication |
| `NODE_WEBHOOK_SECRET_KEY` | **Required.** Signing secret issued with the node API key used for the webhook |
| `NODE_WEBHOOK_UID` | **Required.** UUID of an existing, enabled node webhook targeting `/api/core/v1/node-webhook/handle` |
| `NODE_CONNECT_TIMEOUT` | Connection deadline, default `2s`, valid range `1ms`–`10s` |
| `NODE_READ_TIMEOUT` | Response deadline including the body, default `3s`, valid range `1ms`–`30s` |
| `TRUSTED_PROXY_REGEX` | Empty by default. Only set an exact trusted proxy regex when the backend cannot be reached around that proxy |
| `DEVICE_REGISTRATION_MUTATIONS_ENABLED` | Keep `true` for the first rolling replacement; set `false` only after every old backend replica has drained |
| `DEVICE_CLEANUP_ENABLED` | Keep `false` until registration is non-mutating everywhere and the full 180-day retention window has elapsed |
| `JAVA_TOOL_OPTIONS` | Optional JVM flags read directly by Java, for example `-Xms1g -Xmx4g` |

---

## Deployment safety and node setup

The Compose example is for a **new, empty PostgreSQL 18 installation**. PostgreSQL
18 stores its data in `/var/lib/postgresql/18/docker`; the persistent mount must
cover `/var/lib/postgresql`, as shown above. Do not simply remount an existing
`db_data` directory or delete it to resolve an initialization error. Preserve the
old image/configuration, take and verify a backup, inspect its existing major
version/layout, and use an explicit dump/restore or supported `pg_upgrade` plan
into a separate destination when required. The wallet update does not move or
modify existing host database directories.

The runtime image runs as UID/GID `10001:10001`. Before the first start, create
its bind-mounted log directory with matching ownership (or the equivalent mapped
IDs when Docker user namespaces are enabled):

```bash
sudo install -d -m 0750 -o 10001 -g 10001 ./wallet_logs
```

In this Compose example, `.env` `LOGGING_DIR` selects only the host directory
mounted at the fixed in-container path `/app/wallet_logs`; apply the same ownership
to any custom host value. `/app/wallet_data` is not used by the application and
must not be mounted; wallet secrets live in each browser, while backend state
remains in PostgreSQL.

Upgrade existing deployments before replacing the old image: the hardened runtime
intentionally no longer evaluates `JAVA_OPTS` through a shell. Move the same JVM
arguments to `JAVA_TOOL_OPTIONS`; leaving them only in `JAVA_OPTS` means Java will
not apply them.

Retire legacy device registration in three operational phases; do not collapse
these into one mixed-version rollout:

1. Deploy this build to every backend replica with
   `DEVICE_REGISTRATION_MUTATIONS_ENABLED=true` and `DEVICE_CLEANUP_ENABLED=false`.
   This adds the cleanup gate while preserving registration touches made by cached
   PWAs and old replicas.
2. After every old backend replica has drained, restart/roll only this build with
   `DEVICE_REGISTRATION_MUTATIONS_ENABLED=false`. Keep cleanup disabled and retain
   the browser identifier throughout the cached-client overlap window.
3. Enable `DEVICE_CLEANUP_ENABLED=true` only after registration has been
   non-mutating everywhere for at least the 180-day retention period. Cleanup
   deliberately excludes `NULL last_seen_at` rows because unknown activity is not
   proof of staleness; handle those rows only through a separately reviewed
   migration.

The wallet port is bound to host loopback by default. Put it behind your HTTPS
reverse proxy for external access. Forwarding headers are ignored until
`TRUSTED_PROXY_REGEX` identifies that proxy; never use `.*`. Restrict network access
so clients cannot bypass the proxy, and have the proxy overwrite incoming
`X-Forwarded-For` and protocol headers. Determine its actual source IP from your
network deployment; Docker bridge source addresses are not necessarily loopback.

Before starting the wallet, create a node API key with the read/core/explorer and
webhook permissions needed by the wallet. Create and enable a node webhook whose
URL reaches this wallet's `/api/core/v1/node-webhook/handle` endpoint. Copy the
returned webhook UUID to `NODE_WEBHOOK_UID`, and the API key's webhook signing
secret to `NODE_WEBHOOK_SECRET_KEY`. The wallet subscribes to NEW_BLOCK events
as a background task; it does not create the webhook destination itself. Invalid
or unresolved UUID configuration now fails application startup instead of
silently trying to subscribe to a placeholder.

Read-only node operations have at most three attempts with 250ms between attempts
(default response budget about 9.5s). Signed transaction submissions are never
retried automatically: a timeout can occur after the node has accepted the tx.
Check transaction status before resubmitting. Balance requests are additionally
limited to 1–100 addresses, at most 100 token filters, 2000 result rows and 20 node
pages within a 10s page-scheduling budget; a currently running node attempt retains
its configured deadline. Narrow large queries instead of requesting all chain data.
Transfer pages allow sizes 1–100 and offsets up to 100000 rows.

---

## 🏃 Running the Wallet

Start the wallet application:

```bash
docker compose up -d
```

Check the logs:

```bash
docker compose logs -f wallet
```

Access the wallet at: **http://localhost:8080**

---

## 📚 API Documentation

The wallet includes Swagger UI for API exploration:

**[http://localhost:8080/swagger-ui/index.html](http://localhost:8080/swagger-ui/index.html)**

---

## 🔧 Development

### Tech Stack

- **Backend:** Java 21, Spring Boot
- **Frontend:** React, TypeScript, Vite
- **Database:** PostgreSQL
- **Build:** Maven, pnpm

### Local Development

```bash
# Backend
./mvnw spring-boot:run

# Frontend
cd frontend
pnpm install
pnpm dev
```

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
