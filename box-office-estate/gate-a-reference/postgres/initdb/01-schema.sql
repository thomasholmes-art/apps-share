-- box-office-estate database schema. Part of the application behind
-- module 07, lab 07-hackathon-two-worlds. Runs once, when the data volume
-- is first created.

CREATE TABLE venue    (venue_id int PRIMARY KEY, name text NOT NULL, capacity int NOT NULL, kind text NOT NULL);
CREATE TABLE seat_row (row_id int PRIMARY KEY, venue_id int NOT NULL REFERENCES venue, row_index int NOT NULL, label text NOT NULL);
CREATE TABLE seat     (seat_id int PRIMARY KEY, row_id int NOT NULL REFERENCES seat_row, seat_no int NOT NULL);
CREATE INDEX seat_row_id_idx ON seat(row_id);
CREATE TABLE event    (event_id int PRIMARY KEY, venue_id int NOT NULL REFERENCES venue, name text NOT NULL,
                       starts_at timestamptz NOT NULL, price_minor int NOT NULL);
CREATE TABLE seat_hold(hold_id text PRIMARY KEY, event_id int NOT NULL REFERENCES event, seat_id int NOT NULL REFERENCES seat,
                       order_ref text, created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz);
-- One live hold per seat and event. Released holds stay as history.
CREATE UNIQUE INDEX seat_hold_live ON seat_hold(event_id, seat_id) WHERE released_at IS NULL;
CREATE SEQUENCE hold_seq START 91000;
