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
    ports:
      - "${LISTEN_PORT:-8080}:8080"
    volumes:
      - ./wallet_data:/app/wallet_data
      - ${LOGGING_DIR:-./wallet_logs}:/app/wallet_logs
    networks:
      - app_network
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18.1-alpine
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
      - ./db_data:/var/lib/postgresql/data
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
| `NODE_WEBHOOK_SECRET_KEY` | **Required.** Webhook secret for node callbacks |

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