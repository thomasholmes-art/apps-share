/*
 * seatmap: the venue layout, loaded once at start-up.
 * Part of box-office-estate, the application behind module 07,
 * lab 07-hackathon-two-worlds.
 *
 * Venues, seat rows, seats and events do not change while the service runs,
 * so they are read into memory when the service starts. Requests read the
 * layout from here; only availability and holds go to the database.
 */
package com.decoded.seatmap;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

@Component
public class Layout {

    public record Venue(int id, String name, int capacity, String kind) {}

    public record Row(int rowId, int venueId, int index, String label) {}

    public record Event(int id, int venueId, String name, OffsetDateTime startsAt, int priceMinor) {}

    private final JdbcTemplate jdbc;
    private final Map<Integer, Venue> venues = new HashMap<>();
    private final Map<Integer, List<Row>> rowsByVenue = new HashMap<>();
    private final Map<Integer, Event> events = new LinkedHashMap<>();
    private final Map<Integer, Integer> rowOfSeat = new HashMap<>();
    private final Map<Integer, Integer> venueOfRow = new HashMap<>();

    public Layout(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void load() throws InterruptedException {
        // The database container can report healthy a moment before it
        // accepts connections from other containers, so the first read is
        // retried for up to 30 seconds before start-up gives up.
        for (int attempt = 1; ; attempt++) {
            try {
                read();
                return;
            } catch (RuntimeException e) {
                if (attempt >= 30) throw e;
                Thread.sleep(1000);
            }
        }
    }

    private void read() {
        jdbc.query("SELECT venue_id, name, capacity, kind FROM venue", rs -> {
            Venue v = new Venue(rs.getInt(1), rs.getString(2), rs.getInt(3), rs.getString(4));
            venues.put(v.id(), v);
        });
        jdbc.query("SELECT row_id, venue_id, row_index, label FROM seat_row ORDER BY venue_id, row_index", rs -> {
            Row r = new Row(rs.getInt(1), rs.getInt(2), rs.getInt(3), rs.getString(4));
            rowsByVenue.computeIfAbsent(r.venueId(), k -> new ArrayList<>()).add(r);
            venueOfRow.put(r.rowId(), r.venueId());
        });
        jdbc.query("SELECT seat_id, row_id FROM seat", rs -> {
            rowOfSeat.put(rs.getInt(1), rs.getInt(2));
        });
        jdbc.query("SELECT event_id, venue_id, name, starts_at, price_minor FROM event ORDER BY starts_at", rs -> {
            Event e = new Event(rs.getInt(1), rs.getInt(2), rs.getString(3),
                    rs.getObject(4, OffsetDateTime.class), rs.getInt(5));
            events.put(e.id(), e);
        });
    }

    public Collection<Event> events() {
        return events.values();
    }

    public Optional<Event> event(int id) {
        return Optional.ofNullable(events.get(id));
    }

    public Venue venue(int id) {
        return venues.get(id);
    }

    public List<Row> rowsOf(int venueId) {
        return rowsByVenue.getOrDefault(venueId, List.of());
    }

    /** The row a seat is in, or null when the seat is not in the given venue. */
    public Integer rowOf(int seatId, int venueId) {
        Integer row = rowOfSeat.get(seatId);
        if (row == null || venueOfRow.get(row) != venueId) return null;
        return row;
    }
}
