import type { SpaceFlow, SpaceFlowPoint, SpaceSource } from "../space-types";

export interface ReplayNode {
  id: string;
  point: SpaceFlowPoint;
  x: number;
  z: number;
  decision: boolean;
}

export interface ReplayEdge {
  from: string;
  to: string;
  label?: string;
  source?: SpaceSource;
}

export interface ReplayTrace {
  id: string;
  title: string;
  summary?: string;
  steps: ReplayNode[];
}

export function replayDifferences(a: ReplayTrace, b: ReplayTrace): {
  pathSplit: number | undefined;
  stateDifference: number | undefined;
} {
  const stateSignature = (step: ReplayNode): string => JSON.stringify((step.point.state ?? [])
    .map(({ key, value }) => [key, value]).sort(([keyA, valueA], [keyB, valueB]) =>
      keyA.localeCompare(keyB) || valueA.localeCompare(valueB)));
  let stateDifference: number | undefined;
  for (let i = 0; i < Math.max(a.steps.length, b.steps.length); i += 1) {
    const left = a.steps[i];
    const right = b.steps[i];
    if (!left || !right || left.id !== right.id) return { pathSplit: i, stateDifference };
    if (stateDifference === undefined && stateSignature(left) !== stateSignature(right)) stateDifference = i;
  }
  return { pathSplit: undefined, stateDifference };
}

export function selectReplayCursor(
  traces: ReplayTrace[],
  selection?: { scenarioId?: string; stepId?: string; stepIndex?: number }
): { trace: ReplayTrace; step: number } | null {
  const { scenarioId, stepId, stepIndex } = selection ?? {};
  const candidates = scenarioId ? traces.filter((trace) => trace.id === scenarioId) : traces;
  const trace = candidates[0];
  if (!trace) return null;
  if (stepIndex !== undefined) {
    return scenarioId && stepId && trace.steps[stepIndex]?.id === stepId ? { trace, step: stepIndex } : null;
  }
  if (!stepId) return { trace, step: 0 };
  let match: { trace: ReplayTrace; step: number } | null = null;
  for (const candidate of candidates) for (const [step, node] of candidate.steps.entries()) {
    if (node.id !== stepId) continue;
    if (match) return null;
    match = { trace: candidate, step };
  }
  return match;
}

export function buildFlowReplay(flow: SpaceFlow): {
  nodes: ReplayNode[];
  edges: ReplayEdge[];
  traces: ReplayTrace[];
} {
  const gap = 4.4;
  const main: ReplayNode[] = flow.path.map((point, i) => ({
    id: point.id ?? `main:${i}`,
    point,
    x: (i - (flow.path.length - 1) / 2) * gap,
    z: 0,
    decision: false
  }));
  const nodes = [...main];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: ReplayEdge[] = [];
  const connect = (steps: ReplayNode[], label?: string): void => {
    for (let i = 1; i < steps.length; i++) {
      const previous = steps[i - 1];
      const next = steps[i];
      edges.push({
        from: previous.id,
        to: next.id,
        label: i === 1 ? label : undefined,
        source: next.point.source ?? previous.point.source ?? flow.source
      });
    }
  };
  connect(main);
  const alternatives: ReplayTrace[] = [];
  for (const [i, branch] of (flow.branches ?? []).entries()) {
    const start = main.find((node) => branch.from && node.id === branch.from) ?? main[branch.at];
    if (!start) continue;
    start.decision = true;
    const z = (i % 2 === 0 ? 1 : -1) * (3.8 + Math.floor(i / 2) * 3);
    const branchNodes = branch.path.map((point, j) => ({
      id: point.id ?? `branch:${i}:${j}`,
      point,
      x: start.x + (j + 1) * gap,
      z,
      decision: false
    }));
    for (const node of branchNodes) {
      nodes.push(node);
      byId.set(node.id, node);
    }
    const join = main.find((node) => branch.join && node.id === branch.join);
    connect([start, ...branchNodes, ...(join ? [join] : [])], branch.condition);
    const continuation = join ? main.slice(main.indexOf(join)) : [];
    alternatives.push({
      id: branch.id ?? `branch:${i}`,
      title: branch.condition,
      steps: [...main.slice(0, main.indexOf(start) + 1), ...branchNodes, ...continuation]
    });
  }
  const traces: ReplayTrace[] = [];
  for (const scenario of flow.scenarios ?? []) {
    const events = new Map(scenario.events?.map((event) => [event.stepIndex, event]));
    const steps = scenario.steps.map((id, stepIndex) => {
      const node = byId.get(id);
      const event = events.get(stepIndex);
      if (!node || !event) return node;
      const point = { ...node.point, detail: event.detail ?? node.point.detail, state: event.state ?? node.point.state, source: event.source };
      return { ...node, point };
    });
    if (steps.length > 0 && steps.every((step): step is ReplayNode => step !== undefined)) {
      traces.push({ id: scenario.id, title: scenario.title, summary: scenario.summary, steps });
    }
  }
  if (traces.length === 0 && main.length) {
    traces.push({ id: "main", title: "Main path", steps: main }, ...alternatives);
  }
  return { nodes, edges, traces };
}
