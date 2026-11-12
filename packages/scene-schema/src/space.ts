import { z } from "zod";
import { SceneDocument } from "./index.js";
import type { TSceneDocument } from "./index.js";

/**
 * Scene JSON v0.2 — "Space": the knowledge-city contract.
 *
 * Agents describe one walkable city. Deterministic builders compute its geometry.
 * The bounded token enums below define the presentation controls.
 * See docs/ARCHITECTURE.md and docs/skills/scene-schema.md.
 *
 * v0.1 (`SceneDocument`, ./index.ts) remains valid input: `parseSpace` upgrades
 * it city-only so old scenes and exports keep opening.
 */

/* ------------------------------------------------------------------ */
/* Bounded vocabularies (the ONLY presentation surface agents control) */
/* ------------------------------------------------------------------ */

export const SPACE_ICON_ROLES = [
  "database", "cache", "queue", "gear", "plug", "shield", "key", "lock",
  "document", "folder", "terminal", "chart", "clock", "envelope", "bell",
  "cloud", "server", "box", "chain", "magnifier", "warning", "badge", "user",
  "group", "globe", "calendar", "phone", "monitor", "chip", "flask", "truck",
  "factory", "layers", "cycle", "book", "pin", "eye", "puzzle", "robot",
  "bug", "rocket", "flag", "funnel", "scales", "coin", "gauge", "speech",
  "wrench", "grad-cap", "image", "antenna"
] as const;
export const IconRole = z.enum(SPACE_ICON_ROLES);
export type TIconRole = z.infer<typeof IconRole>;

export const ARCHETYPES = ["tower", "slab", "hall", "low", "landmark"] as const;
export const DISTRICT_KINDS = ["domain", "infrastructure", "workshop"] as const;
export const ACCENTS = ["teal", "amber", "violet", "green", "rose"] as const;
export const PANEL_VARIANTS = ["standard", "wide", "tall", "billboard"] as const;
export const CAMERA_ANGLES = ["front", "three-quarter", "high", "low", "orbit"] as const;
export const CAMERA_KINDS = ["inspect", "tour", "reveal"] as const;
export const TOUR_PACING = ["calm", "normal", "brisk"] as const;
export const DIAGRAM_KINDS = ["graph", "sequence", "state", "stack", "timeline", "matrix", "erd", "class", "mindmap"] as const;
export const DIAGRAM_NODE_HINTS = ["service", "store", "external", "ui", "actor", "event", "queue", "decision", "state", "initial", "terminal"] as const;
export const DIAGRAM_EDGE_KINDS = ["solid", "dashed", "async", "return"] as const;
export const DIAGRAM_FIELD_KEYS = ["PK", "FK", "UK"] as const;
export const DIAGRAM_CARDINALITIES = ["1", "0..1", "1..*", "0..*"] as const;
export const FLOW_KINDS = ["calls", "data", "next", "depends"] as const;
/** The five personal-overlay offer classes (D4). Nothing else is ever offered. */
export const MODEL_CLASSES = ["landmark", "centerpiece", "character", "emblem", "icon"] as const;

/* --------------------------- primitives --------------------------- */

const Pos = z.object({ x: z.number(), z: z.number() });
const Size = z.object({ w: z.number().positive(), d: z.number().positive() });

const SrcRef = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
});
export type TSpaceSourceRef = z.infer<typeof SrcRef>;

const Id = z.string().min(1).max(64);

const CheckOption = z.object({
  id: Id,
  label: z.string().min(1),
  correct: z.boolean().optional()
});
const Check = z
  .object({
    question: z.string().min(1),
    options: z.array(CheckOption).min(2).max(4),
    explanation: z.string().optional(),
    source: SrcRef.optional()
  })
  .refine((c) => c.options.filter((o) => o.correct).length === 1, {
    message: "exactly one option must have correct: true"
  });

/* ------------------------------ city ------------------------------ */

export const District = z.object({
  id: Id,
  title: z.string().min(1),
  kind: z.enum(DISTRICT_KINDS).default("domain"),
  /** Optional: the city layouter fills positions deterministically. */
  position: Pos.optional(),
  size: Size.optional()
});

