# Database image for box-office-estate (module 07, lab 07-hackathon-two-worlds):
# Postgres 16 with the schema and seed data, plus the tc tool the entry point
# uses to model the network link to the database host.
FROM postgres:16-alpine
RUN apk add --no-cache iproute2-tc
COPY initdb/ /docker-entrypoint-initdb.d/
COPY latency-entrypoint.sh /usr/local/bin/latency-entrypoint.sh
ENTRYPOINT ["latency-entrypoint.sh"]
CMD ["postgres"]
