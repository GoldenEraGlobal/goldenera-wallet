#!/bin/bash

# Stop on error
set -e

echo "🧹 Cleaning up everything (node_modules, package.json, dirs)..."
rm -rf node_modules pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json apps packages

# ---------------------------------------------------------
# 1. Initialize Root & Workspace Config
# ---------------------------------------------------------
echo "📦 Initializing Root Workspace..."
pnpm init

# Set packageManager explicitly
node -e 'const pkg=require("./package.json"); pkg.packageManager="pnpm@10.25.0"; require("fs").writeFileSync("./package.json", JSON.stringify(pkg, null, 2))'

# Create pnpm-workspace.yaml
echo "packages:
  - 'apps/*'
  - 'packages/*'
" > pnpm-workspace.yaml

# Create turbo.json
echo '{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {}
  }
}' > turbo.json

# Install Root Dependencies
echo "⬇️ Installing Root Dependencies..."
pnpm add -D turbo typescript eslint prettier @types/node -w

# Create directory structure
mkdir -p apps/web apps/extension packages/ui packages/core packages/config

# ---------------------------------------------------------
# 2. Setup Packages: Core
# ---------------------------------------------------------
echo "🔧 Setting up @project/core..."
cd packages/core
pnpm init

# Rename package and setup scripts
node -e 'const pkg=require("./package.json"); pkg.name="@project/core"; pkg.main="dist/index.js"; pkg.types="dist/index.d.ts"; pkg.scripts={build:"tsup src/index.ts --format cjs,esm --dts"}; require("fs").writeFileSync("./package.json", JSON.stringify(pkg, null, 2))'

# Install deps for Core - REPLACED GENERIC LIBS WITH GOLDENERA
pnpm add @goldenera/cryptoj zod zustand @tanstack/react-query axios uuid firebase
pnpm add -D @types/uuid @types/node typescript tsup

mkdir src
echo "export const core = 'core';" > src/index.ts
cd ../..

# ---------------------------------------------------------
# 3. Setup Packages: UI
# ---------------------------------------------------------
echo "🎨 Setting up @project/ui..."
cd packages/ui
pnpm init

node -e 'const pkg=require("./package.json"); pkg.name="@project/ui"; pkg.main="dist/index.js"; pkg.types="dist/index.d.ts"; pkg.scripts={build:"tsup src/index.ts --format cjs,esm --dts"}; require("fs").writeFileSync("./package.json", JSON.stringify(pkg, null, 2))'

pnpm add react react-dom class-variance-authority clsx tailwind-merge lucide-react react-hook-form zod @hookform/resolvers
pnpm add -D tailwindcss postcss autoprefixer typescript tsup @types/react @types/react-dom

mkdir src
echo "export const ui = 'ui';" > src/index.ts
cd ../..

# ---------------------------------------------------------
# 4. Setup Apps: Web (Vite)
# ---------------------------------------------------------
echo "🌐 Setting up Web App (Vite + Capacitor)..."
cd apps/web
pnpm create vite . --template react-ts

# Install Dependencies
pnpm add @capacitor/core @capacitor/android @capacitor/ios @stackflow/react @stackflow/plugin-renderer-web @stackflow/plugin-history-sync
pnpm add @project/core@workspace:* @project/ui@workspace:*
pnpm add -D @capacitor/cli tailwindcss postcss autoprefixer

npx cap init App com.project.app --web-dir dist
cd ../..

# ---------------------------------------------------------
# 5. Setup Apps: Extension (Plasmo)
# ---------------------------------------------------------
echo "🧩 Setting up Extension (Plasmo)..."
cd apps/extension

# Plasmo init
pnpm create plasmo . --yes

pnpm add @project/core@workspace:* @project/ui@workspace:*
pnpm add -D tailwindcss postcss autoprefixer storage

cd ../..

# ---------------------------------------------------------
# 6. Final Install
# ---------------------------------------------------------
echo "🔗 Linking everything..."
pnpm install

echo "✅ SUCCESS! Project initialized with @goldenera/cryptoj."