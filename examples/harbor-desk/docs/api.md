# HTTP contract

The UI and API share one local origin. API responses use JSON. Errors have the shape `{ "error": "CODE", "message": "Human-readable detail" }`.

| Method | Path | Identity | Success |
| --- | --- | --- | --- |
| GET | `/api/resources` | Public | 200 `{ resources }` |
| POST | `/api/quote` | Public | 200 `{ quote }` |
| GET | `/api/reservations` | Known demo identity | 200 `{ reservations }` |
| POST | `/api/reservations` | Known demo identity | 201 `{ reservation }` |
| DELETE | `/api/reservations/{id}` | Owner or operator | 200 `{ reservation }` |
| GET | `/api/mailbox` | Known demo identity | 200 `{ messages }` for this recipient |

## Access rules

`x-harbor-user` selects a trusted local demo identity. The values `alice` and `bob` are members. The value `morgan` is an operator. This header is for the demonstration and must not be used for real authentication.

| Caller and request | Outcome |
| --- | --- |
| Missing or unknown identity on a protected route | 401 `IDENTITY_REQUIRED` |
| Member lists reservations | Returns reservations that member owns |
| Operator lists reservations | Returns reservations for every owner |
| Owner or operator cancels an existing reservation | 200, updated or already cancelled |
| Other known member attempts to cancel an existing reservation | 403 `CANCELLATION_DENIED` |
| Known actor attempts to cancel an absent reservation | 404 `RESERVATION_UNKNOWN` |

Quotes and booking requests use the same fields:

```json
{
  "resourceId": "chart-room",
  "start": "2031-06-12T09:00:00Z",
  "end": "2031-06-12T11:00:00Z",
  "attendees": 4
}
```

| Request issue | Status and code |
| --- | --- |
| Body is not a JSON object | 400 `BAD_JSON` |
| Content type is not `application/json` | 415 `JSON_REQUIRED` |
| Body exceeds 8 KiB | 413 `BODY_TOO_LARGE` |
| Quote is valid but the requested window overlaps a confirmed reservation | 409 `TIME_CONFLICT` |

[Route dispatch and JSON limits](../app.mjs) · [Identity rules](../identity/access.mjs) · [HTTP integration tests](../test/http.test.mjs)
