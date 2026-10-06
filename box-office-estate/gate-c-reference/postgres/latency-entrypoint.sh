#!/bin/sh
# Entry point of the box-office-estate database container. Part of the
# application behind module 07, lab 07-hackathon-two-worlds.
#
# The database runs in the same compose network as its clients, where a round
# trip costs well under a millisecond. In the deployment this estate stands in
# for, the database sits on a separate host and every round trip crosses a
# network link. The netem queueing discipline adds that link's one-way delay
# to every packet the database sends, so each statement costs one link round
# trip, as it does in production. It needs NET_ADMIN (cap_add in
# docker-compose.yml) and changes nothing inside Postgres.
set -e

LINK_DELAY=3.5ms

iface="$(ip route show default 2>/dev/null | awk '{print $5; exit}')"
if [ -n "$iface" ]; then
  tc qdisc replace dev "$iface" root netem delay "$LINK_DELAY" \
    || echo "latency-entrypoint: could not apply the link delay on $iface" >&2
fi

exec docker-entrypoint.sh "$@"