export const Building = z.object({
  id: Id,
  /** The analyzer module this building IS (buildings are never invented). */
  moduleRef: z.string().min(1),
  title: z.string().min(1),
  district: Id,
  metrics: z
    .object({
      files: z.number().int().nonnegative().default(0),
      loc: z.number().int().nonnegative().default(0),
      docs: z.number().int().nonnegative().default(0)
    })
    .default({ files: 0, loc: 0, docs: 0 }),
  /** Semantic hint; the asset registry picks the model (never a file path). */
  archetype: z.enum(ARCHETYPES).optional(),
  accent: z.enum(ACCENTS).optional(),
  /** Personal-overlay brief — only within the five D4 offer classes. */
  model: z.object({ class: z.enum(MODEL_CLASSES), prompt: z.string().min(8).max(400) }).optional(),
  summary: z.string().max(400),
  source: SrcRef.optional()
});

/* ------------------------------ flows ------------------------------ */

const ReplayStepIndex = z.number().int().min(0).max(31);
const DisplayState = z.array(z.object({ key: z.string().min(1).max(60), value: z.string().max(120) })).max(8);

export const FlowPoint = z.object({
  /** Stable, flow-local identity used by authored scenarios. */
  id: Id.optional(),
  /**
   * What this step anchors to: a building/district/diagram/flow id from this
   * document, or "step:<slug>" for a pure narrative station (corridor stop
   * with no spatial anchor of its own).
   */
  ref: z.string().min(1),
  caption: z.string().max(160).optional(),
  actor: z.string().min(1).max(80).optional(),
  detail: z.string().min(1).max(480).optional(),
  /** Display-only example state. Values never affect application behavior. */
  state: DisplayState.optional(),
  source: SrcRef.optional()
});

export const FlowBranch = z.object({
  id: Id.optional(),
  /** Legacy index into `path`. A stable `from` takes precedence. */
  at: z.number().int().nonnegative(),
  from: Id.optional(),
  /** Optional return to a main-path step, including an earlier retry point. */
  join: Id.optional(),
  condition: z.string().min(1).max(80),
  path: z.array(FlowPoint).min(1).max(12)
});

export const FlowEvent = z.object({
  /** Zero-based occurrence in the named scenario's trace. */
  stepIndex: ReplayStepIndex,
  detail: z.string().min(1).max(480).optional(),
  /** Overrides the node's display state for this occurrence only. */
  state: DisplayState.optional(),
  source: SrcRef.extend({ startLine: z.number().int().positive() })
});

export const FlowScenario = z.object({
  id: Id,
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(320).optional(),
  /** A finite trace through this flow's existing steps, never an expression. */
  steps: z.array(Id).min(2).max(32),
  events: z.array(FlowEvent).max(32).optional()
}).superRefine((scenario, ctx) => {
  const seen = new Set<number>();
  for (const [index, event] of (scenario.events ?? []).entries()) {
    if (event.stepIndex >= scenario.steps.length || seen.has(event.stepIndex)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["events", index, "stepIndex"], message: "expected a unique trace position" });
    }
    seen.add(event.stepIndex);
  }
});

