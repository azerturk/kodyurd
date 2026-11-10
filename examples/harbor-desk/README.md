# Harbor Desk

Harbor Desk is a standalone demo of an office reservation system. Members book a private desk or meeting room, and operators can release reservations across the office. A background worker delivers reservation updates to a local mailbox.

## Run

Requires Node.js 22.5 or newer and uses built-in Node modules. From this folder, run:

```sh
npm start
npm test
```

Open [Harbor Desk](http://127.0.0.1:4724) for the UI. The service binds to loopback, has no third-party dependencies, and stores data in `.data/harbor.sqlite`. Set `PORT` to choose a different port or `HARBOR_DB` to use a separate database file. The demo identity selector switches between Alice, Bob, and Morgan. It demonstrates authorization rules in a trusted local environment.

## Follow a reservation

1. As Alice, choose Chart Room with four attendees and a window from 09:00 to 11:00 UTC. Get a quote, then confirm. Four half-hour slots at $12.50 cost $50.00 before a $5.00 room discount.
2. As Bob, try the same room and window. The server returns `TIME_CONFLICT`. Try 11:00 to 11:30 to see an adjacent booking succeed.
3. As Morgan, cancel Alice's reservation. As Bob, book the newly released window.
4. Refresh activity to see a confirmation or cancellation in the recipient's local mailbox. Run with `HARBOR_DEMO_NOTIFY_FAIL_ONCE=1` to force each message's first attempt to fail before retrying.

## Explore the implementation

| Area | Implementation | Documentation |
| --- | --- | --- |
| HTTP entry point and browser UI | [app.mjs](app.mjs), [web/client.js](web/client.js) | [HTTP contract](docs/api.md) |
| Demo identity and access | [identity/access.mjs](identity/access.mjs) | [Access rules](docs/api.md#access-rules) |
| Resource catalog and quotes | [catalog/resources.mjs](catalog/resources.mjs), [reservations/quote.mjs](reservations/quote.mjs) | [Reservation lifecycle](docs/reservations.md) |
| Reservation writes | [reservations/service.mjs](reservations/service.mjs), [persistence/database.mjs](persistence/database.mjs) | [Reservation lifecycle](docs/reservations.md) |
| Local mailbox | [notifications/worker.mjs](notifications/worker.mjs), [persistence/schema.mjs](persistence/schema.mjs) | [Notification lifecycle](docs/notifications.md) |
| System boundaries | [server.mjs](server.mjs) | [Architecture](docs/architecture.md), [Transactional outbox decision](docs/adr-001-transactional-outbox.md) |

See [Troubleshooting](docs/troubleshooting.md) for common reservation and delivery outcomes. The [HTTP tests](test/http.test.mjs) exercise successful booking, access denial, conflict, and rebooking.
