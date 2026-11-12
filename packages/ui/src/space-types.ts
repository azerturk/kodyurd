/**
 * Local types for the Knowledge City payload (`GET /api/projects/:id/space`).
 * Mirrors @kodyurd/scene-schema's SpaceDocument v0.2 + SpaceLayout, kept
 * deliberately permissive — the server already validated the document.
 */

export interface SpaceSource {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface SpaceDistrict {
  id: string;
  title: string;
  kind?: "domain" | "infrastructure" | "workshop";
}

export interface SpaceBuilding {
  id: string;
  moduleRef: string;
  title: string;
  district: string;
  metrics: { files: number; loc: number; docs: number };
  archetype?: "tower" | "slab" | "hall" | "low" | "landmark";
  accent?: string;
  summary: string;
  source?: SpaceSource;
}

export interface SpaceFlowPoint {
  id?: string;
  ref: string;
  caption?: string;
  actor?: string;
  detail?: string;
  state?: { key: string; value: string }[];
  source?: SpaceSource;
}

export interface SpaceFlowScenario {
  id: string;
  title: string;
  summary?: string;
  steps: string[];
  events?: { stepIndex: number; detail?: string; state?: SpaceFlowPoint["state"]; source: SpaceSource }[];
}

export interface SpaceFlow {
  id: string;
  title: string;
  scope: string;
  kind: "calls" | "data" | "next" | "depends";
  path: SpaceFlowPoint[];
  branches?: { id?: string; at: number; from?: string; join?: string; condition: string; path: SpaceFlowPoint[] }[];
  scenarios?: SpaceFlowScenario[];
  source?: SpaceSource;
}

export interface SpaceDiagramField {
  name: string;
  type: string;
  keys?: ("PK" | "FK" | "UK")[];
  note?: string;
  source?: SpaceSource;
}

export type SpaceCardinality = "1" | "0..1" | "1..*" | "0..*";

export interface SpaceDiagramNode {
  id: string;
  label: string;
  group?: string;
  icon?: string;
  hint?: string;
  fields?: SpaceDiagramField[];
  source?: SpaceSource;
}

export interface SpaceDiagramClaim {
  id: string;
  target: { kind: "node" | "edge"; id: string };
  kind: "responsibility" | "input" | "output" | "guard" | "invariant" | "decision" | "disagreement";
  text: string;
  evidence: { kind: "code" | "docs" | "test"; path: string; startLine: number; endLine: number; fingerprint?: string; stale?: boolean }[];
  replay?: { flow: string; scenario: string; step: string; stepIndex: number };
}

export interface SpaceDiagram {
  id: string;
  owner: string;
  title: string;
  kind: "graph" | "sequence" | "state" | "stack" | "timeline" | "matrix" | "erd" | "class" | "mindmap";
  nodes: SpaceDiagramNode[];
  edges: { id?: string; from: string; to: string; label?: string; kind?: string; guard?: string;
    cardinality?: { from: SpaceCardinality; to: SpaceCardinality }; source?: SpaceSource }[];
  note?: string;
  source?: SpaceSource;
  origin?: "docs" | "code" | "mermaid" | "user";
  claims?: SpaceDiagramClaim[];
}

export interface SpaceFloor {
  id: string;
  title: string;
  components: { label: string; icon?: string }[];
  diagrams: string[];
  corridors: string[];
  source?: SpaceSource;
}

export interface SpaceInterior {
  building: string;
  lobby: {
    summary: string;
    catalogRefs: string[];
    coverageRefs: number[];
  };
  floors: SpaceFloor[];
}

export interface SpaceCameraShot {
  id: string;
  target: string;
  angle: "front" | "three-quarter" | "high" | "low" | "orbit";
  kind: "inspect" | "tour" | "reveal";
}

export interface SpaceTourStop {
  ref: string;
  narration: string;
  source?: SpaceSource;
  checkpoint?: {
    question: string;
    options: { id: string; label: string; correct?: boolean }[];
    explanation?: string;
    source?: SpaceSource;
  };
  locate?: { prompt: string };
}

export interface SpaceCoverage {
  doc: string;
  sections: number;
  placed: number;
  pending: number;
}

export interface SpaceAssessmentQuestion {
  id: string;
  title?: string;
  kind: "choice" | "order" | "target";
  prompt: string;
  options: { id: string; label: string }[];
  answer: string[];
  explanation: string;
  source: SpaceSource;
  building?: string;
  replay?: { flow: string; scenario?: string; step?: string; stepIndex?: number };
}

export interface SpaceDoc {
  version: "0.2";
  meta: {
    name: string;
    sourceDir: string;
    language: string;
    createdAt: string;
    coverage: SpaceCoverage[];
  };
  city: { districts: SpaceDistrict[]; buildings: SpaceBuilding[] };
  flows: SpaceFlow[];
  diagrams: SpaceDiagram[];
  interiors: SpaceInterior[];
  presentation?: {
    start?: { building: string; flow?: string; diagram?: string };
    accentOverrides?: Record<string, string>;
    panelVariants?: Record<string, string>;
    cameraShots?: SpaceCameraShot[];
    tourPacing?: string;
  };
  navigation: {
    menu: { label: string; ref?: string; children?: unknown[] }[];
    searchIndex: { label: string; kind: string; ref: string; keywords?: string[]; sourcePath?: string }[];
  };
  tour: SpaceTourStop[];
  assessment?: { questions: SpaceAssessmentQuestion[] };
}

/* ------------------------------ layout ------------------------------ */

export interface LPoint {
  x: number;
  z: number;
}

export interface LRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface LBuilding {
  id: string;
  pos: LPoint;
  size: { w: number; d: number; h: number };
  rot: number;
  doorDir: LPoint;
}

export interface CityLayout {
  bounds: LRect;
  campus?: LRect;
  gate: { pos: LPoint; rot: number };
  plaza: { pos: LPoint; radius: number };
  districts: { id: string; rect: LRect; markerPos: LPoint }[];
  buildings: LBuilding[];
  roads: { points: LPoint[]; width: number }[];
  routes: { flowId: string; points: LPoint[]; routeNumber: number }[];
  props: { role: string; pos: LPoint; rot: number; scale?: number }[];
}

export interface DiagramLayout {
  id: string;
  width: number;
  height: number;
  nodes: { id: string; x: number; y: number; w: number; h: number }[];
  edges: { from: string; to: string; points: { x: number; y: number }[]; label?: string }[];
  lanes: { nodeId: string; x: number }[];
}

export interface LCorridor {
  flowId: string;
  segments: { from: LPoint; to: LPoint }[];
  stations: { pos: LPoint; stepIndex: number; caption?: string; branch?: string }[];
  forks: { pos: LPoint; condition: string }[];
  gates: { pos: LPoint; beforeForkIndex: number }[];
}

export interface LFloor {
  id: string;
  rect: LRect;
  pedestals: { label: string; icon?: string; pos: LPoint }[];
  panels: { diagramId: string; pos: LPoint; rot: number }[];
  infoStands: { pos: LPoint; rot: number }[];
  corridorDoors: { flowId: string; pos: LPoint }[];
}

export interface InteriorLayout {
  building: string;
  lobby: {
    rect: LRect;
    reception: LPoint;
    centerpiece: LPoint;
    catalogWall: { pos: LPoint; rot: number; width: number };
    coverageBoard: { pos: LPoint; rot: number };
    elevator: LPoint;
    entry: LPoint;
    plants: LPoint[];
    seating: LPoint[];
  };
  floors: LFloor[];
  corridors: LCorridor[];
}

export interface SpaceLayout {
  city: CityLayout;
  interiors: Record<string, InteriorLayout>;
  diagrams: Record<string, DiagramLayout>;
}

export interface SpaceOverlay {
  building: string;
  class: string;
  url: string;
}

export interface SpacePayload {
  space: SpaceDoc;
  layout: SpaceLayout;
}