export const SpaceFlow = z.object({
  id: Id,
  title: z.string().min(1).max(80),
  scope: z.string().regex(/^(system|module:[A-Za-z0-9_.:-]+)$/),
  kind: z.enum(FLOW_KINDS).default("calls"),
  path: z.array(FlowPoint).min(2).max(16),
  branches: z.array(FlowBranch).max(6).optional(),
  scenarios: z.array(FlowScenario).max(8).optional(),
  source: SrcRef.optional()
}).superRefine((flow, ctx) => {
  const branches = flow.branches ?? [];
  const ids = new Set<string>();
  for (const point of [...flow.path, ...branches.flatMap((branch) => branch.path)]) {
    if (!point.id) continue;
    if (ids.has(point.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["path"], message: `duplicate step id ${point.id}` });
    }
    ids.add(point.id);
  }

  const mainIds = new Set(flow.path.map((step) => step.id));
  const transitions = new Map<string, Set<string>>();
  const connect = (from: string | undefined, to: string | undefined): void => {
    if (!from || !to) return;
    const next = transitions.get(from) ?? new Set<string>();
    next.add(to);
    transitions.set(from, next);
  };
  const connectPath = (path: typeof flow.path): void => {
    path.forEach((point, index) => connect(point.id, path[index + 1]?.id));
  };
  connectPath(flow.path);
  const branchIds = new Set<string>();
  branches.forEach((branch, index) => {
    if (branch.id) {
      if (branchIds.has(branch.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["branches", index, "id"], message: "duplicate branch id" });
      }
      branchIds.add(branch.id);
    }
    for (const field of ["from", "join"] as const) {
      const id = branch[field];
      if (id && !mainIds.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["branches", index, field], message: `unknown main step ${id}` });
      }
    }
    connect(branch.from ?? flow.path[branch.at]?.id, branch.path[0]?.id);
    connectPath(branch.path);
    connect(branch.path.at(-1)?.id, branch.join);
  });

  const scenarioIds = new Set<string>();
  (flow.scenarios ?? []).forEach((scenario, index) => {
    if (scenarioIds.has(scenario.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarios", index, "id"], message: "duplicate scenario id" });
    }
    scenarioIds.add(scenario.id);
    scenario.steps.forEach((id, step) => {
      const valid = step === 0 ? id === flow.path[0]?.id : transitions.get(scenario.steps[step - 1])?.has(id);
      if (!valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenarios", index, "steps", step],
          message: `step ${id} is unreachable from the preceding step or flow entry`
        });
      }
    });
  });
});

/* ---------------------------- diagrams ---------------------------- */

export const DiagramField = z.object({
  name: z.string().min(1).max(64),
  type: z.string().min(1).max(60),
  keys: z.array(z.enum(DIAGRAM_FIELD_KEYS)).max(3).optional(),
  note: z.string().min(1).max(160).optional(),
  source: SrcRef.optional()
});

export const DiagramNode = z.object({
  id: Id,
  // Decision tables keep full conditions and results in the inspector.
  label: z.string().min(1).max(140),
  group: z.string().max(40).optional(),
  icon: IconRole.optional(),
  hint: z.enum(DIAGRAM_NODE_HINTS).optional(),
  fields: z.array(DiagramField).max(40).optional(),
  source: SrcRef.optional()
});

export const DiagramEdge = z.object({
  id: Id.optional(),
  from: Id,
  to: Id,
  label: z.string().max(48).optional(),
  kind: z.enum(DIAGRAM_EDGE_KINDS).optional(),
  guard: z.string().min(1).max(80).optional(),
  cardinality: z.object({ from: z.enum(DIAGRAM_CARDINALITIES), to: z.enum(DIAGRAM_CARDINALITIES) }).optional(),
  source: SrcRef.optional()
});

export const DIAGRAM_CLAIM_KINDS = ["responsibility", "input", "output", "guard", "invariant", "decision", "disagreement"] as const;
export const CLAIM_EVIDENCE_KINDS = ["code", "docs", "test"] as const;

export const ClaimEvidence = z.object({
  kind: z.enum(CLAIM_EVIDENCE_KINDS),
  path: z.string().min(1).max(500),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  /** Computed from the exact span by the server at acceptance. */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Computed from the current workspace on a trusted live read. */
  stale: z.literal(true).optional()
}).refine(({ startLine, endLine }) => endLine >= startLine && endLine - startLine < 40, {
  path: ["endLine"], message: "expected an exact inclusive source span of at most 40 lines"
});
export type TClaimEvidence = z.infer<typeof ClaimEvidence>;

export const DiagramClaim = z.object({
  id: Id,
  target: z.object({ kind: z.enum(["node", "edge"]), id: Id }),
  kind: z.enum(DIAGRAM_CLAIM_KINDS),
  text: z.string().min(1).max(360),
  evidence: z.array(ClaimEvidence).min(1).max(3),
  replay: z.object({ flow: Id, scenario: Id, step: Id, stepIndex: ReplayStepIndex }).optional()
}).superRefine(({ kind, evidence }, ctx) => {
  const docs = evidence.some((item) => item.kind === "docs");
  const executable = evidence.some((item) => item.kind === "code" || item.kind === "test");
  if (kind === "decision" && !docs || kind === "disagreement" && !(docs && executable)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "documented decisions and disagreements require authored documentation evidence" });
  }
  const spans = new Set(evidence.map(({ path, startLine, endLine }) => JSON.stringify([path, startLine, endLine])));
  if (spans.size !== evidence.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "duplicate claim evidence span" });
});
export type TDiagramClaim = z.infer<typeof DiagramClaim>;

