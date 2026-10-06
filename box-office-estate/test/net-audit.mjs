// Build-test helper for box-office-estate (module 07, lab 07-hackathon-two-worlds).
// Loaded with NODE_OPTIONS="--import <this file>", it appends the destination
// of every outbound TCP connection the process opens to NET_AUDIT_FILE, one
// host:port per line. Test T9 uses it to show that ./verify.sh connects to
// SigNoz and to nothing else.
import net from 'node:net';
import { appendFileSync } from 'node:fs';

const file = process.env.NET_AUDIT_FILE;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function audited(...args) {
  // net.connect() passes its normalised arguments as one array.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const opts = typeof first === 'object' && first !== null ? first : { port: first, host: args[1] };
  if (file) appendFileSync(file, `${opts.host ?? 'localhost'}:${opts.port ?? opts.path}\n`);
  return connect.apply(this, args);
};
