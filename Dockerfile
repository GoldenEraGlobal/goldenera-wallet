# syntax=docker/dockerfile:1
# --- STAGE 1: Frontend Build ---
FROM node:24.20.0-alpine AS frontend-build

RUN apk upgrade --no-cache
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
ENV CI=true

# Set the working directory
WORKDIR /app-frontend

# Copy only dependency-related files first (for better caching)
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY frontend/apps/web/package.json ./apps/web/
COPY frontend/packages/api/package.json ./packages/api/
COPY frontend/packages/core/package.json ./packages/core/
COPY frontend/packages/ui/package.json ./packages/ui/

# Install dependencies (this layer will be cached if package files don't change)
RUN pnpm install --frozen-lockfile

# Now copy the rest of the source code
COPY frontend/ .

# Build the application
RUN pnpm --filter ./apps/web build

# --- STAGE 2: Backend Build ---
FROM maven:3.9.16-eclipse-temurin-25@sha256:d67198007bb4441b07d45587320f83154de80ece3608f80408ef14c6ea847753 AS backend-dependencies

# Define build arguments
ARG GITHUB_ACTOR
ARG LOCAL_MAVEN_ARTIFACTS_SHA256=""

WORKDIR /app-backend

# This bind mount is not persisted; fail if developer env files enter the filtered context.
RUN --mount=type=bind,target=/build-context,readonly \
    test -z "$(find /build-context -type f \( -name '.env' -o -name '.env.*' \) -print -quit)"

# Copy only the essential files
COPY pom.xml LICENSE ./

# Optional verified public release bootstrap for local builds without GitHub Packages credentials.
# The tar contains only CryptoJ/RLP JARs, their public POMs and Maven local-origin markers.
RUN --mount=type=secret,id=local_maven_artifacts,required=false \
    if [ -f /run/secrets/local_maven_artifacts ]; then \
      test -n "$LOCAL_MAVEN_ARTIFACTS_SHA256" && \
      echo "$LOCAL_MAVEN_ARTIFACTS_SHA256  /run/secrets/local_maven_artifacts" | sha256sum -c - && \
      mkdir -p /root/.m2/repository && tar -xf /run/secrets/local_maven_artifacts -C /root/.m2/repository; \
    fi

# DYNAMICALLY CREATE settings.xml directly in Dockerfile
RUN echo "<settings><servers>" > settings.xml && \
    echo "  <server><id>github-merkletrie</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "  <server><id>github-rlp</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "  <server><id>github-cryptoj</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "  <server><id>github</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "</servers></settings>" >> settings.xml

# Pre-download dependencies (cached if pom.xml doesn't change)
# Note: Some annotation processors may be downloaded during package, but main deps are cached
RUN --mount=type=secret,id=github_token,required=false \
    export GITHUB_TOKEN="" && \
    if [ -f /run/secrets/github_token ]; then export GITHUB_TOKEN=$(cat /run/secrets/github_token); fi && \
    mvn dependency:resolve dependency:resolve-plugins -s settings.xml -B || true

# Copy backend source code
FROM backend-dependencies AS backend-build
COPY src ./src

# src/main/resources/static is generated PWA output; remove old hashed chunks.
RUN rm -rf ./src/main/resources/static

# Copy frontend build from the previous stage (AFTER dependency resolution!)
COPY --from=frontend-build /app-frontend/apps/web/dist ./src/main/resources/static

# Run the build (online - will download any missing deps like annotation processors)
RUN --mount=type=secret,id=github_token,required=false \
    export GITHUB_TOKEN="" && \
    if [ -f /run/secrets/github_token ]; then export GITHUB_TOKEN=$(cat /run/secrets/github_token); fi && \
    mvn package -s settings.xml -DskipTests -B

# --- STAGE 3: Final Image ---
FROM eclipse-temurin:25-jre-alpine@sha256:3137541deb3cac6626b5d9a4a2187bc0d6a34312f858bd2c67dd01e732e6b682

RUN apk upgrade --no-cache

WORKDIR /app

# Copy JAR from the previous stage (backend-build)
COPY --from=backend-build /app-backend/target/*.jar app.jar

# This line specifies the command to run on container start
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