export const SpaceDiagram = z
  .object({
    id: Id,
    /** "city", a building id, or "<buildingId>:<floorId>". */
    owner: z.string().min(1),
    title: z.string().min(1).max(100),
    kind: z.enum(DIAGRAM_KINDS).default("graph"),
    nodes: z.array(DiagramNode).min(1).max(40),
    edges: z.array(DiagramEdge).max(80).default([]),
    claims: z.array(DiagramClaim).max(24).optional(),
    note: z.string().max(240).optional(),
    source: SrcRef.optional(),
    /**
     * Where this diagram came from. Mermaid/tables found by P0 are parsed, never re-invented.
     * "user" marks a diagram the user corrected, imported or drew; agents never emit it.
     */
    origin: z.enum(["docs", "code", "mermaid", "user"]).optional()
  })
  .superRefine((d, ctx) => {
    if (d.kind !== "erd" && d.nodes.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "expected at least two nodes" });
    }
    const ids = new Set(d.nodes.map((n) => n.id));
    if (ids.size !== d.nodes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "duplicate node ids" });
    }
    if (d.kind === "erd" || d.kind === "class") {
      for (const [index, { fields }] of d.nodes.entries()) {
        if (fields && new Set(fields.map(({ name }) => name)).size !== fields.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "fields"], message: "duplicate field names" });
        }
      }
    }
    const edgeIds = new Set<string>();
    d.edges.forEach((e, i) => {
      if (d.kind === "erd" && !e.cardinality) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", i, "cardinality"], message: "ERD relationships require cardinality at both ends" });
      }
      if (e.id) {
        if (edgeIds.has(e.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["edges", i, "id"], message: "duplicate edge id" });
        }
        edgeIds.add(e.id);
      }
      for (const end of [e.from, e.to] as const) {
        if (!ids.has(end)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges", i],
            message: `edge endpoint ${JSON.stringify(end)} is not a node id`
          });
        }
      }
    });
    const claimIds = new Set<string>();
    for (const [index, claim] of (d.claims ?? []).entries()) {
      if (claimIds.has(claim.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["claims", index, "id"], message: "duplicate claim id" });
      claimIds.add(claim.id);
      if (!(claim.target.kind === "node" ? ids : edgeIds).has(claim.target.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["claims", index, "target"], message: "claim target is not an identified node or edge in this diagram" });
      }
    }
  });

/* ---------------------------- interiors ---------------------------- */

const Floor = z.object({
  id: Id,
  title: z.string().min(1).max(80),
  /** Pedestal clusters: label + the semantically closest pack icon (V4). */
  components: z.array(z.object({ label: z.string().min(1).max(60), icon: IconRole.optional() })).max(24).default([]),
  diagrams: z.array(Id).max(8).default([]),
  /** Flow ids walked physically on this floor (forks = branches). */
  corridors: z.array(Id).max(4).default([]),
  source: SrcRef.optional()
});

export const Interior = z.object({
  building: Id,
  lobby: z.object({
    summary: z.string().max(400),
    /** Flow ids shown on the lobby catalog wall. */
    catalogRefs: z.array(Id).max(24).default([]),
    /** Indices into meta.coverage listed on the lobby coverage board. */
    coverageRefs: z.array(z.number().int().nonnegative()).max(40).default([]),
    /** Personal-overlay brief for the lobby centerpiece (class "centerpiece"). */
    centerpiece: z.object({ prompt: z.string().min(8).max(400) }).optional()
  }),
  floors: z.array(Floor).min(0).max(6).default([])
});

/* --------------------------- presentation -------------------------- */

