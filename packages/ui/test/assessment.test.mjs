import assert from "node:assert/strict";
import test from "node:test";
import { initialOrder, isCorrect, readAttempt, saveAttempt, saveProgress } from "../src/viewer/assessment.ts";

test("exam resumes the first response and rejects stale option IDs", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  } });
  try {
    const question = { id: "order", kind: "order", answer: ["start", "end"], options: [
      { id: "start", label: "Start" }, { id: "end", label: "End" }
    ] };
    const first = initialOrder(question);
    assert.deepEqual(first, ["end", "start"]);
    assert.equal(isCorrect(question, first), false);
    saveProgress("exam", { answers: { order: first }, finished: true });
    assert.deepEqual(readAttempt("exam", [question]), { answers: { order: first }, finished: true });
    saveProgress("exam", { answers: { order: ["end", "removed"] }, finished: true });
    assert.deepEqual(readAttempt("exam", [question]), { answers: {}, finished: false });
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  }
});

test("saved exam progress survives unchanged questions and discards changed meaning on the same IDs", () => {
  const storage = new Map();
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  } });
  try {
    const a = { id: "a", kind: "choice", prompt: "What runs first?", answer: ["one"],
      options: [{ id: "one", label: "Checkout" }, { id: "two", label: "Worker" }] };
    const b = { ...a, id: "b", prompt: "What runs second?", answer: ["two"] };
    const old = { answers: { a: ["one"], b: ["two"] }, finished: true };
    saveProgress("revision", old);
    assert.deepEqual(readAttempt("stable", [a, b], "revision"), old);
    saveAttempt("stable", old, [a, b]);
    assert.deepEqual(readAttempt("stable", [a, { ...b, options: [...b.options].reverse() }]), old);
    assert.deepEqual(readAttempt("stable", [a, { ...b, answer: ["one"] }]), { answers: { a: ["one"] }, finished: false });
    assert.deepEqual(readAttempt("stable", [a, b, { ...b, id: "c" }]), { answers: old.answers, finished: false });
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  }
});
