/*
 * seatmap: reads which seats in a row are free for an event.
 * Part of box-office-estate, the application behind module 07,
 * lab 07-hackathon-two-worlds.
 */
package com.decoded.seatmap;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AvailabilityRepository {

    public record Seat(int id, int n) {}

    private static final String FREE_SEATS_IN_ROW = """
            SELECT s.seat_id, s.seat_no FROM seat s
             WHERE s.row_id = ?
               AND NOT EXISTS (SELECT 1 FROM seat_hold h
                                WHERE h.seat_id = s.seat_id AND h.event_id = ? AND h.released_at IS NULL)
             ORDER BY s.seat_no""";

    private final JdbcTemplate jdbc;

    public AvailabilityRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Seat> freeSeatsInRow(int rowId, int eventId) {
        return jdbc.query(FREE_SEATS_IN_ROW, (rs, i) -> new Seat(rs.getInt(1), rs.getInt(2)), rowId, eventId);
    }
}
