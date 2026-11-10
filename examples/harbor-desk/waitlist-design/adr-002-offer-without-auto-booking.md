# ADR 002 · Offer a released slot without booking it automatically

**Status** Proposed. No waitlist behavior from this decision exists in the current application.

## Context

A member's plans can change while waiting. Automatic booking after a cancellation could reserve an unwanted time and commit them to a price they have not accepted.

## Decision

Send an explicit offer after a slot is released. An offer is an invitation, not a reservation or a hold. Require a fresh acceptance before requesting a confirmed reservation and run the existing booking checks at that point.

## Rationale

Explicit acceptance preserves member choice and keeps confirmation inside the existing reservation transaction. A second member could take the slot between an offer and acceptance. Checking again at acceptance is necessary to prevent conflicting reservations.

## Alternatives considered

Automatic booking reduces interaction but commits the member without current consent. Holding a slot during the offer window reduces conflicts but removes inventory while the member decides. The proposal leaves inventory open and accepts the possibility of a conflict when the member responds.

## Open questions

Offer lifetime, ranking and fairness, delivery channels, and retention of opt-in requests remain open. They are design questions without current API or storage contracts.
