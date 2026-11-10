/**
 * Deterministic layout output (P3). Produced server-side by the layouters from
 * a SpaceDocument; consumed by the viewer. NEVER produced by agents — agents
 * emit the SpaceDocument; geometry is code's responsibility (D5).
 *
 * Units: metres. Ground plane is XZ; y is up. rot is radians around Y.
 */

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

/* ------------------------------- city ------------------------------- */

export interface LBuilding {
  id: string;
  pos: LPoint;
  size: { w: number; d: number; h: number };
  rot: number;
  /** Which side the door faces, as a unit direction. */
  doorDir: LPoint;
}

export interface LRoad {
  points: LPoint[];
  width: number;
}

export interface LRoute {
  flowId: string;
  /** Polyline the traffic pulses travel along (gate/buildings via roads). */
  points: LPoint[];
  routeNumber: number;
}

export interface CityLayout {
  bounds: LRect;
  /** Connected pedestrian court for a compact focused city. Legacy layouts omit it. */
  campus?: LRect;
  gate: { pos: LPoint; rot: number };
  plaza: { pos: LPoint; radius: number };
  districts: { id: string; rect: LRect; markerPos: LPoint }[];
  buildings: LBuilding[];
  roads: LRoad[];
  routes: LRoute[];
  /** Street props chosen deterministically (trees, lamps, benches...). */
  props: { role: string; pos: LPoint; rot: number; scale?: number }[];
}

/* ----------------------------- diagrams ----------------------------- */

export interface LDiagramNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LDiagramEdge {
  from: string;
  to: string;
  points: { x: number; y: number }[];
  label?: string;
}

export interface DiagramLayout {
  id: string;
  width: number;
  height: number;
  nodes: LDiagramNode[];
  edges: LDiagramEdge[];
  /** Lane x-positions for sequence diagrams (lifelines), else empty. */
  lanes: { nodeId: string; x: number }[];
}

/* ----------------------------- interiors ---------------------------- */

export interface LStation {
  pos: LPoint;
  stepIndex: number;
  caption?: string;
  /** Set when this station belongs to a branch (condition text on its fork). */
  branch?: string;
}

export interface LCorridor {
  flowId: string;
  segments: { from: LPoint; to: LPoint }[];
  stations: LStation[];
  forks: { pos: LPoint; condition: string }[];
  /** Checkpoint gates stand BEFORE the fork they test (V5). */
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

/* ------------------------------- bundle ------------------------------ */

export interface SpaceLayout {
  city: CityLayout;
  interiors: Record<string, InteriorLayout>;
  diagrams: Record<string, DiagramLayout>;
}
