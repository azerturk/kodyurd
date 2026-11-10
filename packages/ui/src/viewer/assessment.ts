import type { SpaceAssessmentQuestion, SpaceDoc } from "../space-types";

export interface ExamAttempt {
  answers: Record<string, string[]>;
  finished: boolean;
}

function questionVersion(question: SpaceAssessmentQuestion): string {
  const options = [...question.options].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify([question.kind, question.prompt, options, question.answer]);
}

export function questionsFor(space: SpaceDoc): SpaceAssessmentQuestion[] {
  if (space.assessment?.questions.length) return space.assessment.questions;
  return space.tour.flatMap(({ checkpoint, ref }, index) => {
    const source = checkpoint?.source;
    if (!checkpoint || !source?.startLine || !checkpoint.explanation) return [];
    const correct = checkpoint.options.filter((option) => option.correct);
    if (correct.length !== 1 || checkpoint.options.length < 2) return [];
    const flow = space.flows.find(({ id }) => id === ref);
    return [{
      id: `tour-checkpoint-${index}`,
      kind: "choice",
      prompt: checkpoint.question,
      options: checkpoint.options.map(({ id, label }) => ({ id, label })),
      answer: [correct[0]!.id],
      explanation: checkpoint.explanation,
      source,
      building: space.city.buildings.find(({ id }) => id === ref)?.id ??
        (flow?.scope.startsWith("module:") ? flow.scope.slice("module:".length) : undefined),
      replay: flow && { flow: flow.id }
    }];
  });
}

export function isCorrect(question: SpaceAssessmentQuestion, answer: string[]): boolean {
  return question.answer.length === answer.length && question.answer.every((id, index) => id === answer[index]);
}

export function initialOrder(question: SpaceAssessmentQuestion): string[] {
  const ids = question.options.map(({ id }) => id);
  return isCorrect(question, ids) ? [...ids.slice(1), ids[0]!] : ids;
}

export function validAnswer(question: SpaceAssessmentQuestion, answer: unknown): answer is string[] {
  return Array.isArray(answer) && answer.length === (question.kind === "order" ? question.options.length : 1) &&
    new Set(answer).size === answer.length && answer.every((id) => question.options.some((option) => option.id === id));
}

export function readProgress(key: string): unknown {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as unknown : undefined;
  } catch {
    return undefined;
  }
}

export function saveProgress(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is optional in offline viewers and private browsing.
  }
}

export function saveAttempt(key: string, attempt: ExamAttempt, questions: SpaceAssessmentQuestion[]): void {
  const versions = Object.fromEntries(questions.filter((question) => Object.hasOwn(attempt.answers, question.id))
    .map((question) => [question.id, questionVersion(question)]));
  saveProgress(key, { ...attempt, versions });
}

export function readAttempt(key: string, questions: SpaceAssessmentQuestion[], legacyKey?: string): ExamAttempt {
  const stored = readProgress(key);
  const saved = (stored ?? (legacyKey ? readProgress(legacyKey) : undefined)) as
    (Partial<ExamAttempt> & { versions?: Record<string, string> }) | undefined;
  const answers = Object.fromEntries(questions.flatMap((question) => {
    const answer = saved?.answers?.[question.id];
    if (saved?.versions && saved.versions[question.id] !== questionVersion(question)) return [];
    return validAnswer(question, answer) ? [[question.id, answer]] : [];
  }));
  return { answers, finished: saved?.finished === true && Object.keys(answers).length === questions.length };
}
