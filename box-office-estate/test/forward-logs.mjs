// Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).
//
// Podman has no fluentd log driver, so this stands in for Docker's: it follows
// `podman logs` for each service container and sends every line to the
// collector's Fluent Forward receiver on 127.0.0.1:24224, with the tag and the
// record keys Docker's driver uses (container_id, container_name, source, log).
// Usage: node forward-logs.mjs <container> [<container> ...]
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// MessagePack, only the types a Fluent Forward message needs.
function pack(v) {
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    if (b.length < 32) return Buffer.concat([Buffer.from([0xa0 | b.length]), b]);
    if (b.length < 256) return Buffer.concat([Buffer.from([0xd9, b.length]), b]);
    if (b.length < 65536) { const h = Buffer.alloc(3); h[0] = 0xda; h.writeUInt16BE(b.length, 1); return Buffer.concat([h, b]); }
    const h = Buffer.alloc(5); h[0] = 0xdb; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]);
  }
  if (Number.isInteger(v) && v >= 0) { const h = Buffer.alloc(5); h[0] = 0xce; h.writeUInt32BE(v, 1); return h; }
  if (Array.isArray(v)) return Buffer.concat([Buffer.from([0x90 | v.length]), ...v.map(pack)]);
  if (v instanceof Buffer) return v;
  const entries = Object.entries(v);
  return Buffer.concat([Buffer.from([0x80 | entries.length]), ...entries.flatMap(([k, x]) => [pack(k), pack(x)])]);
}

// EventTime extension (type 0): seconds and nanoseconds, so record times keep milliseconds.
function eventTime(ms) {
  const b = Buffer.alloc(10);
  b[0] = 0xd7; b[1] = 0x00;
  b.writeUInt32BE(Math.floor(ms / 1000), 2);
  b.writeUInt32BE((ms % 1000) * 1e6, 6);
  return b;
}

const socket = net.createConnection({ host: '127.0.0.1', port: 24224 });
socket.on('error', (e) => { console.error(`forward-logs: ${e.message}`); process.exit(1); });

for (const name of process.argv.slice(2)) {
  const id = spawnSync('podman', ['inspect', '-f', '{{.Id}}', name], { encoding: 'utf8' }).stdout.trim();
  const child = spawn('podman', ['logs', '-f', '-t', name], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const [stream, source] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    createInterface({ input: stream }).on('line', (line) => {
      // podman's -t prefix is the time the line was written.
      const m = line.match(/^(\S+)\s(.*)$/);
      const at = m ? Date.parse(m[1]) : Date.now();
      const text = m ? m[2] : line;
      socket.write(pack([name, eventTime(Number.isFinite(at) ? at : Date.now()),
        { container_id: id, container_name: `/${name}`, source, log: text }]));
    });
  }
}
