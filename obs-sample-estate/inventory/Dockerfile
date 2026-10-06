# inventory image (obs-inventory): builds the Spring Boot fat JAR with Maven
# and runs it on a Java 21 JRE as /app/inventory.jar, the path lab 03's
# override starts under the OpenTelemetry Java agent. The Maven stage needs
# Maven Central the first time the image is built (at image bake); the
# finished image is pre-built on the lab VM. No EXPOSE: inventory publishes
# no port, and `docker compose ps` shows an empty PORTS column for it, as in
# lab 01.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/inventory.jar /app/inventory.jar
CMD ["java", "-jar", "/app/inventory.jar"]
