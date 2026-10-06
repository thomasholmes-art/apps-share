-- inventory's stock table (obs-sample-estate). PAUSE is an H2 alias that
-- waits once per armed query, so each reservation's single SELECT on
-- stock_line produces a JDBC client span of about 31 ms under the Java agent.
CREATE TABLE stock_line (
  sku     VARCHAR(40) PRIMARY KEY,
  on_hand INT NOT NULL
);
CREATE ALIAS PAUSE FOR 'com.decoded.inventory.SqlPause.pause';
