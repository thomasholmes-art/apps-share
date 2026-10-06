/*
 * seatmap: the HTTP interface. Events, seat availability, holds and releases.
 * Part of box-office-estate, the application behind module 07,
 * lab 07-hackathon-two-worlds.
 *
 * orders-api is the only caller. It sends x-correlation-id on every request;
 * this service does not read it.
 */
package com.decoded.seatmap;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import io.opentelemetry.api.trace.Span;

@RestController
public class SeatController {

    private static final Logger log = LoggerFactory.getLogger(SeatController.class);

    public record EventView(int id, String name, String venue, String venueKind, int capacity,
                            String startsAt, int priceMinor) {}

    public record RowView(String row, List<AvailabilityRepository.Seat> seats) {}

    public record SeatsView(int eventId, String venue, int free, List<RowView> rows) {}

    public record HoldRequest(Integer eventId, List<Integer> seatIds, String orderRef) {}

    public record ReleaseRequest(List<String> holdIds) {}

    private final Layout layout;
    private final AvailabilityRepository availability;
    private final HoldRepository holds;

    public SeatController(Layout layout, AvailabilityRepository availability, HoldRepository holds) {
        this.layout = layout;
        this.availability = availability;
        this.holds = holds;
    }

    private EventView view(Layout.Event e) {
        Layout.Venue v = layout.venue(e.venueId());
        return new EventView(e.id(), e.name(), v.name(), v.kind(), v.capacity(),
                e.startsAt().toString(), e.priceMinor());
    }

    @GetMapping("/events")
    public List<EventView> events() {
        return layout.events().stream().map(this::view).toList();
    }

    @GetMapping("/events/{id}")
    public ResponseEntity<EventView> event(@PathVariable int id) {
        return layout.event(id).map(e -> ResponseEntity.ok(view(e)))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/events/{id}/seats")
    public ResponseEntity<SeatsView> seats(@PathVariable int id) {
        Layout.Event event = layout.event(id).orElse(null);
        if (event == null) return ResponseEntity.notFound().build();

        log.info("availability requested event={}", id);
        List<Layout.Row> rows = layout.rowsOf(event.venueId());
        Span.current().setAttribute("venue.seat_rows", rows.size());

        List<RowView> out = new ArrayList<>(rows.size());
        int free = 0;
        for (Layout.Row row : rows) {
            List<AvailabilityRepository.Seat> seats = availability.freeSeatsInRow(row.rowId(), id);
            free += seats.size();
            out.add(new RowView(row.label(), seats));
        }
        log.info("availability returned event={} free={}", id, free);
        return ResponseEntity.ok(new SeatsView(id, layout.venue(event.venueId()).name(), free, out));
    }

    @PostMapping("/holds")
    public ResponseEntity<Map<String, Object>> hold(@RequestBody HoldRequest req) {
        if (req == null || req.eventId() == null || req.seatIds() == null || req.seatIds().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "malformed_hold"));
        }
        Layout.Event event = layout.event(req.eventId()).orElse(null);
        if (event == null) return ResponseEntity.notFound().build();

        Set<Integer> rows = new HashSet<>();
        for (Integer seat : req.seatIds()) {
            Integer row = seat == null ? null : layout.rowOf(seat, event.venueId());
            if (row == null) return ResponseEntity.badRequest().body(Map.of("error", "unknown_seat", "seatId", String.valueOf(seat)));
            rows.add(row);
        }
        log.info("hold requested rows={} event={}", rows.size(), req.eventId());

        HoldRepository.Placed placed = holds.place(req.eventId(), req.seatIds(), req.orderRef());
        if (placed.heldSeats().size() < req.seatIds().size()) {
            List<Integer> refused = new ArrayList<>(req.seatIds());
            refused.removeAll(placed.heldSeats());
            log.info("hold refused seats={} event={}", refused, req.eventId());
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("refused", refused));
        }
        log.info("hold granted ids={}", placed.holdIds());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("holdIds", placed.holdIds());
        body.put("priceMinor", event.priceMinor());
        return ResponseEntity.status(HttpStatus.CREATED).body(body);
    }

    @PostMapping("/holds/release")
    public ResponseEntity<Map<String, Object>> release(@RequestBody ReleaseRequest req) {
        if (req == null || req.holdIds() == null || req.holdIds().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "malformed_release"));
        }
        int released = holds.release(req.holdIds());
        log.info("holds released ids={}", req.holdIds());
        return ResponseEntity.ok(Map.of("released", released));
    }
}