export const CameraShot = z.object({
  id: Id,
  /** A ref from this document (building/district/diagram/flow/floor key). */
  target: z.string().min(1),
  angle: z.enum(CAMERA_ANGLES).default("three-quarter"),
  kind: z.enum(CAMERA_KINDS)
});

export const StartFocus = z.object({
  building: Id,
  flow: Id.optional(),
  diagram: Id.optional()
});

export const Presentation = z.object({
  start: StartFocus.optional(),
  accentOverrides: z.record(z.string(), z.enum(ACCENTS)).optional(),
  panelVariants: z.record(z.string(), z.enum(PANEL_VARIANTS)).optional(),
  cameraShots: z.array(CameraShot).max(120).default([]),
  tourPacing: z.enum(TOUR_PACING).optional()
});

/* ---------------------------- navigation --------------------------- */

export type TMenuNode = { label: string; ref?: string; children?: TMenuNode[] };
export const MenuNode: z.ZodType<TMenuNode> = z.lazy(() =>
  z.object({
    label: z.string().min(1).max(80),
    ref: z.string().optional(),
    children: z.array(MenuNode).max(60).optional()
  })
);

export const SearchEntry = z.object({
  label: z.string().min(1).max(100),
  kind: z.enum(["building", "district", "flow", "diagram", "floor", "doc", "term"]),
  ref: z.string().min(1),
  keywords: z.array(z.string().max(40)).max(12).default([]),
  /** Real file path for "open in editor". */
  sourcePath: z.string().optional()
});

export const Navigation = z.object({
  menu: z.array(MenuNode).max(12).default([]),
  searchIndex: z.array(SearchEntry).max(2000).default([])
});

/* ------------------------------- tour ------------------------------ */

export const SpaceTourStop = z.object({
  ref: z.string().min(1),
  narration: z.string().min(1),
  source: SrcRef.optional(),
  checkpoint: Check.optional(),
  /** "Walk to the thing that does X" — the walker must find `ref` themselves. */
  locate: z.object({ prompt: z.string().min(1).max(200) }).optional()
});

export const ASSESSMENT_KINDS = ["choice", "order", "target"] as const;

export const AssessmentReplay = z.object({
  flow: Id,
  scenario: Id.optional(),
  step: Id.optional(),
  /** Optional exact occurrence. The step and scenario IDs guard against stale links. */
  stepIndex: ReplayStepIndex.optional()
});

export function replayTargetIssue(flow: z.infer<typeof SpaceFlow>, replay: z.infer<typeof AssessmentReplay>): "scenario" | "step" | "stepIndex" | undefined {
  const scenario = flow.scenarios?.find(({ id }) => id === replay.scenario);
  if (replay.scenario && !scenario) return "scenario";
  if (replay.stepIndex !== undefined) {
    return !replay.step || scenario?.steps[replay.stepIndex] !== replay.step ? "stepIndex" : undefined;
  }
  const steps = scenario?.steps ?? [...flow.path, ...(flow.branches ?? []).flatMap(({ path }) => path)].map(({ id }) => id);
  return replay.step && !steps.includes(replay.step) ? "step" : undefined;
}

export const AssessmentOption = z.object({ id: Id, label: z.string().min(1).max(120) });

export const AssessmentQuestion = z.object({
  id: Id,
  title: z.string().min(1).max(80).optional(),
  kind: z.enum(ASSESSMENT_KINDS),
  prompt: z.string().min(1).max(280),
  options: z.array(AssessmentOption).min(2).max(8),
  answer: z.array(Id).min(1).max(8),
  explanation: z.string().min(1).max(480),
  source: SrcRef,
  building: Id.optional(),
  replay: AssessmentReplay.optional()
}).superRefine((question, ctx) => {
  const options = new Set(question.options.map(({ id }) => id));
  if (options.size !== question.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "option ids must be unique" });
  }
  const expectedLength = question.kind === "order" ? question.options.length : 1;
  if (question.answer.length !== expectedLength || new Set(question.answer).size !== expectedLength ||
      question.answer.some((id) => !options.has(id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["answer"], message: "answer must reference the expected distinct options" });
  }
  const { startLine, endLine } = question.source;
  if (startLine === undefined || (endLine !== undefined && endLine < startLine)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source"], message: "questions require an exact source line or range" });
  }
});

