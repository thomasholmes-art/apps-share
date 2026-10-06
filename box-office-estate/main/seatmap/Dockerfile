# seatmap image. Part of box-office-estate (module 07, lab 07-hackathon-two-worlds).
# The jar is built here once. The dependency layer is cached, so a rebuild
# needs no registry access. logback-spring.xml is excluded from the build
# context (.dockerignore) because the container reads it from a bind mount.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/seatmap.jar /app/seatmap.jar
EXPOSE 8080
CMD ["java", "-jar", "/app/seatmap.jar"]
