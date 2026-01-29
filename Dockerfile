# syntax=docker/dockerfile:1
# --- STAGE 1: Frontend Build ---
FROM node:22-alpine AS frontend-build

RUN corepack enable && corepack prepare pnpm@latest --activate
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
FROM maven:3.9-eclipse-temurin-21 AS backend-build

# Define build arguments
ARG GITHUB_ACTOR

WORKDIR /app-backend

# Copy only the essential files
COPY pom.xml .

# DYNAMICALLY CREATE settings.xml directly in Dockerfile
RUN echo "<settings><servers>" > settings.xml && \
    echo "  <server><id>github-merkletrie</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "  <server><id>github-rlp</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "  <server><id>github-cryptoj</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "  <server><id>github</id><username>${GITHUB_ACTOR}</username><password>\${env.GITHUB_TOKEN}</password></server>" >> settings.xml && \
    echo "</servers></settings>" >> settings.xml

# Pre-download dependencies (cached if pom.xml doesn't change)
# Note: Some annotation processors may be downloaded during package, but main deps are cached
RUN --mount=type=secret,id=github_token \
    export GITHUB_TOKEN=$(cat /run/secrets/github_token) && \
    mvn dependency:resolve dependency:resolve-plugins -s settings.xml -B || true

# Copy backend source code
COPY src ./src

# Copy frontend build from the previous stage (AFTER dependency resolution!)
COPY --from=frontend-build /app-frontend/apps/web/dist ./src/main/resources/static

# Run the build (online - will download any missing deps like annotation processors)
RUN --mount=type=secret,id=github_token \
    export GITHUB_TOKEN=$(cat /run/secrets/github_token) && \
    mvn package -s settings.xml -DskipTests -B

# --- STAGE 3: Final Image ---
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Copy JAR from the previous stage (backend-build)
COPY --from=backend-build /app-backend/target/*.jar app.jar

# This line specifies the command to run on container start
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]