// checkout-api: the dispatch publisher as it runs at stages 02 and 03 of
// obs-sample-estate (modules 02 and 03).
//
// A pool of four broker connections opened once at start-up, so no checkout
// pays the connection handshake. It creates no spans: module 03 says the
// queue publish has none yet, and a 600 ms span visible in lab 03 would give
// away lab 04's finding.
//
// It has the interface of lab 04's publisher, `createPublisher({ broker,
// tracer })` returning `publish(topic, job)`, so `bin/stage 04` can swap in
// lab 04's starter file (the per-message connection, with spans) without
// touching anything else. `warm()` is the only addition; server.js calls it
// when present and logs `queue.pool_warmed`.
export function createPublisher({ broker, size = 4 }) {
  const pool = [];
  let next = 0;

  return {
    async warm() {
      const opened = await Promise.all(Array.from({ length: size }, () => broker.connect()));
      pool.push(...opened);
      return pool.length;
    },

    async publish(topic, job) {
      if (pool.length === 0) await this.warm();
      next = (next + 1) % pool.length;
      let connection = pool[next];
      if (connection.closed) {
        connection = await broker.connect();
        pool[next] = connection;
      }
      return connection.send({ topic, ...job });
    },

    async close() {
      await Promise.all(pool.splice(0).map((c) => c.close()));
    },
  };
}
