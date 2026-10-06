// inventory: parses the latency settings in application.properties
// (obs-sample-estate, all stages). "60-100" is a uniform range in
// milliseconds; "85:5-12,10:20-40,5:40-70" is a list of weighted ranges.
package com.decoded.inventory;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

final class Ranges {
    private record Band(int weight, int lo, int hi) {
    }

    private final List<Band> bands = new ArrayList<>();
    private int total;

    Ranges(String spec) {
        for (String part : spec.split(",")) {
            String[] wr = part.trim().split(":");
            int weight = wr.length == 2 ? Integer.parseInt(wr[0]) : 1;
            String[] lohi = wr[wr.length - 1].split("-");
            bands.add(new Band(weight, Integer.parseInt(lohi[0]), Integer.parseInt(lohi[1])));
            total += weight;
        }
    }

    int draw() {
        int pick = ThreadLocalRandom.current().nextInt(total);
        for (Band b : bands) {
            if (pick < b.weight) {
                return ThreadLocalRandom.current().nextInt(b.lo, b.hi + 1);
            }
            pick -= b.weight;
        }
        return 0;
    }

    static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
