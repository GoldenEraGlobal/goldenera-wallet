# 💰 GoldenEra Wallet

**GoldenEra Wallet** is the official web-based wallet application for the GoldenEra blockchain. It provides a user-friendly interface for managing your GoldenEra assets, sending and receiving transactions, and interacting with the blockchain through connected nodes.

## ✨ Features

- 🔐 **Secure wallet management** - Create and manage multiple wallets
- 💸 **Send & Receive** - Easy transaction creation and QR code support
- 📊 **Transaction history** - View all your transfers, including pending transactions
- 📱 **PWA support** - Install as a progressive web app on mobile devices
- 🔑 **Biometric authentication** - Secure access with fingerprint/Face ID (on supported devices)

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
    image: ghcr.io/goldeneraglobal/goldenera-wallet:latest
    container_name: goldenera_wallet
    restart: unless-stopped
    pull_policy: always
    env_file:
      - .env
    environment:
      - POSTGRESQL_HOST=db
      - LOGGING_FILE=${LOGGING_FILE:-wallet.log}
      - JAVA_OPTS=-Xmx4g -Xms1g
    ports:
      - "127.0.0.1:${LISTEN_PORT:-8080}:${LISTEN_PORT:-8080}"
    volumes:
      - ./wallet_data:/app/wallet_data
      - ${LOGGING_DIR:-./wallet_logs}:/app/wallet_logs
    networks:
      - app_network
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18.6-alpine
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
```

### 4. Configuration Guide

| Variable | Description |
|:---------|:------------|
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