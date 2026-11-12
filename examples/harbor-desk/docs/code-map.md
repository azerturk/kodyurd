# Code map

Harbor Desk has no framework. Three factory functions return the objects that do the work, and one error class carries every rejected request. [Architecture](architecture.md) shows the same parts as containers.

## System context

```mermaid
C4Context
    title Harbor Desk system context
    Person(member, "Member", "Books a desk or a room")
    Person(operator, "Operator", "Releases reservations across the office")
    System(harbor, "Harbor Desk", "Local reservation service")
    SystemDb(file, "SQLite file", "Reservations, outbox and mailbox")
    Rel(member, harbor, "Quotes, books and cancels")
    Rel(operator, harbor, "Lists and cancels any booking")
    Rel(harbor, file, "Reads and writes")
```

## Service objects

[createReservationService](../reservations/service.mjs), [openStore](../persistence/database.mjs) and [createNotificationWorker](../notifications/worker.mjs) return these objects. [Problem](../reservations/problem.mjs) is the only class.

```mermaid
classDiagram
    class ReservationService {
        +quote(input)
        +list(actor)
        +create(actor, input)
        +cancel(actor, reservationId)
    }
    class Store {
        +write(operation)
        +getReservation(id)
        +listReservations(ownerId)
        +hasOverlap(resourceId, start, end)
        +insertReservation(input)
        +cancelReservation(id, timestamp)
        +enqueue(event)
        +nextNotification(timestamp)
        +recordDelivery(notification, subject, timestamp)
        +finishNotification(id, attempts)
        +failNotification(id, status, attempts, dueAt, reason)
        +listMailbox(recipientId)
        +close()
    }
    class NotificationWorker {
        +tick()
        +start(options)
    }
    class Problem {
        +status
        +code
    }
    Error <|-- Problem
    ReservationService ..> Store : reads and writes
    ReservationService ..> Problem : throws
    NotificationWorker ..> Store : polls the outbox
```

## Topics

```mermaid
mindmap
  root((Harbor Desk))
    HTTP entry point
      Browser UI
      JSON API
    Reservations
      Quote
      Overlap check
      Cancellation
    Notifications
      Outbox
      Retry
      Local mailbox
    Persistence
      SQLite store
    Identity
      Members
      Operator
```
