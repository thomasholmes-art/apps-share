#!/usr/bin/env python3
"""Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).

Rewrites a checkout's docker-compose.yml and otel-collector/collector.yaml in
place so the estate runs under rootless podman on a host with no Docker and no
SigNoz. Only the build test uses this; the files in the snapshots are not
changed. The rewrites:

  - logging: removed. Podman has no fluentd log driver; test/forward-logs.mjs
    reads `podman logs` and delivers each line to the collector's Fluent
    Forward receiver in the record shape Docker's driver uses.
  - the agent jar bind mount reads from AGENT_JAR instead of /opt/otel.
  - extra_hosts: removed (there is no SigNoz on host.docker.internal).
  - the collector's exporters are replaced by file exporters writing OTLP JSON
    to OUT_DIR, which test/signoz-stub.mjs serves as a SigNoz query API.
  - payments-sim gets BUILD_TEST_IDLE_TIMEOUT_S when that variable is set.
  - seatmap gets a 256 MB heap cap through JAVA_TOOL_OPTIONS, because the
    authoring host the test was written on has little free memory.

Usage: podman-variant.py <checkout-dir> <agent-jar> <out-dir>
"""
import os
import sys

import yaml

root, agent_jar, out_dir = sys.argv[1:4]
compose_path = os.path.join(root, 'docker-compose.yml')
collector_path = os.path.join(root, 'otel-collector', 'collector.yaml')

compose = yaml.safe_load(open(compose_path))
compose.pop('x-shipped-logs', None)
for name, svc in compose['services'].items():
    svc.pop('logging', None)
    svc.pop('extra_hosts', None)
    vols = svc.get('volumes') or []
    svc_vols = []
    for v in vols:
        if isinstance(v, str) and v.startswith('/opt/otel/'):
            target = v.split(':')[1]
            v = f'{agent_jar}:{target}:ro'
        svc_vols.append(v)
    if vols:
        svc['volumes'] = svc_vols

compose['services']['otel-collector']['volumes'].append(f'{out_dir}:/out')
compose['services']['otel-collector']['user'] = '0:0'
idle = os.environ.get('BUILD_TEST_IDLE_TIMEOUT_S')
if idle:
    compose['services']['payments-sim'].setdefault('environment', {})['BUILD_TEST_IDLE_TIMEOUT_S'] = idle
compose['services']['seatmap']['environment']['JAVA_TOOL_OPTIONS'] = '-Xmx256m -XX:+UseSerialGC -XX:TieredStopAtLevel=1'
yaml.safe_dump(compose, open(compose_path, 'w'), sort_keys=False)

collector = yaml.safe_load(open(collector_path))
collector['exporters'] = {
    'file/traces': {'path': '/out/traces.jsonl', 'flush_interval': '1s'},
    'file/logs': {'path': '/out/logs.jsonl', 'flush_interval': '1s'},
    'file/metrics': {'path': '/out/metrics.jsonl', 'flush_interval': '1s'},
}
for signal, pipe in collector['service']['pipelines'].items():
    pipe['exporters'] = [f'file/{signal}']
yaml.safe_dump(collector, open(collector_path, 'w'), sort_keys=False)