export type TAssessmentQuestion = z.infer<typeof AssessmentQuestion>;

/* ------------------------------ document --------------------------- */

const Coverage = z.object({
  doc: z.string().min(1),
  sections: z.number().int().nonnegative(),
  placed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative()
});

export const SpaceDocumentSchema = z
  .object({
    version: z.literal("0.2"),
    meta: z.object({
      name: z.string().min(1),
      sourceDir: z.string().min(1),
      language: z.string().default("en"),
      createdAt: z.string(),
      coverage: z.array(Coverage).max(400).default([])
    }),
    city: z.object({
      districts: z.array(District).min(1).max(16),
      /** Old document-only spaces can have districts without buildings. */
      buildings: z.array(Building).max(120)
    }),
    flows: z.array(SpaceFlow).max(80).default([]),
    diagrams: z.array(SpaceDiagram).max(120).default([]),
    interiors: z.array(Interior).max(120).default([]),
    presentation: Presentation.optional(),
    navigation: Navigation.default({ menu: [], searchIndex: [] }),
    tour: z.array(SpaceTourStop).max(40).default([]),
    assessment: z.object({ questions: z.array(AssessmentQuestion).max(64) }).optional()
  })
  .superRefine((doc, ctx) => {
    const districtIds = new Set(doc.city.districts.map((d) => d.id));
    const buildingIds = new Set(doc.city.buildings.map((b) => b.id));
    const diagramIds = new Set(doc.diagrams.map((d) => d.id));
    const flowIds = new Set(doc.flows.map((f) => f.id));
    const floorKeys = new Set<string>();
    for (const it of doc.interiors) for (const f of it.floors) floorKeys.add(`${it.building}:${f.id}`);

    const resolvable = (ref: string) =>
      ref === "gate" || ref === "plaza" || ref.startsWith("step:") ||
      districtIds.has(ref) || buildingIds.has(ref) || diagramIds.has(ref) ||
      flowIds.has(ref) || floorKeys.has(ref);

    const requireRef = (ref: string, path: (string | number)[]) => {
      if (!resolvable(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `unresolved ref ${JSON.stringify(ref)}` });
      }
    };

    doc.city.buildings.forEach((b, i) => {
      if (!districtIds.has(b.district)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["city", "buildings", i, "district"],
          message: `unknown district ${JSON.stringify(b.district)}`
        });
      }
    });

    doc.flows.forEach((f, i) => {
      const mod = f.scope.startsWith("module:") ? f.scope.slice(7) : undefined;
      if (mod && !buildingIds.has(mod)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flows", i, "scope"],
          message: `scope module ${JSON.stringify(mod)} is not a building id`
        });
      }
      f.path.forEach((p, j) => requireRef(p.ref, ["flows", i, "path", j, "ref"]));
      (f.branches ?? []).forEach((br, j) => {
        if (!br.from && br.at >= f.path.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["flows", i, "branches", j, "at"],
            message: "branch 'at' must index into path"
          });
        }
        br.path.forEach((p, k) => requireRef(p.ref, ["flows", i, "branches", j, "path", k, "ref"]));
      });
    });

    doc.diagrams.forEach((d, i) => {
      const ownerOk = d.owner === "city" || buildingIds.has(d.owner) || floorKeys.has(d.owner);
      if (!ownerOk) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["diagrams", i, "owner"],
          message: `owner must be "city", a building id or "<building>:<floor>"`
        });
      }
      for (const [index, claim] of (d.claims ?? []).entries()) {
        if (!claim.replay) continue;
        const flow = doc.flows.find(({ id }) => id === claim.replay!.flow);
        if (!flow || replayTargetIssue(flow, claim.replay)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["diagrams", i, "claims", index, "replay"], message: "claim replay must resolve to an exact occurrence" });
        }
      }
    });

    const interiorSeen = new Set<string>();
    doc.interiors.forEach((it, i) => {
      if (!buildingIds.has(it.building)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["interiors", i, "building"],
          message: `unknown building ${JSON.stringify(it.building)}`
        });
      }
      if (interiorSeen.has(it.building)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interiors", i], message: "one interior per building" });
      }
      interiorSeen.add(it.building);
      it.lobby.catalogRefs.forEach((r, j) => {
        if (!flowIds.has(r)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["interiors", i, "lobby", "catalogRefs", j],
            message: `unknown flow ${JSON.stringify(r)}`
          });
        }
      });
      it.lobby.coverageRefs.forEach((r, j) => {
        if (r >= doc.meta.coverage.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["interiors", i, "lobby", "coverageRefs", j],
            message: "coverage index out of range"
          });
        }
      });
      it.floors.forEach((fl, j) => {
        fl.diagrams.forEach((d, k) => {
          if (!diagramIds.has(d)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["interiors", i, "floors", j, "diagrams", k],
              message: `unknown diagram ${JSON.stringify(d)}`
            });
          }
        });
        fl.corridors.forEach((c, k) => {
          if (!flowIds.has(c)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["interiors", i, "floors", j, "corridors", k],
              message: `unknown flow ${JSON.stringify(c)}`
            });
          }
        });
      });
    });

    if (doc.presentation) {
      const start = doc.presentation.start;
      if (start) {
        const targets = { building: buildingIds, flow: flowIds, diagram: diagramIds };
        for (const field of ["building", "flow", "diagram"] as const) {
          const id = start[field];
          if (id && !targets[field].has(id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["presentation", "start", field], message: `unknown ${field} ${id}` });
          }
        }
      }
      doc.presentation.cameraShots.forEach((s, i) =>
        requireRef(s.target, ["presentation", "cameraShots", i, "target"])
      );
      for (const key of Object.keys(doc.presentation.accentOverrides ?? {})) {
        requireRef(key, ["presentation", "accentOverrides", key]);
      }
    }

    doc.navigation.searchIndex.forEach((s, i) => requireRef(s.ref, ["navigation", "searchIndex", i, "ref"]));
    doc.tour.forEach((s, i) => requireRef(s.ref, ["tour", i, "ref"]));

    const questionIds = new Set<string>();
    for (const [i, question] of (doc.assessment?.questions ?? []).entries()) {
      const issue = (path: string[], message: string): void => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assessment", "questions", i, ...path], message });
      };
      if (questionIds.has(question.id)) issue(["id"], "duplicate question id");
      questionIds.add(question.id);
      if (question.building && !buildingIds.has(question.building)) issue(["building"], "unknown building");
      const replay = question.replay;
      if (!replay) continue;
      const flow = doc.flows.find(({ id }) => id === replay.flow);
      if (!flow) {
        issue(["replay", "flow"], "unknown flow");
        continue;
      }
      const invalid = replayTargetIssue(flow, replay);
      if (invalid) issue(["replay", invalid], "replay target does not belong to the selected flow and scenario");
    }
  });
