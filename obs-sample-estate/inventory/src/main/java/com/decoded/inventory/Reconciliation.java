// inventory: the stock-reconciliation job (obs-sample-estate, all stages;
// the anomaly lab 04 task 4 finds and the debrief explains).
//
// Runs on a five-minute timer (`0 3/5 * * * *`, UTC: minutes 3, 8, 13, ...)
// for about 50 seconds. While it runs, a reservation may not use a stock row
// until the job has recounted it: the reservation thread hands its SKUs to
// the job's recount thread and waits. The recount thread holds the shared
// stock lock while it works, so the reservation is waiting on a lock, not
// doing extra work, and CPU stays flat. A recount takes 60-100 ms; about one
// in five takes 0.8-1.1 s. Throughput and error rate are unchanged, and a
// trace inside the window has the same spans as one outside it, only longer.
// That is the one-minute p95 rise above 900 ms in lab 04's
// `reserve-p95-last-hour.csv`. At the end the job restores seed stock levels
// and drops all holds.
package com.decoded.inventory;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class Reconciliation {
    private static final Logger log = LoggerFactory.getLogger(Reconciliation.class);

    private final ReentrantLock stockLock;
    private final StockRepository repository;
    private final Holds holds;
    private final long durationMs;
    private final Ranges recount;
    private final Ranges longRecount;
    private final int longPercent;
    private final ExecutorService recountThread = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "stock-recount");
        t.setDaemon(true);
        return t;
    });
    private final AtomicInteger recounts = new AtomicInteger();
    private volatile boolean running;

    public Reconciliation(ReentrantLock stockLock, StockRepository repository, Holds holds,
            @Value("${inventory.reconcile.duration-ms}") long durationMs,
            @Value("${inventory.reconcile.recount-ms}") String recountMs,
            @Value("${inventory.reconcile.long-recount-ms}") String longRecountMs,
            @Value("${inventory.reconcile.long-recount-percent}") int longPercent) {
        this.stockLock = stockLock;
        this.repository = repository;
        this.holds = holds;
        this.durationMs = durationMs;
        this.recount = new Ranges(recountMs);
        this.longRecount = new Ranges(longRecountMs);
        this.longPercent = longPercent;
    }

    @Scheduled(cron = "${inventory.reconcile.cron}", zone = "UTC")
    public void run() {
        running = true;
        recounts.set(0);
        log.info(Events.line("inventory.reconciliation_started", "stock reconciliation started"));
        long started = System.currentTimeMillis();
        Ranges.sleep(durationMs);
        stockLock.lock();
        try {
            repository.restore(500);
            holds.clear();
        } finally {
            stockLock.unlock();
            running = false;
        }
        log.info(Events.line("inventory.reconciliation_completed", "stock reconciliation completed",
                "rows_recounted", recounts.get(), "duration_ms", System.currentTimeMillis() - started));
    }

    boolean running() {
        return running;
    }

    // Blocks the calling reservation until its rows are recounted; returns
    // how long it waited.
    long awaitRecount(List<String> skus) {
        long started = System.nanoTime();
        try {
            recountThread.submit(() -> {
                stockLock.lock();
                try {
                    boolean slow = ThreadLocalRandom.current().nextInt(100) < longPercent;
                    Ranges.sleep(slow ? longRecount.draw() : recount.draw());
                    recounts.addAndGet(skus.size());
                } finally {
                    stockLock.unlock();
                }
            }).get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (java.util.concurrent.ExecutionException e) {
            throw new IllegalStateException(e);
        }
        return (System.nanoTime() - started) / 1_000_000;
    }
}
