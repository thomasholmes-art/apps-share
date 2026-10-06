#!/usr/bin/env python3
"""Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).

Test T2: reads orders-api's output (docker compose logs --no-log-prefix) and
checks the lines a cold purchase made at <purchase-at-ms> wrote against the
formats in spec section 1.3. Prints one JSON object.

Usage: t2-lines.py <orders-api-log> <purchase-at-ms>
"""
import json
import re
import sys
from datetime import datetime, timezone

log_file, at_ms = sys.argv[1], int(sys.argv[2])
lines = open(log_file, encoding='utf-8', errors='replace').read().splitlines()

LEGACY = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) orders: (.*)$')


def utc_ms(iso):
    return int(datetime.strptime(iso, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc).timestamp() * 1000)


legacy = []
for i, line in enumerate(lines):
    m = LEGACY.match(line)
    if m and utc_ms(m.group(1)) >= at_ms - 1000:
        legacy.append((i, utc_ms(m.group(1)), m.group(2)))

out = {'checks': {}}
c = out['checks']
publish = next(((i, t) for i, t, text in legacy if text == 'seats held, publishing payment job'), None)
abandon = next(((i, t) for i, t, text in legacy if text == 'payment call abandoned after 2000ms'), None)
release = next(((i, t, text) for i, t, text in legacy if text.startswith('releasing holds for order ')), None)
c['new order line'] = any(re.fullmatch(r'new order seats=\d+ event=\d+ currency=GBP', text) for _, _, text in legacy)
c['publish line'] = publish is not None
c['abandon line'] = abandon is not None
c['release line'] = release is not None
if publish and abandon:
    out['publish_to_abandon_ms'] = abandon[1] - publish[1]
if abandon:
    j = abandon[0]
    c['stack after abandon'] = (
        j + 3 < len(lines)
        and lines[j + 1] == 'Error: payment authorisation did not respond'
        and re.match(r'^    at authorise \(file:///app/dist/payments/queue-client\.js:\d+:\d+\)$', lines[j + 2]) is not None
        and re.match(r'^    at async createOrder \(file:///app/dist/orders/handler\.js:\d+:\d+\)$', lines[j + 3]) is not None
    )
if release:
    order_id = release[2].rsplit(' ', 1)[1]
    out['order_id'] = order_id
    late = next(((t, text) for _, t, text in legacy
                 if re.fullmatch(rf'payment authorised auth_ref=[0-9A-F]{{5}} order {re.escape(order_id)}', text)), None)
    c['late reply line'] = late is not None
    if late:
        auth_ref = re.search(r'auth_ref=([0-9A-F]{5})', late[1]).group(1)
        c['discard line'] = any(text == f'no pending order for auth_ref={auth_ref}, discarding' for _, _, text in legacy)
        if publish:
            out['publish_to_late_reply_ms'] = late[0] - publish[1]
c['502 access line'] = any(re.match(
    r'^::ffff:[\d.]+ - - \[\d\d/\w{3}/\d{4}:\d\d:\d\d:\d\d \+0000\] "POST /orders HTTP/1\.1" 502 \d+ "-" "Mozilla/5\.0"$', l)
    for l in lines)
c['health probe line'] = any(re.fullmatch(r'\d\d:\d\d:\d\d GET /healthz 200 \d+ms', l) for l in lines)
c['no level or identifier on legacy lines'] = all(
    not re.search(r'\b(INFO|WARN|ERROR|info|warn|error)\b|[0-9a-f]{8}-[0-9a-f]{4}-', text) for _, _, text in legacy)
c['no 429 or rate limit'] = not any(re.search(r'\b429\b|rate limit|Too Many Requests', l, re.I) for l in lines)
print(json.dumps(out))
