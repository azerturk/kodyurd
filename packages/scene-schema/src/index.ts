import { z } from "zod";

/**
 * Scene JSON v0.1 — the contract between the agent and the engine.
 *
 * Rules:
 * - Agents NEVER write engine code. They emit a SceneDocument; the PlayCanvas
 *   viewer interprets it deterministically.
 * - Nothing is invented: every readable text (summary, narration) must carry a
 *   `source` reference to a real file, or the item is marked `pending: true`.
 * - The vocabulary is explanatory on purpose: flows, flowcharts, stacks and
 *   timelines let the agent SHOW structure, not just label boxes.
 */

export const Vec2 = z.object({
  x: z.number(),
  z: z.number()
});
export type TVec2 = z.infer<typeof Vec2>;

export const SourceRef = z.object({
  /** Path relative to the project's sourceDir. */
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional()
});
export type TSourceRef = z.infer<typeof SourceRef>;

/** One step of a flowchart/timeline item. */
export const DiagramStep = z.object({
  label: z.string().min(1).max(60),
  detail: z.string().max(200).optional()
});
export type TDiagramStep = z.infer<typeof DiagramStep>;

/** One layer of a stack item (bottom-up). */
export const DiagramLayer = z.object({
  label: z.string().min(1).max(60),
  detail: z.string().max(200).optional()
});
export type TDiagramLayer = z.infer<typeof DiagramLayer>;

export const SceneItem = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "building",
      "panel",
      "plaque",
      "pedestal",
      "door",
      "sign",
      "flowchart",
      "stack",
      "timeline"
    ]),
    title: z.string().min(1),
    /** Agent-written explanation. Must be grounded in `source`; otherwise set `pending`. */
    summary: z.string().optional(),
    source: SourceRef.optional(),
    /** True when no grounded source was found. The engine renders a visible "pending" state. */
    pending: z.boolean().optional(),
    /** Optional sculpt brief for a unique 3D model of this item (used when the project opts into sculpted models). */
    model: z.object({ prompt: z.string().min(8).max(400) }).optional(),
    /** Filled by the server after model generation; the viewer loads this GLB in place of built-in geometry. */
    modelUrl: z.string().optional(),
    position: Vec2,
    /** Buildings only: visual height (e.g. scaled from file count / LOC). */
    height: z.number().positive().optional(),
    /** flowchart/timeline only: the ordered steps the diagram shows. */
    steps: z.array(DiagramStep).min(2).max(8).optional(),
    /** stack only: the layers, bottom-up (e.g. DB → services → API → UI). */
    layers: z.array(DiagramLayer).min(2).max(7).optional(),
    metrics: z
      .object({
        files: z.number().int().nonnegative().optional(),
        loc: z.number().int().nonnegative().optional()
      })
      .optional(),
    /** Doors only: the zone this door leads to. */
    target: z.string().optional()
  })
  .superRefine((item, ctx) => {
    if ((item.kind === "flowchart" || item.kind === "timeline") && !item.steps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: `${item.kind} items require "steps" (2-8 entries)`
      });
    }
    if (item.kind === "stack" && !item.layers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layers"],
        message: `stack items require "layers" (2-7 entries, bottom-up)`
      });
    }
  });
export type TSceneItem = z.infer<typeof SceneItem>;

export const Zone = z.object({
  id: z.string().min(1),
  kind: z.enum(["hall", "district", "bridge", "library", "gallery", "custom"]),
  title: z.string().min(1),
  position: Vec2,
  size: z.object({ w: z.number().positive(), d: z.number().positive() }),
  items: z.array(SceneItem)
});
export type TZone = z.infer<typeof Zone>;

/**
 * A directed relation between two items, rendered as a glowing arc with a
 * moving pulse. This is how a scene EXPLAINS: request paths, data movement,
 * order of steps, dependencies.
 */
export const Flow = z.object({
  id: z.string().min(1).max(64).optional(),
  /** Item id the flow starts at. */
  from: z.string().min(1),
  /** Item id the flow ends at (arrowhead + pulse direction). */
  to: z.string().min(1),
  label: z.string().max(48).optional(),
  kind: z.enum(["calls", "data", "next", "depends"]).default("calls")
});
export type TFlow = z.infer<typeof Flow>;

export const CheckpointOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  correct: z.boolean().optional()
});
export type TCheckpointOption = z.infer<typeof CheckpointOption>;

/** A small knowledge check at a tour stop. Exactly one option is correct. */
export const Checkpoint = z
  .object({
    question: z.string().min(1),
    options: z.array(CheckpointOption).min(2).max(4),
    explanation: z.string().optional(),
    source: SourceRef.optional()
  })
  .refine((c) => c.options.filter((o) => o.correct).length === 1, {
    message: "exactly one option must have correct: true"
  });
export type TCheckpoint = z.infer<typeof Checkpoint>;

export const TourStop = z.object({
  zoneId: z.string(),
  itemId: z.string().optional(),
  /** What the guide says at this stop. Grounded like any summary. */
  narration: z.string(),
  source: SourceRef.optional(),
  /** Optional knowledge check; the walker answers before moving on. */
  checkpoint: Checkpoint.optional()
});
export type TTourStop = z.infer<typeof TourStop>;

export const SceneDocument = z
  .object({
    version: z.literal("0.1"),
    meta: z.object({
      name: z.string().min(1),
      sceneType: z.enum(["codewalk", "showroom", "exhibition", "training"]),
      sourceDir: z.string().min(1),
      /** Language of narration/panel text (UI itself is English). */
      language: z.string().default("en"),
      createdAt: z.string()
    }),
    zones: z.array(Zone).min(1),
    /** Directed relations between items (by item id), rendered as glowing arcs. */
    flows: z.array(Flow).max(40).default([]),
    /** Ordered guided-tour stops. Empty = free walk only. */
    tour: z.array(TourStop).default([])
  })
  .superRefine((doc, ctx) => {
    const itemIds = new Set<string>();
    for (const zone of doc.zones) {
      for (const item of zone.items) itemIds.add(item.id);
    }
    doc.flows.forEach((flow, i) => {
      if (!itemIds.has(flow.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flows", i, "from"],
          message: `flow "from" must be an existing item id (got ${JSON.stringify(flow.from)})`
        });
      }
      if (!itemIds.has(flow.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flows", i, "to"],
          message: `flow "to" must be an existing item id (got ${JSON.stringify(flow.to)})`
        });
      }
      if (flow.from === flow.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flows", i],
          message: "a flow must connect two different items"
        });
      }
    });
  });
export type TSceneDocument = z.infer<typeof SceneDocument>;

/** Validate unknown input (e.g. agent output) against the Scene JSON contract. */
export function parseScene(input: unknown) {
  return SceneDocument.safeParse(input);
}

/* Scene JSON v0.2 — "Space" (knowledge city). Additive: v0.1 stays valid. */
export * from "./space.js";
/* Deterministic P3 layout output types (never agent-authored). */
export * from "./layout-types.js";

/** JSON Schema-ish description for prompting agents (kept minimal on purpose). */
export const SCENE_CONTRACT_NOTE = [
  "Output MUST be a single JSON object matching SceneDocument v0.1.",
  "Do not output engine code, markdown or prose — JSON only.",
  "Every summary/narration must reference a real file via source.path;",
  "if you cannot ground a text in a file, set pending: true and leave summary out.",
  "Use flows and flowchart/stack/timeline items to SHOW structure, not just label it."
].join(" ");
