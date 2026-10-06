// inventory: stock held by reservations (obs-sample-estate, all stages).
//
// A reservation holds its quantity for HOLD_TTL (30 s) while checkout-api
// confirms the order. Free stock is on-hand minus held. A background
// executor releases expired holds every five seconds; it is started with the
// component, not by a request, so it creates no span. The reconciliation job
// clears all holds when it restores stock. Callers hold the shared stock lock.
package com.decoded.inventory;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class Holds {
    private record Hold(int qty, long expiresAt) {
    }

    private final Map<String, Deque<Hold>> bySku = new HashMap<>();
    private final long ttlMs;

    public Holds(ReentrantLock stockLock, @Value("${inventory.hold-ttl-ms}") long ttlMs) {
        this.ttlMs = ttlMs;
        ScheduledExecutorService releaser = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "hold-release");
            t.setDaemon(true);
            return t;
        });
        releaser.scheduleAtFixedRate(() -> {
            stockLock.lock();
            try {
                releaseExpired();
            } finally {
                stockLock.unlock();
            }
        }, 5, 5, TimeUnit.SECONDS);
    }

    int held(String sku) {
        return bySku.getOrDefault(sku, new ArrayDeque<>()).stream().mapToInt(Hold::qty).sum();
    }

    void add(String sku, int qty) {
        bySku.computeIfAbsent(sku, k -> new ArrayDeque<>()).add(new Hold(qty, System.currentTimeMillis() + ttlMs));
    }

    void clear() {
        bySku.clear();
    }

    private void releaseExpired() {
        long now = System.currentTimeMillis();
        for (Deque<Hold> q : bySku.values()) {
            while (!q.isEmpty() && q.peekFirst().expiresAt() <= now) {
                q.pollFirst();
            }
        }
    }
}
