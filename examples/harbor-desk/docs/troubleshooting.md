# Troubleshooting

| What you observe | How to investigate |
| --- | --- |
| `409 TIME_CONFLICT` after a valid quote | The quote prices the requested duration. Check for an overlapping confirmed booking on the same resource, then choose a different window or an adjacent slot. |
| `403 CANCELLATION_DENIED` | Check the active identity and the reservation owner. Only that owner or Morgan can cancel it. |
| `400 INVALID_WINDOW` | Check both values use the same UTC date and a half-hour boundary. The duration must be 30 minutes to four hours within 09:00–18:00 UTC. |
| Booking appears but the mailbox is empty | Refresh activity after the worker ticks. Check that the selected identity matches the reservation's owner. |
| Restarted process shows old reservations | The default database is persistent. Set `HARBOR_DB` to a distinct local file to start an isolated demonstration. |
| Port 4724 is already occupied | Set `PORT` to an available port before starting the app. |

To exercise retry on Windows PowerShell:

```powershell
$env:HARBOR_DEMO_NOTIFY_FAIL_ONCE = "1"
npm start
```

To exercise retry in a POSIX shell:

```sh
HARBOR_DEMO_NOTIFY_FAIL_ONCE=1 npm start
```

Book a resource and refresh activity under that member after the retry interval. Run `npm test` to cover retries and terminal failure deterministically without waiting for wall-clock delays.
