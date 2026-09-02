FROM docker.io/library/eclipse-temurin:25-jre-alpine@sha256:3137541deb3cac6626b5d9a4a2187bc0d6a34312f858bd2c67dd01e732e6b682

RUN addgroup -S -g 10001 wallet \
    && adduser -S -D -H -u 10001 -G wallet wallet

WORKDIR /app
RUN mkdir -p /app/logs /app/wallet_logs \
    && chown -R wallet:wallet /app/logs /app/wallet_logs
COPY --chown=wallet:wallet app.jar /app/app.jar

# The JVM reads operator-supplied runtime flags directly from this variable;
# no shell expansion is needed in the entrypoint.
ENV JAVA_TOOL_OPTIONS=""

USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