export type TSpaceDocument = z.infer<typeof SpaceDocumentSchema>;

/* --------------------------- 0.1 upgrade --------------------------- */

/** Upgrade a parsed v0.1 SceneDocument to a city-only v0.2 Space. */
export function upgradeSceneToSpace(scene: TSceneDocument): TSpaceDocument {
  const districts = scene.zones.map((zone) => ({ id: zone.id, title: zone.title, kind: "domain" as const }));
  const buildings: Array<z.input<typeof Building>> = [];
  const diagrams: Array<z.input<typeof SpaceDiagram>> = [];
  for (const zone of scene.zones) {
    for (const item of zone.items) {
      if (item.kind === "building") {
        const height = item.height ?? 6;
        buildings.push({
          id: item.id,
          moduleRef: item.id,
          title: item.title,
          district: zone.id,
          metrics: { files: item.metrics?.files ?? 0, loc: item.metrics?.loc ?? 0, docs: 0 },
          archetype: (height >= 18 ? "tower" : height >= 10 ? "slab" : "low") as (typeof ARCHETYPES)[number],
          summary: item.summary ?? "",
          source: item.source
        });
      } else if (item.kind === "flowchart" || item.kind === "timeline") {
        const steps = item.steps ?? [];
        diagrams.push({
          id: item.id,
          owner: "city",
          title: item.title,
          kind: (item.kind === "timeline" ? "timeline" : "graph") as (typeof DIAGRAM_KINDS)[number],
          nodes: steps.map((s, i) => ({ id: `${item.id}-n${i}`, label: s.label })),
          edges: steps.slice(1).map((_, i) => ({ from: `${item.id}-n${i}`, to: `${item.id}-n${i + 1}` })),
          source: item.source,
          origin: "docs" as const
        });
      } else if (item.kind === "stack") {
        const layers = item.layers ?? [];
        diagrams.push({
          id: item.id,
          owner: "city",
          title: item.title,
          kind: "stack" as const,
          nodes: layers.map((l, i) => ({ id: `${item.id}-n${i}`, label: l.label })),
          edges: [],
          source: item.source,
          origin: "docs" as const
        });
      }
    }
  }
  const buildingIds = new Set(buildings.map((b) => b.id));
  const flows = scene.flows
    .filter((f) => buildingIds.has(f.from) && buildingIds.has(f.to))
    .map((f, i) => ({
      id: f.id ?? `flow-${i}`,
      title: f.label ?? `${f.from} → ${f.to}`,
      scope: "system",
      kind: f.kind,
      path: [{ ref: f.from }, { ref: f.to, caption: f.label }]
    }));
  const tour = scene.tour
    .map((stop) => ({
      ref: stop.itemId && buildingIds.has(stop.itemId) ? stop.itemId : stop.zoneId,
      narration: stop.narration,
      source: stop.source,
      checkpoint: stop.checkpoint
    }))
    .filter((stop) => stop.ref !== undefined);

  return SpaceDocumentSchema.parse({
    version: "0.2",
    meta: {
      name: scene.meta.name,
      sourceDir: scene.meta.sourceDir,
      language: scene.meta.language,
      createdAt: scene.meta.createdAt,
      coverage: []
    },
    city: { districts, buildings },
    flows,
    diagrams,
    interiors: [],
    navigation: {
      menu: [],
      searchIndex: buildings.map((b) => ({ label: b.title, kind: "building", ref: b.id, keywords: [] }))
    },
    tour
  });
}

