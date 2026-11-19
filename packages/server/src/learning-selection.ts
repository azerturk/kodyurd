import { createHash } from "node:crypto";
import type { TSpaceDocument } from "@kodyurd/scene-schema";

type Question = NonNullable<TSpaceDocument["assessment"]>["questions"][number];
type Stop = TSpaceDocument["tour"][number];

/** New generations namespace provider-local IDs; saved scenes keep their original IDs. */
export function assembledQuestionId(moduleRef: string, deliverable: string, localId: string): string {
  return `kc-question-${createHash("sha256").update(JSON.stringify([moduleRef, deliverable, localId])).digest("hex").slice(0, 40)}`;
}

export interface LearningLimit {
  /** Valid unique questions excluded by the city-wide limit. */
  questions: number;
  /** Tour stops excluded by the city-wide limit. */
  tourStops: number;
}

export interface ScopedLearning<T> {
  scope: string;
  item: T;
}

/** Bounded, deterministic quotas keep the first large lesson from consuming the city. */
export function fairLearningSelection<T>(rows: ScopedLearning<T>[], limit: number, initial: ScopedLearning<T>[] = []): T[] {
  const selected = initial.slice(0, limit);
  const counts = new Map<string, number>();
  for (const row of selected) counts.set(row.scope, (counts.get(row.scope) ?? 0) + 1);
  const buckets = new Map<string, { scope: string; items: T[]; index: number }>();
  for (const { scope, item } of rows) {
    const bucket = buckets.get(scope) ?? { scope, items: [], index: 0 };
    bucket.items.push(item);
    buckets.set(scope, bucket);
  }
  const groups = [...buckets.values()].sort((a, b) => a.scope.localeCompare(b.scope));
  // Each iteration consumes a bounded output slot or ends when no input remains.
  for (let slot = selected.length; slot < limit; slot++) {
    let next: typeof groups[number] | undefined;
    for (const group of groups) {
      if (group.index >= group.items.length) continue;
      if (!next || (counts.get(group.scope) ?? 0) < (counts.get(next.scope) ?? 0)) next = group;
    }
    if (!next) break;
    selected.push({ scope: next.scope, item: next.items[next.index++]! });
    counts.set(next.scope, (counts.get(next.scope) ?? 0) + 1);
  }
  return selected.map(({ item }) => item);
}

export function selectCityLearning(questions: ScopedLearning<Question>[], tour: ScopedLearning<Stop>[], intro: ScopedLearning<Stop>[]): {
  questions: Question[]; tour: Stop[]; omitted: LearningLimit;
} {
  const groups = new Map<string, Map<string, ScopedLearning<Question>>>();
  for (const row of questions) {
    const item = row.item;
    const signature = JSON.stringify([row.scope, item.title, item.kind, item.prompt,
      [...item.options].sort((a, b) => a.id.localeCompare(b.id)), item.answer, item.explanation,
      item.source, item.building, item.replay]);
    const group = groups.get(item.id) ?? new Map<string, ScopedLearning<Question>>();
    group.set(signature, row);
    groups.set(item.id, group);
  }
  // A malformed provider can repeat a local ID inside one lesson, too. Keep
  // distinct questions rather than silently letting the last one replace it.
  const unique = [...groups.entries()].flatMap(([id, variants]) => variants.size === 1 ? [...variants.values()]
    : [...variants.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([signature, row]) => ({
      ...row, item: { ...row.item, id: `${id.slice(0, 47)}-${createHash("sha256").update(signature).digest("hex").slice(0, 16)}` }
    })));
  const chosenQuestions = fairLearningSelection(unique, 64);
  const chosenTour = fairLearningSelection(tour, 40, intro);
  return {
    questions: chosenQuestions,
    tour: chosenTour,
    omitted: { questions: unique.length - chosenQuestions.length, tourStops: tour.length + intro.length - chosenTour.length }
  };
}
