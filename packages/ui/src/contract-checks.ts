import type { TSpaceDocument } from "../../scene-schema/src/space";
import type { SpaceAssessmentQuestion, SpaceCameraShot, SpaceCardinality, SpaceDiagram } from "./space-types";

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Diagram = TSpaceDocument["diagrams"][number];

/** Type-only checks: a new contract token must also be handled by the shared live/export viewer. */
export type ViewerContractChecks = [
  Expect<Same<SpaceDiagram["kind"], Diagram["kind"]>>,
  Expect<Same<SpaceDiagram["origin"], Diagram["origin"]>>,
  Expect<Same<SpaceAssessmentQuestion["kind"], NonNullable<TSpaceDocument["assessment"]>["questions"][number]["kind"]>>,
  Expect<Same<SpaceCardinality, NonNullable<Diagram["edges"][number]["cardinality"]>["from"]>>,
  Expect<Same<SpaceCameraShot["angle"], NonNullable<TSpaceDocument["presentation"]>["cameraShots"][number]["angle"]>>,
  Expect<Same<SpaceCameraShot["kind"], NonNullable<TSpaceDocument["presentation"]>["cameraShots"][number]["kind"]>>
];