/* ------------------------------ parsing ---------------------------- */

/**
 * Validate unknown input as a v0.2 Space. v0.1 documents are accepted and
 * upgraded (city-only) so old scenes and exports keep opening.
 */
export function parseSpace(input: unknown):
  | { success: true; data: TSpaceDocument; upgradedFrom?: "0.1" }
  | { success: false; error: z.ZodError } {
  const version =
    typeof input === "object" && input !== null && "version" in input
      ? (input as { version?: unknown }).version
      : undefined;
  if (version === "0.1") {
    const legacy = SceneDocument.safeParse(input);
    if (!legacy.success) return { success: false, error: legacy.error };
    try {
      return { success: true, data: upgradeSceneToSpace(legacy.data), upgradedFrom: "0.1" };
    } catch (error) {
      if (error instanceof z.ZodError) return { success: false, error };
      throw error;
    }
  }
  const parsed = SpaceDocumentSchema.safeParse(input);
  return parsed.success ? { success: true, data: parsed.data } : { success: false, error: parsed.error };
}

/** Prompt-facing contract note for v0.2 (kept short on purpose). */
export const SPACE_CONTRACT_NOTE = [
  "Output MUST be a single JSON object matching SpaceDocument v0.2 — JSON only, never code or prose.",
  "Buildings mirror analyzer modules exactly (moduleRef); never invent modules.",
  "Every summary/caption/narration is grounded via source.path, or the section is counted pending in meta.coverage.",
  "Use flows for replay, graph for components, sequence for ordered messages, and state diagrams for guarded transitions.",
  "Optional diagram claims explain identified nodes or edges with exact bounded code, docs or test spans; a decision must quote its documented rationale.",
  "Assessment questions use bounded choice, order, or target answers, exact source lines, and optional replay refs.",
  "Use flow-local step IDs for finite scenario traces; state values are display-only examples and never executable.",
  "icons only from the catalog enum, and presentation tokens (accents/panels/cameraShots) only from their enums.",
  "Positions and geometry are computed by the engine — never emit coordinates except optional district hints."
].join(" ");
