# Harbor Desk architecture

The browser sends same-origin requests to the local Node process. SQLite holds reservation and mailbox data. The demo runs on one computer and has no external mail or identity service.

## System context

```mermaid
flowchart LR
    Member["Person: office member"]
    Operator["Person: workplace operator"]
    Harbor["System: Harbor Desk"]
    Member -->|"Find a desk, book, cancel own reservation"| Harbor
    Operator -->|"See all reservations, cancel any reservation"| Harbor
    Harbor -->|"Show confirmations and cancellations"| Member
```

## Containers and components

```mermaid
flowchart LR
    UI["Browser UI · web/client.js"]
    subgraph Process["Harbor Desk · local Node process"]
        API["HTTP API · app.mjs"]
        Identity["Demo identity · identity/access.mjs"]
        Catalog["Catalog · catalog/resources.mjs"]
        Quote["Quote policy · reservations/quote.mjs"]
        Service["Reservation service · reservations/service.mjs"]
        Worker["Notification worker · notifications/worker.mjs"]
        Store["SQLite adapter · persistence/database.mjs"]
    end
    DB[("SQLite file")]
    UI -->|"Same-origin JSON"| API
    API -->|"Public catalog"| Catalog
    API -->|"Resolve demo header"| Identity
    API -->|"Quote and manage reservations"| Service
    API -->|"Read this identity's mailbox"| Store
    Service -->|"Validate time and price"| Quote
    Service -->|"Decide ownership"| Identity
    Quote -->|"Look up capacity and rate"| Catalog
    Service -->|"Check and write transactionally"| Store
    Worker -->|"Read due outbox and deliver locally"| Store
    Store -->|"Read and write SQL"| DB
```

The process entry point in [server.mjs](../server.mjs) wires the API, SQLite adapter, and notification worker. The server listens on loopback and starts the worker's poll timer after listening. The browser reads its mailbox on demand. A confirmation does not imply that its notification has been delivered.

## Data relations

```mermaid
erDiagram
    RESERVATIONS ||--o{ OUTBOX : emits
    OUTBOX ||--o| MAILBOX : yields
    RESERVATIONS {
        text id PK
        text owner_id
        text resource_id
        text start_utc
        text end_utc
        integer total_cents
        text status
    }
    OUTBOX {
        integer id PK
        text reservation_id FK
        text kind
        text status
        integer attempts
        integer due_at
    }
    MAILBOX {
        integer outbox_id PK,FK
        text recipient_id
        text subject
        integer recorded_at
    }
```

The [SQLite schema](../persistence/schema.mjs) limits a reservation to one event of each kind. A mailbox row belongs to exactly one outbox row. Owner and resource identifiers refer to the demo fixtures in [identity/access.mjs](../identity/access.mjs) and [catalog/resources.mjs](../catalog/resources.mjs).
