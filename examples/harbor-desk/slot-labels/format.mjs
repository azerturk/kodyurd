// The booking form supplies a half-hour index from 0 through 18.
export function formatSlotLabel(slot) {
  const minutesSinceMidnight = 9 * 60 + slot * 30;
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
