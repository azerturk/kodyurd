const RETRY_BASE_MS = 1000;
const ATTEMPT_LIMIT = 3;
const SUBJECTS = { confirmed: "Reservation confirmed", cancelled: "Reservation cancelled" };

export function createNotificationWorker(store, { now = Date.now, simulateDelivery = () => true } = {}) {
  function tick() {
    const timestamp = now();
    return store.write(() => {
      const next = store.nextNotification(timestamp);
      if (!next) return { state: "idle" };
      const attempts = next.attempts + 1;
      if (!simulateDelivery(next, attempts)) {
        const exhausted = attempts >= ATTEMPT_LIMIT;
        const dueAt = exhausted ? timestamp : timestamp + RETRY_BASE_MS * 2 ** (attempts - 1);
        store.failNotification(next.id, exhausted ? "failed" : "queued", attempts, dueAt, "MAILBOX_TEMPORARILY_UNAVAILABLE");
        return { state: exhausted ? "failed" : "retry-scheduled", attempts, dueAt };
      }
      store.recordDelivery(next, SUBJECTS[next.kind], timestamp);
      store.finishNotification(next.id, attempts);
      return { state: "delivered", attempts };
    });
  }

  return {
    tick,
    start({ intervalMs = 250, onError = console.error } = {}) {
      const timer = setInterval(() => {
        try {
          tick();
        } catch (error) {
          onError(error);
        }
      }, intervalMs);
      return () => clearInterval(timer);
    },
  };
}
