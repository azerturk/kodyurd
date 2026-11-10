import { useState } from "react";
import type { SpaceAssessmentQuestion, SpaceSource } from "../space-types";
import { initialOrder, isCorrect, readAttempt, saveAttempt } from "./assessment";

export type LearningTab = "tour" | "practice" | "exam";
type ReplayRef = NonNullable<SpaceAssessmentQuestion["replay"]>;

interface LearningActions {
  openSource: (source: SpaceSource, title?: string) => void;
  openReplay: (target: ReplayRef) => boolean;
}

function QuestionForm({ question, disabled, onAnswer }: {
  question: SpaceAssessmentQuestion;
  disabled: boolean;
  onAnswer: (answer: string[]) => void;
}) {
  const ordered = question.kind === "order";
  const [answer, setAnswer] = useState<string[]>(() => ordered ? initialOrder(question) : []);
  const move = (index: number, direction: number): void => {
    const next = [...answer];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setAnswer(next);
  };
  return (
    <fieldset className="kd-question" disabled={disabled}>
      <legend>{question.prompt}</legend>
      {ordered && <p className="kd-lesson-muted">Put these steps in execution order.</p>}
      {ordered ? (
        <ol className="kd-question-options" aria-label="Order the steps">
          {answer.map((id, index) => {
            const label = question.options.find((option) => option.id === id)?.label ?? id;
            return (
              <li className="kd-order-row" key={id}>
                <span>{index + 1}. {label}</span>
                <button type="button" className="kd-learn-icon" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className="kd-learn-icon" disabled={index === answer.length - 1} aria-label={`Move ${label} down`} onClick={() => move(index, 1)}>↓</button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="kd-question-options" role="group" aria-label={question.kind === "target" ? "Components" : "Answers"}>
          {question.options.map(({ id, label }) => (
            <button type="button" key={id} className="kd-question-option" aria-pressed={answer[0] === id} onClick={() => setAnswer([id])}>{label}</button>
          ))}
        </div>
      )}
      <button type="button" className="kd-learn-action kd-learn-primary" disabled={!answer.length} onClick={() => onAnswer(answer)}>Submit answer</button>
    </fieldset>
  );
}

function QuestionReview({ question, answer, openReplay, openSource }: LearningActions & { question: SpaceAssessmentQuestion; answer: string[] }) {
  const [replayUnavailable, setReplayUnavailable] = useState(false);
  const replay = question.replay;
  const correct = isCorrect(question, answer);
  const labels = (ids: string[]): string => ids.map((id) => question.options.find((option) => option.id === id)?.label ?? id).join(" → ");
  return (
    <section className="kd-question-review">
      <strong className={correct ? "kd-correct" : "kd-incorrect"}>{correct ? "Correct" : "Review this answer"}</strong>
      <p>Your answer · {labels(answer)}</p>
      {!correct && <p>Expected · {labels(question.answer)}</p>}
      <p>{question.explanation}</p>
      <div className="kd-lesson-actions">
        <button type="button" className="kd-learn-action" onClick={() => openSource(question.source, question.title)}>Read evidence ↗</button>
        {replay && !replayUnavailable && <button type="button" className="kd-learn-action" onClick={() => setReplayUnavailable(!openReplay(replay))}>Show in replay →</button>}
        {replay && replayUnavailable && <button type="button" className="kd-learn-action" onClick={() => openReplay({ flow: replay.flow, scenario: replay.scenario })}>Open {replay.scenario ? "scenario" : "flow"} from start →</button>}
      </div>
      {replayUnavailable && <p role="status" className="kd-lesson-muted">The exact event could not be resolved in this saved lesson.</p>}
    </section>
  );
}

function Practice({ questions, ...actions }: LearningActions & { questions: SpaceAssessmentQuestion[] }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<string[] | null>(null);
  const question = questions[index]!;
  return (
    <section>
      <p className="kd-lesson-muted">Practice {index + 1} of {questions.length} · Feedback after each answer</p>
      <QuestionForm key={question.id} question={question} disabled={Boolean(answer)} onAnswer={setAnswer} />
      {answer && <div aria-live="polite">
        <QuestionReview key={question.id} question={question} answer={answer} {...actions} />
        <button type="button" className="kd-learn-action" onClick={() => {
          setAnswer(null);
          setIndex((index + 1) % questions.length);
        }}>{index + 1 === questions.length ? "Restart practice" : "Next question →"}</button>
      </div>}
    </section>
  );
}

function Exam({ questions, progressKey, legacyProgressKey, ...actions }: LearningActions & {
  questions: SpaceAssessmentQuestion[];
  progressKey: string;
  legacyProgressKey?: string;
}) {
  const [attempt, setAttempt] = useState(() => readAttempt(progressKey, questions, legacyProgressKey));
  const index = questions.findIndex((question) => !Object.hasOwn(attempt.answers, question.id));
  const question = questions[index];
  const update = (answers: typeof attempt.answers, finished: boolean): void => {
    const next = { answers, finished };
    saveAttempt(progressKey, next, questions);
    setAttempt(next);
  };
  if (attempt.finished) {
    const correct = questions.filter((item) => isCorrect(item, attempt.answers[item.id]!)).length;
    return (
      <section>
        <h3 className="kd-lesson-result" role="status">{correct}/{questions.length} correct</h3>
        {questions.map((item) => (
          <details key={item.id} className="kd-lesson-review-item">
            <summary>{isCorrect(item, attempt.answers[item.id]!) ? "✓" : "○"} {item.title ?? item.prompt}</summary>
            <QuestionReview question={item} answer={attempt.answers[item.id]!} {...actions} />
          </details>
        ))}
        <button type="button" className="kd-learn-action" onClick={() => update({}, false)}>Start a new exam</button>
      </section>
    );
  }
  return (
    <section>
      <p className="kd-lesson-muted">{question ? `Question ${index + 1} of ${questions.length}` : "All answers submitted"} · Review at the end</p>
      {question ? (
        <QuestionForm key={question.id} question={question} disabled={false} onAnswer={(answer) => update({ ...attempt.answers, [question.id]: answer }, false)} />
      ) : (
        <button type="button" className="kd-learn-action kd-learn-primary" onClick={() => update(attempt.answers, true)}>Finish exam and see results</button>
      )}
    </section>
  );
}

export function LearningActivities({ mode, questions, progressKey, legacyProgressKey, ...actions }: LearningActions & {
  mode: "practice" | "exam";
  questions: SpaceAssessmentQuestion[];
  progressKey: string;
  legacyProgressKey?: string;
}) {
  if (!questions.length) return <p className="kd-lesson-muted">No source-backed questions are available here. Open a flow or read its sources to explore the topic.</p>;
  const revisionKey = legacyProgressKey ?? progressKey;
  return mode === "exam"
    ? <Exam key={revisionKey} questions={questions} progressKey={progressKey} legacyProgressKey={legacyProgressKey} {...actions} />
    : <Practice key={revisionKey} questions={questions} {...actions} />;
}
