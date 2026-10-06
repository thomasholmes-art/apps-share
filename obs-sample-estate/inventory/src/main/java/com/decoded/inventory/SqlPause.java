// inventory: the H2 function PAUSE (obs-sample-estate, all stages; the
// `SELECT stock_line` span in lab 05's trace).
//
// The in-memory table answers in microseconds, which would make the JDBC
// client span the Java agent records too short to read. The repository arms
// this function before its one SELECT per reservation; H2 calls it for each
// row it scans, and the first call waits the configured time and disarms it.
// The wait therefore happens inside `executeQuery`, which is the span.
package com.decoded.inventory;

public final class SqlPause {
    private static final ThreadLocal<Integer> ARMED = new ThreadLocal<>();

    private SqlPause() {
    }

    static void arm(int ms) {
        ARMED.set(ms);
    }

    static void disarm() {
        ARMED.remove();
    }

    public static int pause(int ignored) {
        Integer ms = ARMED.get();
        if (ms != null) {
            ARMED.remove();
            try {
                Thread.sleep(ms);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        return 0;
    }
}
