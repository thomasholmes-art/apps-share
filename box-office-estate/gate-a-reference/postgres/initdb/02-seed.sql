-- box-office-estate seed data. Part of the application behind module 07,
-- lab 07-hackathon-two-worlds.
--
-- Two venues: Harbour Arena (18,000 seats in 452 rows: 372 rows of 40 and
-- 80 rows of 39) and Corn Exchange Theatre (200 seats in 10 rows of 20).
-- Seats already sold are seat_hold rows with order_ref set and released_at
-- null. The counts below leave event 842 with 4,118 free seats, event 115
-- with 37 and event 506 with 52. scripts/reset-data.sh restores this state.

INSERT INTO venue VALUES
  (1, 'Harbour Arena',         18000, 'arena'),
  (2, 'Corn Exchange Theatre',   200, 'theatre');

INSERT INTO seat_row (row_id, venue_id, row_index, label)
SELECT i + 1, 1, i, 'R' || lpad((i + 1)::text, 3, '0') FROM generate_series(0, 451) AS i;
INSERT INTO seat_row (row_id, venue_id, row_index, label)
SELECT 501 + i, 2, i, chr(65 + i) FROM generate_series(0, 9) AS i;

INSERT INTO seat (seat_id, row_id, seat_no)
SELECT 102199 + row_number() OVER (ORDER BY r.row_index, n), r.row_id, n
  FROM seat_row r
 CROSS JOIN LATERAL generate_series(1, CASE WHEN r.row_index < 372 THEN 40 ELSE 39 END) AS n
 WHERE r.venue_id = 1;
INSERT INTO seat (seat_id, row_id, seat_no)
SELECT 1000 + row_number() OVER (ORDER BY r.row_index, n), r.row_id, n
  FROM seat_row r
 CROSS JOIN generate_series(1, 20) AS n
 WHERE r.venue_id = 2;

INSERT INTO event (event_id, venue_id, name, starts_at, price_minor) VALUES
  (842, 1, 'Northern Lights Live (Saturday)', '2026-10-10 19:30:00+01', 6450),
  (845, 1, 'Northern Lights Live (Sunday)',   '2026-10-11 19:00:00+01', 6450),
  (115, 2, 'The Glass Menagerie',             '2026-10-08 19:30:00+01', 3200),
  (118, 2, 'The Glass Menagerie (matinee)',   '2026-10-10 14:30:00+01', 2800),
  (506, 2, 'Lunchtime Quartet',               '2026-10-07 12:30:00+01', 1500),
  (509, 2, 'Lunchtime Quartet',               '2026-10-14 12:30:00+01', 1500),
  (521, 2, 'An Evening of Short Plays',       '2026-10-16 19:45:00+01', 2400);

-- Seats sold before the application changed hands. A fixed md5 ordering
-- picks the same seats on every reset.
INSERT INTO seat_hold (hold_id, event_id, seat_id, order_ref, created_at)
SELECT 'H-' || (10000 + row_number() OVER (ORDER BY p.event_id, x.seat_id)),
       p.event_id, x.seat_id, 'imported', '2026-09-20 09:00:00+00'
  FROM (VALUES (842, 1, 13882), (845, 1, 9240), (115, 2, 163), (118, 2, 121),
               (506, 2, 148), (509, 2, 96), (521, 2, 57)) AS p(event_id, venue_id, sold)
 CROSS JOIN LATERAL (
       SELECT s.seat_id FROM seat s JOIN seat_row r USING (row_id)
        WHERE r.venue_id = p.venue_id
        ORDER BY md5(s.seat_id::text || ':' || p.event_id::text)
        LIMIT p.sold) AS x;

ANALYZE;
