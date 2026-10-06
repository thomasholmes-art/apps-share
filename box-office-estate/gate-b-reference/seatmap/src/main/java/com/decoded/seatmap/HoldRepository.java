/*
 * seatmap: places and releases seat holds.
 * Part of box-office-estate, the application behind module 07,
 * lab 07-hackathon-two-worlds.
 *
 * A hold is one row in seat_hold per seat. The partial unique index
 * seat_hold_live allows one live hold per seat and event, so a seat that is
 * already held is skipped by ON CONFLICT and does not come back from
 * RETURNING. A request is all or nothing: if any seat was skipped, the
 * transaction rolls back and nothing is held.
 */
package com.decoded.seatmap;

import java.sql.Array;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class HoldRepository {

    public record Placed(List<String> holdIds, List<Integer> heldSeats) {}

    private static final String PLACE = """
            INSERT INTO seat_hold (hold_id, event_id, seat_id, order_ref)
            SELECT 'H-' || nextval('hold_seq'), ?, s.seat_id, ?
              FROM unnest(?::int[]) WITH ORDINALITY AS s(seat_id, ord)
             ORDER BY s.ord
            ON CONFLICT (event_id, seat_id) WHERE released_at IS NULL DO NOTHING
            RETURNING hold_id, seat_id""";

    private static final String RELEASE =
            "UPDATE seat_hold SET released_at = now() WHERE hold_id = ANY(?) AND released_at IS NULL";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public HoldRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    /** Holds every seat or none. Returns the seats that were free and the hold IDs created for them. */
    public Placed place(int eventId, List<Integer> seatIds, String orderRef) {
        return tx.execute(status -> {
            List<String> holdIds = new ArrayList<>();
            List<Integer> held = new ArrayList<>();
            jdbc.query(con -> {
                PreparedStatement ps = con.prepareStatement(PLACE);
                Array seats = con.createArrayOf("integer", seatIds.toArray());
                ps.setInt(1, eventId);
                ps.setString(2, orderRef);
                ps.setArray(3, seats);
                return ps;
            }, rs -> {
                holdIds.add(rs.getString(1));
                held.add(rs.getInt(2));
            });
            if (held.size() < seatIds.size()) status.setRollbackOnly();
            return new Placed(holdIds, held);
        });
    }

    public int release(List<String> holdIds) {
        return jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(RELEASE);
            ps.setArray(1, con.createArrayOf("text", holdIds.toArray()));
            return ps;
        });
    }
}
