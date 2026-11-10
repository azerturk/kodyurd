import { Entity, type StandardMaterial } from "playcanvas";

type Part = (
  parent: Entity, shape: "box" | "sphere", width: number, height: number, depth: number,
  x: number, y: number, z: number, material: StandardMaterial, name?: string
) => Entity;

const thighLength = 0.39;
const shinLength = 0.37;
const rad = Math.PI / 180;

export function walkerPose(phase: number, weight: number, running: boolean, jumpPhase?: number) {
  const tuck = jumpPhase === undefined ? 0 : Math.sin(jumpPhase * Math.PI);
  const sides = [-1, 1].map((side) => {
    const stride = Math.sin(phase) * weight * side;
    const lift = Math.max(0, Math.cos(phase) * side) * weight;
    const hip = stride * (running ? 40 : 27) * (1 - tuck) - tuck * (side === -1 ? 23 : 14);
    const knee = lift * (running ? 42 : 32) * (1 - tuck) + tuck * (side === -1 ? 42 : 30);
    const ankle = -hip - knee + tuck * 15;
    const shoulder = -stride * (running ? 28 : 19) - tuck * 25;
    const elbow = (running ? 24 : 9) * weight + lift * 16 + tuck * 22;
    return { hip, knee, ankle, shoulder, elbow };
  });
  // Keep the longer leg on the ground as the other leg folds into a step.
  const extension = Math.max(...sides.map(({ hip, knee }) =>
    thighLength * Math.cos(hip * rad) + shinLength * Math.cos((hip + knee) * rad)
  ));
  return { sides, offset: jumpPhase === undefined ? extension - thighLength - shinLength : 0 };
}

export function buildProceduralAvatar(visual: Entity, part: Part, material: (color: string) => StandardMaterial) {
  const cloth = material("#327e7b");
  const seam = material("#285b60");
  const trousers = material("#3e4a54");
  const skin = material("#d7ab86");
  const hair = material("#353633");
  const bag = material("#394550");
  const trim = material("#5a6b70");
  const sole = material("#222e34");
  const joint = (parent: Entity, name: string, x: number, y: number): Entity => {
    const node = new Entity(name);
    node.setLocalPosition(x, y, 0);
    parent.addChild(node);
    return node;
  };

  part(visual, "sphere", 0.36, 0.31, 0.25, 0, 0.95, 0, trousers, "hips");
  part(visual, "sphere", 0.50, 0.56, 0.31, 0, 1.20, 0, cloth, "jacket");
  part(visual, "sphere", 0.35, 0.20, 0.27, 0, 0.98, 0, seam, "jacket-hem");
  part(visual, "sphere", 0.20, 0.18, 0.21, 0, 1.45, 0, seam, "collar");
  part(visual, "sphere", 0.28, 0.315, 0.27, 0, 1.61, 0.018, skin, "head");
  part(visual, "sphere", 0.302, 0.20, 0.274, 0, 1.682, -0.023, hair, "hair");
  part(visual, "sphere", 0.262, 0.19, 0.20, 0, 1.609, -0.060, hair, "hair-back");
  part(visual, "sphere", 0.082, 0.088, 0.079, 0, 1.605, 0.154, skin, "nose");
  part(visual, "sphere", 0.421, 0.515, 0.236, 0, 1.205, -0.211, bag, "backpack");
  part(visual, "sphere", 0.367, 0.223, 0.142, 0, 1.106, -0.293, trim, "backpack-pocket");
  part(visual, "box", 0.183, 0.020, 0.012, 0, 1.148, -0.361, sole, "backpack-zip");

  const limbs = [-1, 1].map((side) => {
    part(visual, "sphere", 0.054, 0.090, 0.063, side * 0.137, 1.593, 0.026, skin, "ear");
    part(visual, "sphere", 0.027, 0.024, 0.022, side * 0.053, 1.643, 0.142, hair, "eye");
    const strap = part(visual, "box", 0.055, 0.36, 0.034, side * 0.129, 1.263, 0.138, trim, "backpack-strap");
    strap.setLocalEulerAngles(-8, 0, side * -9);
    const shoulder = joint(visual, "shoulder", side * 0.228, 1.365);
    part(shoulder, "sphere", 0.151, 0.330, 0.165, side * 0.021, -0.114, 0, cloth, "upper-sleeve");
    const elbow = joint(shoulder, "elbow", side * 0.023, -0.249);
    part(elbow, "sphere", 0.134, 0.286, 0.145, 0, -0.11, 0, cloth, "forearm-sleeve");
    part(elbow, "sphere", 0.103, 0.141, 0.111, 0, -0.248, 0, skin, "hand");
    const hip = joint(visual, "hip", side * 0.115, 0.833);
    part(hip, "sphere", 0.211, 0.468, 0.220, 0, -0.18, 0, trousers, "upper-leg");
    const knee = joint(hip, "knee", 0, -thighLength);
    part(knee, "sphere", 0.162, 0.408, 0.181, 0, -0.171, 0, trousers, "lower-leg");
    const ankle = joint(knee, "ankle", 0, -shinLength);
    part(ankle, "sphere", 0.171, 0.119, 0.292, 0, -0.013, 0.043, seam, "shoe");
    part(ankle, "box", 0.156, 0.028, 0.234, 0, -0.056, 0.044, sole, "sole");
    return { shoulder, elbow, hip, knee, ankle };
  });

  return (phase: number, weight: number, running: boolean, jumpPhase?: number): void => {
    const pose = walkerPose(phase, weight, running, jumpPhase);
    for (const [index, limb] of limbs.entries()) {
      const { hip, knee, ankle, shoulder, elbow } = pose.sides[index];
      limb.hip.setLocalEulerAngles(hip, 0, 0);
      limb.knee.setLocalEulerAngles(knee, 0, 0);
      limb.ankle.setLocalEulerAngles(ankle, 0, 0);
      limb.shoulder.setLocalEulerAngles(shoulder, 0, index === 0 ? -6 : 6);
      limb.elbow.setLocalEulerAngles(-elbow, 0, 0);
    }
    visual.setLocalPosition(0, pose.offset, 0);
  };
}
