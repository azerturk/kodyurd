export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    start_utc TEXT NOT NULL,
    end_utc TEXT NOT NULL,
    attendees INTEGER NOT NULL CHECK (attendees > 0),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
    created_at INTEGER NOT NULL,
    cancelled_at INTEGER,
    CHECK (start_utc < end_utc),
    CHECK ((status = 'confirmed' AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS reservation_windows
    ON reservations(resource_id, start_utc, end_utc) WHERE status = 'confirmed';
  CREATE INDEX IF NOT EXISTS reservation_owners ON reservations(owner_id, start_utc);

  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id TEXT NOT NULL REFERENCES reservations(id),
    kind TEXT NOT NULL CHECK (kind IN ('confirmed', 'cancelled')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'delivered', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    due_at INTEGER NOT NULL,
    last_error TEXT,
    UNIQUE (reservation_id, kind)
  );
  CREATE INDEX IF NOT EXISTS due_outbox ON outbox(status, due_at, id);

  CREATE TABLE IF NOT EXISTS mailbox (
    outbox_id INTEGER PRIMARY KEY REFERENCES outbox(id),
    recipient_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    recorded_at INTEGER NOT NULL
  );
`;
