// inventory: reads on-hand stock from table stock_line (obs-sample-estate,
// all stages). One SELECT per reservation request, covering every SKU in the
// basket, so the Java agent records one `SELECT stock_line` client span per
// reservation (about 31 ms, see SqlPause).
package com.decoded.inventory;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class StockRepository {
    private final JdbcTemplate jdbc;
    private final int selectMs;

    public StockRepository(JdbcTemplate jdbc, @Value("${inventory.latency.select-ms}") int selectMs) {
        this.jdbc = jdbc;
        this.selectMs = selectMs;
    }

    public Map<String, Integer> onHand(List<String> skus) {
        if (skus.isEmpty()) {
            return Map.of();
        }
        String marks = String.join(", ", Collections.nCopies(skus.size(), "?"));
        Map<String, Integer> found = new HashMap<>();
        SqlPause.arm(selectMs);
        try {
            jdbc.query("SELECT sku, on_hand FROM stock_line WHERE PAUSE(1) = 0 AND sku IN (" + marks + ")",
                    rs -> {
                        found.put(rs.getString("sku"), rs.getInt("on_hand"));
                    }, skus.toArray());
        } finally {
            SqlPause.disarm();
        }
        return found;
    }

    public void restore(int level) {
        jdbc.update("UPDATE stock_line SET on_hand = ?", level);
    }
}
