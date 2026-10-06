// inventory: reserves stock for a basket (obs-sample-estate, all stages; the
// reply behind lab 01's failing checkout and lab 06's reserve.shortfall).
//
// For each basket line: if the SKU has a stock record and enough free stock,
// hold the quantity and return a reservation carrying the line's `sku`;
// otherwise report the line under `unreserved` with the figures checkout-api
// needs to classify the shortfall (`requested`, `on_hand`, `held`). The reply
// is always 200, including on a shortfall. A SKU with no stock record
// (TS-SHIRT-XL-BLK) logs `inventory.stock_missing` at WARN.
//
// Latency: one SELECT (about 31 ms), a processing delay drawn from
// `inventory.latency.bands`, and, while reconciliation runs, the wait for
// the job's recount.
package com.decoded.inventory;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Service;

@Service
public class StockService {
    public record Line(String sku, int qty) {
    }

    public record Basket(String currency, List<Line> lines) {
    }

    public record Reservation(String sku, String id) {
    }

    public record Unreserved(String sku, int requested, @JsonProperty("on_hand") int onHand, int held) {
    }

    public record Reply(List<Reservation> reservations, List<Unreserved> unreserved) {
    }

    @Configuration
    static class LockConfig {
        @Bean
        ReentrantLock stockLock() {
            return new ReentrantLock(true);
        }
    }

    private static final Logger log = LoggerFactory.getLogger(ReserveController.class);
    private static final AtomicLong RESERVATION_IDS = new AtomicLong(8840);

    private final StockRepository repository;
    private final Holds holds;
    private final Reconciliation reconciliation;
    private final ReentrantLock stockLock;
    private final Ranges processing;
    private final long slowWarnMs;

    public StockService(StockRepository repository, Holds holds, Reconciliation reconciliation, ReentrantLock stockLock,
            @Value("${inventory.latency.bands}") String bands,
            @Value("${inventory.reconcile.slow-warn-ms}") long slowWarnMs) {
        this.repository = repository;
        this.holds = holds;
        this.reconciliation = reconciliation;
        this.stockLock = stockLock;
        this.processing = new Ranges(bands);
        this.slowWarnMs = slowWarnMs;
    }

    public Reply reserve(Basket basket) {
        long started = System.nanoTime();
        List<Line> lines = basket.lines() == null ? List.of() : basket.lines();
        log.info(Events.line("inventory.reserve_requested", "reservation requested", "lines", lines.size()));

        Map<String, Integer> onHand = repository.onHand(lines.stream().map(Line::sku).toList());
        if (reconciliation.running()) {
            reconciliation.awaitRecount(lines.stream().map(Line::sku).toList());
        }
        Ranges.sleep(processing.draw());

        List<Reservation> reserved = new ArrayList<>();
        List<Unreserved> unreserved = new ArrayList<>();
        stockLock.lock();
        try {
            for (Line line : lines) {
                Integer have = onHand.get(line.sku());
                if (have == null) {
                    log.warn(Events.line("inventory.stock_missing", "no stock record for sku", "sku", line.sku(), "on_hand", 0));
                    unreserved.add(new Unreserved(line.sku(), line.qty(), 0, 0));
                    continue;
                }
                int held = holds.held(line.sku());
                if (have - held >= line.qty()) {
                    holds.add(line.sku(), line.qty());
                    reserved.add(new Reservation(line.sku(), "rsv_" + RESERVATION_IDS.incrementAndGet()));
                } else {
                    unreserved.add(new Unreserved(line.sku(), line.qty(), have, held));
                }
            }
        } finally {
            stockLock.unlock();
        }

        long ms = (System.nanoTime() - started) / 1_000_000;
        if (ms >= slowWarnMs) {
            log.warn(Events.line("inventory.reserve_slow", "reservation handling was slow", "duration_ms", ms));
        }
        log.info(Events.line("inventory.reserve_completed", "reservation reply sent",
                "requested", lines.size(), "reserved", reserved.size(), "status", 200));
        return new Reply(reserved, unreserved);
    }
}
