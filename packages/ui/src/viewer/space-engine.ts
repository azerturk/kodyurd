import * as pc from "playcanvas";
import type {
  CityLayout,
  InteriorLayout,
  SpaceBuilding,
  SpaceDiagram,
  SpaceDiagramField,
  SpaceFlow,
  SpaceOverlay,
  SpacePayload,
  SpaceSource
} from "../space-types";
import { buildFlowReplay, selectReplayCursor, type ReplayTrace } from "./flow-replay";
import { cityRelationships, type CityRelationship } from "./city-relations";
import { diagramTitle } from "./diagram-explanation";
import { overviewLinkRoute, visibleOverviewLinks } from "./overview-links";
import { renderIconGlyph, renderSpatialGraph, renderSpatialSequence, spatialDiagram, spatialSequence, type SpatialEdge, type SpatialNode, type SpatialView } from "./spatial-graph";
import { fitDisplayCopy, signFaceMount, workshopExhibits, wrapDisplayCopy } from "./exhibit-layout";
import { buildProceduralAvatar } from "./procedural-avatar";
import { hasGlbDocument, isUnavailableModel, openingModelsState, type OpeningModelsState } from "./model-readiness";
import { advanceVelocity, avatarVisibleAt, clearBoom, clearSurface, followBoom, groundedClipRate, intersectsWalker, streetExhibitSite, streetExhibitYaw, streetExitPoint, STREET_EXHIBIT_SIZE, walkGait, walkMove, walkPath, type WalkPoint, type WalkSolid } from "./walk-path";
import { distanceToSegment, fitClearArrivalView, fitOrthographic, labelPosition, placeWorldLabel, viewRect, type Position3, type ViewInsets, type ViewRect } from "./view-projection";

/**
 * Knowledge City renderer (Scene JSON v0.2 + SpaceLayout) — PlayCanvas 2.22.6.
 *
 * Day theme, third-person character, building interiors, animated engineering
 * diagram panels, flow traffic on roads, walkable corridors with forks and
 * gates. Deterministic interpreter: agents never touch this code (D5).
 *
 * One owner for the app, the update loop, resize and disposal — see
 * docs/skills/playcanvas.md.
 */

export interface SpaceFocus {
  kind:
    | "building"
    | "door-enter"
    | "door-exit"
    | "directory"
    | "elevator"
    | "gate"
    | "station"
    | "pedestal"
    | "panel"
    | "node"
    | "edge"
    | "marker"
    | "centerpiece";
  ref: string;
  title: string;
  summary?: string;
  sourcePath?: string;
  source?: SpaceSource;
  hint?: string;
}

export interface SpaceLabel {
  id: string;
  text: string;
  xPct: number;
  yPct: number;
  minor: boolean;
  ref?: string;
  active?: boolean;
  badge?: boolean;
  lines?: string[];
  widthPx?: number;
}

export interface DiagramPlayback {
  diagramId: string;
  title: string;
  playing: boolean;
  step: number;
  steps: number;
  spatial?: boolean;
  topDown?: boolean;
  kind?: SpaceDiagram["kind"];
  owner?: string;
  caption?: string;
  source?: SpaceSource;
}

export interface ReplaySelection {
  scenarioId?: string;
  stepId?: string;
  stepIndex?: number;
}

export interface FlowPlayback {
  flowId: string;
  title: string;
  scenarioId: string;
  scenarios: { id: string; title: string; summary?: string }[];
  summary?: string;
  playing: boolean;
  step: number;
  stepId?: string;
  steps: number;
  timeline: { caption: string; actor?: string }[];
  caption?: string;
  actor?: string;
  detail?: string;
  state?: { key: string; value: string }[];
  source?: SpaceSource;
  finished: boolean;
}

export type { OpeningModelsState } from "./model-readiness";

export interface SpaceCallbacks {
  onFocus(focus: SpaceFocus | null): void;
  onLabels(labels: SpaceLabel[]): void;
  onLock(locked: boolean): void;
  onPlayer(pos: { x: number; z: number; world: string }): void;
  onMode(mode: "city" | "interior", buildingId?: string): void;
  onInteriorLocation?(location: "lobby" | "floor" | "corridor" | null): void;
  onOpenDirectory?(tab: "diagrams" | "flows" | "docs" | "learn"): void;
  onInspect(playback: DiagramPlayback | null): void;
  onReplay?(replay: FlowPlayback | null): void;
  onOverview?(active: boolean): void;
  onElevator(buildingId: string, floors: { id: string; title: string }[]): void;
  onAutoArrive?(ref: string): void;
  onAutoCancel?(ref: string): void;
  onOpeningModels?(state: OpeningModelsState): void;
}

/** The bundled model pack, resolved by the viewer shell (manifest-driven). */
export interface PackAssets {
  has(role: string): boolean;
  urlFor(role: string): string;
  calibrationFor?(role: string): { yaw?: number };
}

export interface SpaceHandle {
  dispose(): void;
  /** Teleport/enter to any resolvable ref (building, district, floor key, flow, diagram). */
  focusRef(ref: string): void;
  clearTourFocus(): void;
  exitInterior(): void;
  enterBuilding(buildingId: string): void;
  gotoLobby(): void;
  gotoFloor(buildingId: string, floorId: string): void;
  overview: {
    open(): void;
    fit(): void;
    focus(buildingId: string): void;
    close(): void;
  };
  inspect: {
    open(buildingId: string): void;
    close(): void;
    play(): void;
    pause(): void;
    step(dir: 1 | -1): void;
    fit(): void;
    bookmark(): { yaw: number; zoom: number; topDown?: boolean } | undefined;
    restoreBookmark(view: { yaw: number; zoom: number; topDown?: boolean }): void;
    setTopView(active: boolean): void;
  };
  replay: {
    open(flowId: string, selection?: ReplaySelection): boolean;
    select(scenarioId: string): void;
    play(): void;
    pause(): void;
    step(dir: 1 | -1): void;
    seek(stepIndex: number): void;
    restart(): void;
    close(): void;
  };
  setInputBlocked(blocked: boolean): void;
  setReducedMotion(reduced: boolean): void;
  setViewInsets(insets: ViewInsets): void;
  motionSnapshot(): WalkDiagnostics;
  /** Press-E action for the current focus (also bound to the E key). */
  activate(): void;
  /** True when the player stands within `radius` metres of the ref's anchor (locate quests). */
  isNear(ref: string, radius?: number): boolean;
  /** Autopilot: walk the character to the ref's anchor (true) or teleport via focusRef (false). */
  walkTo(ref: string, reportCancellation?: boolean): boolean;
  stopAuto(): void;
  /** Glowing trail of dots from the walker toward this ref (null clears it). */
  setTrail(ref: string | null): void;
}

export interface WalkDiagnostics {
  world: string;
  inputBlocked: boolean;
  displacement: number;
  requestedSpeed: number;
  speed: number;
  animation: "idle" | "walk" | "run" | "jump";
  contact: "wall" | "surface" | null;
  collider?: string;
  cameraDistance: number;
  cameraLimited: boolean;
}

interface Interactable {
  world: string;
  x: number;
  z: number;
  radius: number;
  focus: SpaceFocus;
  action?: () => void;
  entity?: pc.Entity;
}

interface LabelPoint {
  world: string;
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  range2: number;
  minor: boolean;
  ref?: string;
  badge?: boolean;
}

function entrancePoint(building: CityLayout["buildings"][number], offset = 0): WalkPoint {
  const { pos, size, doorDir } = building;
  return {
    x: pos.x + doorDir.x * (size.w / 2 + offset),
    z: pos.z + doorDir.z * (size.d / 2 + offset)
  };
}

const DAY = {
  sky: "#b7d9e7",
  ground: "#c3ccb6",
  district: ["#d3d8c4", "#d9d6c2", "#cbd6cb", "#d9d3bd", "#ccd1cb"],
  road: "#8b9293",
  roadStripe: "#e4ecef",
  facade: ["#e2d7c4", "#d7d6ce", "#d9cbb7", "#d3d8ce"],
  roof: "#9aa3a8",
  door: "#2f8d84",
  trunk: "#8a6f52",
  leaf: "#7fae6e",
  leafDark: "#669459",
  teal: "#2f8d84",
  amber: "#d9a13f",
  metal: "#aab3ba",
  wall: "#e6d8c5",
  floor: "#ddd0be"
} as const;

const ACCENT_HEX: Record<string, string> = {
  teal: "#2f8d84",
  amber: "#d9a13f",
  violet: "#8a7bc8",
  green: "#6fae5e",
  rose: "#c87b8a"
};

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSpaceViewer(
  canvas: HTMLCanvasElement,
  payload: SpacePayload,
  cb: SpaceCallbacks,
  assets?: PackAssets,
  overlays?: SpaceOverlay[]
): SpaceHandle {
  const { space, layout } = payload;

  const app = new pc.Application(canvas, {
    keyboard: new pc.Keyboard(window),
    mouse: new pc.Mouse(canvas)
  });
  const textMeasure = document.createElement("canvas").getContext("2d")!;
  const labelMetrics = new Map<string, { lines: string[]; width: number; height: number }>();
  const stageLabelMetrics = (label: SpaceLabel, availableWidth: number) => {
    const maxWidth = label.badge ? 30 : Math.max(36, Math.min(208, Math.floor(availableWidth * 0.63)));
    const key = `${maxWidth}|${label.minor}|${label.text}`;
    const cached = labelMetrics.get(key);
    if (cached) return cached;
    textMeasure.font = label.minor ? "650 12px system-ui, sans-serif" : "700 13px system-ui, sans-serif";
    const padding = label.badge ? 8 : 18;
    const lines = wrapDisplayCopy(label.text, maxWidth - padding, (text) => textMeasure.measureText(text).width);
    const measuredWidth = Math.max(0, ...lines.map((line) => textMeasure.measureText(line).width));
    const metrics = { lines, width: Math.min(maxWidth, Math.ceil(measuredWidth) + padding), height: 16 * Math.max(1, lines.length) + 10 };
    if (labelMetrics.size >= 400) labelMetrics.clear();
    labelMetrics.set(key, metrics);
    return metrics;
  };
  app.setCanvasFillMode(pc.FILLMODE_NONE);
  app.graphicsDevice.maxPixelRatio = Math.min(2, window.devicePixelRatio || 1);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.scene.ambientLight = new pc.Color().fromString("#9fb4bd");

  try {
    const fog = (
      app.scene as unknown as {
        fog?: { type?: string; start?: number; end?: number; color?: pc.Color };
      }
    ).fog;
    if (fog && typeof fog === "object") {
      fog.type = pc.FOG_LINEAR;
      fog.start = 90;
      fog.end = 420;
      if (fog.color) fog.color.fromString(DAY.sky);
    }
  } catch {
    /* no fog — fine */
  }

  // --- materials ------------------------------------------------------------
  let disposed = false;
  type Finish = "limestone" | "glazing" | "window-band";
  const materials = new Map<string, pc.StandardMaterial>();
  const materialFor = (hex: string, emissive?: string, intensity = 0.4, finish?: Finish): pc.StandardMaterial => {
    const key = `${hex}|${emissive ?? ""}|${intensity}|${finish ?? ""}`;
    let m = materials.get(key);
    if (!m) {
      m = new pc.StandardMaterial();
      m.diffuse.fromString(hex);
      if (emissive) {
        m.emissive.fromString(emissive);
        m.emissiveIntensity = intensity;
      }
      if (finish === "limestone") {
        m.diffuseMap = finishTexture(finish);
        m.gloss = 0.24;
      }
      if (finish === "glazing" || finish === "window-band") {
        m.emissiveMap = finishTexture(finish);
        m.gloss = 0.63;
      }
      m.update();
      materials.set(key, m);
    }
    return m;
  };

  const part = (
    parent: pc.Entity,
    type: "box" | "sphere" | "cone" | "cylinder" | "plane",
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    material: pc.StandardMaterial,
    name = "part"
  ): pc.Entity => {
    const e = new pc.Entity(name);
    e.addComponent("render", { type });
    e.render!.material = material;
    e.setLocalScale(sx, sy, sz);
    e.setLocalPosition(x, y, z);
    parent.addChild(e);
    return e;
  };

  // --- canvas-texture screens -------------------------------------------------
  interface Screen {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: pc.Texture;
    material: pc.StandardMaterial;
  }
  const screens: Screen[] = [];
  const makeScreen = (w: number, h: number, viewedAtAngle = false, registry = screens): Screen => {
    const scale = Math.min(1, Math.min(2048, app.graphicsDevice.maxTextureSize) / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const texture = new pc.Texture(app.graphicsDevice, {
      width: w,
      height: h,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: viewedAtAngle
    });
    texture.minFilter = viewedAtAngle ? pc.FILTER_LINEAR_MIPMAP_LINEAR : pc.FILTER_LINEAR;
    texture.magFilter = pc.FILTER_LINEAR;
    if (viewedAtAngle) texture.anisotropy = Math.min(4, app.graphicsDevice.maxAnisotropy);
    texture.setSource(c);
    const material = new pc.StandardMaterial();
    material.diffuse.fromString("#000000");
    material.emissive.fromString("#ffffff");
    material.emissiveIntensity = 1;
    material.emissiveMap = texture;
    material.update();
    const screen: Screen = { canvas: c, ctx, texture, material };
    registry.push(screen);
    return screen;
  };
  const uploadScreen = (s: Screen): void => {
    s.texture.setSource(s.canvas);
  };
  const finishTextures = new Map<Finish, pc.Texture>();
  function finishTexture(finish: Finish): pc.Texture {
    const cached = finishTextures.get(finish);
    if (cached) return cached;
    const s = makeScreen(finish === "window-band" ? 256 : 64, 128, true);
    const { ctx, canvas } = s;
    const { width, height } = canvas;
    if (finish === "limestone") {
      // Broad, low-contrast variation rather than high-frequency surface noise.
      const pixels = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const u = Math.PI * 2 * x / width;
        const v = Math.PI * 2 * y / height;
        const shade = 244 + Math.cos(u * 2 + v) * 3 + Math.sin(v * 3 + Math.sin(u)) * 4 + Math.cos(v - u) * 3;
        const i = (x + y * width) * 4;
        pixels.data[i] = shade;
        pixels.data[i + 1] = shade;
        pixels.data[i + 2] = shade;
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
    } else {
      // A soft sky reflection with a dim sill, shared by opaque window panes.
      const sky = ctx.createLinearGradient(0, 0, width * 0.24, height);
      sky.addColorStop(0, "#f8ffff");
      sky.addColorStop(0.29, "#c9e3e7");
      sky.addColorStop(0.56, "#789ba5");
      sky.addColorStop(0.86, "#435c67");
      sky.addColorStop(1, "#677f83");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      if (finish === "window-band") {
        const bay = width / 5;
        for (let i = 0; i <= 5; i++) {
          ctx.fillStyle = "#31454a";
          ctx.fillRect(i * bay - 3, 0, 6, height);
          ctx.fillStyle = "#9db4b6";
          ctx.fillRect(i * bay + 3, 0, 2, height);
        }
        ctx.fillStyle = "#61757a";
        ctx.fillRect(0, 0, width, 5);
        ctx.fillRect(0, height - 8, width, 8);
      }
    }
    uploadScreen(s);
    finishTextures.set(finish, s.texture);
    return s.texture;
  }
  const addSignFace = (parent: pc.Entity, width: number, height: number, y: number, backingZ: number,
    backingDepth: number, side: -1 | 1, face: Screen, name: string): void => {
    const { z, yaw } = signFaceMount(backingZ, backingDepth, side);
    const panel = part(parent, "plane", width, 1, height, 0, y, z, face.material, name);
    panel.setLocalEulerAngles(90, yaw, 0);
  };

  // --- bundled pack models (role → GLB), procedural parts as fallback ----------
  const unionAabb = (root: pc.Entity): pc.BoundingBox | null => {
    let box: pc.BoundingBox | null = null;
    const renders = root.findComponents("render") as unknown as pc.RenderComponent[];
    for (const r of renders) {
      for (const mi of r.meshInstances ?? []) {
        if (!box) box = new pc.BoundingBox(mi.aabb.center.clone(), mi.aabb.halfExtents.clone());
        else box.add(mi.aabb);
      }
    }
    return box;
  };

  type ModelResult = { status: "loaded"; asset: pc.Asset } | { status: "unavailable" | "failed" };
  type ContainerModel = {
    key: string;
    url: string;
    result?: ModelResult;
    cancel?: () => void;
    listeners: Set<(result: ModelResult) => void>;
  };
  type ModelMount = { container: ContainerModel; parent: pc.Entity; size: number; avatar: boolean; failed: boolean };
  const containerAssetCache = new Map<string, ContainerModel>();
  const pendingMounts = new Set<ModelMount>();
  const queuedAnimationClips = new Set<ContainerModel>();
  let activeModelLoads = 0;
  const containerAsset = (key: string, url: string): ContainerModel => {
    const existing = containerAssetCache.get(key);
    if (existing) return existing;
    const container: ContainerModel = { key, url, listeners: new Set() };
    containerAssetCache.set(key, container);
    return container;
  };
  const packAsset = (role: string): ContainerModel => containerAsset(`pack:${role}`, assets!.urlFor(role));

  const loadContainer = (container: ContainerModel): void => {
    if (container.result || container.cancel || disposed) return;
    const controller = new AbortController();
    activeModelLoads++;
    const finish = (result: ModelResult): void => {
      if (!container.cancel) return;
      window.clearTimeout(timeout);
      container.cancel = undefined;
      activeModelLoads--;
      if (disposed) return;
      container.result = result;
      for (const listener of container.listeners) listener(result);
      container.listeners.clear();
    };
    const cancel = (): void => {
      controller.abort();
      finish({ status: "failed" });
    };
    const timeout = window.setTimeout(cancel, 10_000);
    container.cancel = cancel;
    // Pass the fetched bytes into the pinned GLB loader. The original URL still
    // anchors relative resources and normal HTTP caching remains in effect.
    void fetch(container.url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) {
        finish({ status: isUnavailableModel(response.status) ? "unavailable" : "failed" });
        return;
      }
      const bytes = await response.arrayBuffer();
      if (disposed || !container.cancel) return;
      if (!hasGlbDocument(bytes)) {
        finish({ status: "unavailable" });
        return;
      }
      const asset = new pc.Asset(container.key, "container", { url: container.url, contents: bytes });
      const complete = (result: ModelResult): void => {
        const file = asset.file as { contents?: ArrayBuffer | null } | null;
        if (file) file.contents = null;
        finish(result);
      };
      asset.once("load", () => complete({ status: "loaded", asset }));
      asset.once("error", (error: unknown) => complete({ status: isUnavailableModel(error) ? "unavailable" : "failed" }));
      app.assets.add(asset);
      app.assets.load(asset);
    }).catch(() => finish({ status: "failed" }));
  };

  const observeContainer = (container: ContainerModel, parent: pc.Entity, listener: (result: ModelResult) => void): void => {
    if (container.result) listener(container.result);
    else {
      container.listeners.add(listener);
      parent.once("destroy", () => container.listeners.delete(listener));
    }
  };

  const prepareMount = (container: ContainerModel, parent: pc.Entity, size: number, hide: pc.Entity[], avatar = false) => {
    for (const part of hide) part.enabled = false;
    const mount: ModelMount = { container, parent, size, avatar, failed: false };
    pendingMounts.add(mount);
    parent.once("destroy", () => pendingMounts.delete(mount));
    return (status: "ready" | "unavailable" | "failed"): void => {
      if (disposed || !parent.parent) return;
      if (status === "failed") {
        mount.failed = true;
        return;
      }
      if (status === "unavailable") for (const part of hide) part.enabled = true;
      pendingMounts.delete(mount);
    };
  };

  /**
   * Mount a pack model under `parent`: auto-scale from real bounds to
   * `target` metres and seat its bottom at `mountY` before showing the mesh.
   * Procedural parts reappear only for an unavailable model.
   */
  const mountContainer = (
    container: ContainerModel, parent: pc.Entity, target: number, mountY: number, hide: pc.Entity[],
    calibration?: { yaw?: number; chooseYaw?: (w: number, d: number) => number;
      fit?: { w: number; h: number; d: number }; onFit?: (size: { w: number; h: number; d: number }) => void;
      onUnavailable?: () => void },
    avatar = false
  ): void => {
    const settle = prepareMount(container, parent, target, hide, avatar);
    const finish = (status: Parameters<typeof settle>[0]): void => {
      settle(status);
      if (status === "unavailable") calibration?.onUnavailable?.();
    };
    observeContainer(container, parent, (result) => {
      if (disposed || !parent.parent) return;
      if (result.status !== "loaded") return finish(result.status);
      let mounted: pc.Entity | undefined;
      try {
        const resource = result.asset.resource as { instantiateRenderEntity?: () => pc.Entity } | null;
        if (!resource?.instantiateRenderEntity) return finish("unavailable");
        const model = mounted = resource.instantiateRenderEntity();
        if (Number.isFinite(calibration?.yaw)) model.setLocalEulerAngles(0, calibration!.yaw!, 0);
        model.setLocalPosition(0, mountY, 0);
        const pendingMeshes = model.findComponents("render")
          .flatMap((render) => (render as pc.RenderComponent).meshInstances ?? []).filter((mesh) => mesh.visible);
        for (const mesh of pendingMeshes) mesh.visible = false;
        parent.addChild(model);
        const invalid = (): void => {
          model.destroy();
          finish("unavailable");
        };
        const afterUpdate = (step: () => void): void => {
          app.once("update", () => {
            if (disposed || !model.parent) return;
            try {
              step();
            } catch {
              model.destroy();
              finish("failed");
            }
          });
        };
        const fitAndSeat = (aabb: pc.BoundingBox | null): void => {
          if (!aabb || !pendingMeshes.length) return invalid();
          const maxDim = Math.max(aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z) * 2;
          if (!Number.isFinite(maxDim) || maxDim <= 0.0001) return invalid();
          const fit = calibration?.fit;
          const s = fit ? Math.min(
            fit.w / Math.max(0.001, aabb.halfExtents.x * 2),
            fit.h / Math.max(0.001, aabb.halfExtents.y * 2),
            fit.d / Math.max(0.001, aabb.halfExtents.z * 2)
          ) : target / maxDim;
          model.setLocalScale(s, s, s);
          afterUpdate(() => {
            const after = unionAabb(model);
            if (!after) return invalid();
            const bottom = after.center.y - after.halfExtents.y;
            const lp = model.getLocalPosition();
            const anchor = parent.getPosition();
            const correction = new pc.Mat4().copy(parent.getWorldTransform()).invert().transformVector(new pc.Vec3(
              anchor.x - after.center.x, anchor.y + mountY - bottom, anchor.z - after.center.z
            ));
            model.setLocalPosition(lp.x + correction.x, lp.y + correction.y, lp.z + correction.z);
            calibration?.onFit?.({ w: after.halfExtents.x * 2, h: after.halfExtents.y * 2, d: after.halfExtents.z * 2 });
            for (const mesh of pendingMeshes) mesh.visible = true;
            finish("ready");
          });
        };
        afterUpdate(() => {
          const aabb = unionAabb(model);
          if (!aabb || !calibration?.chooseYaw) return fitAndSeat(aabb);
          const { x, z } = aabb.halfExtents;
          model.setLocalEulerAngles(0, calibration.chooseYaw(x * 2, z * 2), 0);
          afterUpdate(() => fitAndSeat(unionAabb(model)));
        });
      } catch {
        mounted?.destroy();
        finish("failed");
      }
    });
  };
  const mountPack = (
    parent: pc.Entity, role: string, target: number, mountY: number, hide: pc.Entity[],
    fit?: { w: number; h: number; d: number }, onFit?: (size: { w: number; h: number; d: number }) => void
  ): void => {
    if (!assets?.has(role)) return;
    mountContainer(packAsset(role), parent, target, mountY, hide, { ...assets.calibrationFor?.(role), fit, onFit });
  };
  /** Personal overlay GLBs resolve by url (server route or bundle-relative). */
  const mountUrl = (parent: pc.Entity, url: string, target: number, mountY: number, hide: pc.Entity[]): void => {
    mountContainer(containerAsset(`url:${url}`, url), parent, target, mountY, hide);
  };

  /** All current children of an entity (a just-built procedural composite). */
  const childrenOf = (e: pc.Entity): pc.Entity[] => [...e.children] as pc.Entity[];

  // --- worlds -----------------------------------------------------------------
  const cityRoot = new pc.Entity("city");
  app.root.addChild(cityRoot);
  const interiorRootByBuilding = new Map<string, { root: pc.Entity; originX: number; built: boolean; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }>();

  const interactables: Interactable[] = [];
  const labelPoints: LabelPoint[] = [];
  const spinners: pc.Entity[] = [];
  const exhibits: pc.Entity[] = [];
  const solids = new Map<string, WalkSolid[]>();
  const surfaces = new Map<string, ({ kind: "rect"; x: number; z: number; w: number; d: number } |
    { kind: "segment"; from: WalkPoint; to: WalkPoint; width: number })[]>();
  const addSolid = (world: string, x: number, z: number, w: number, d: number, height?: number, label?: string): WalkSolid => {
    const list = solids.get(world) ?? [];
    const solid = { x, z, halfW: w / 2, halfD: d / 2, height, label };
    list.push(solid);
    solids.set(world, list);
    return solid;
  };
  const blockedAt = (world: string, x: number, z: number, radius: number): boolean =>
    (solids.get(world) ?? []).some((solid) =>
      Math.abs(solid.x - x) < solid.halfW + radius && Math.abs(solid.z - z) < solid.halfD + radius
    );
  const onSurface = (world: string, x: number, z: number): boolean => {
    const areas = surfaces.get(world);
    return !areas || areas.some((area) => area.kind === "rect"
      ? x >= area.x - 0.06 && x <= area.x + area.w + 0.06 && z >= area.z - 0.06 && z <= area.z + area.d + 0.06
      : distanceToSegment(x, z, { x: area.from.x, y: area.from.z }, { x: area.to.x, y: area.to.z }) <= area.width / 2
    );
  };
  let elapsed = 0;

  const buildingById = new Map<string, SpaceBuilding>();
  for (const b of space.city.buildings) buildingById.set(b.id, b);
  const lBuildingById = new Map(layout.city.buildings.map((b) => [b.id, b]));
  const diagramById = new Map<string, SpaceDiagram>(space.diagrams.map((d) => [d.id, d]));
  const flowById = new Map<string, SpaceFlow>(space.flows.map((f) => [f.id, f]));
  const interiorByBuilding = new Map(space.interiors.map((i) => [i.building, i]));
  const overlaysByBuilding = new Map<string, { class: string; url: string }[]>();
  const exteriorLandmarks: { layout: CityLayout["buildings"][number]; url: string }[] = [];
  for (const ov of overlays ?? []) {
    const list = overlaysByBuilding.get(ov.building) ?? [];
    list.push({ class: ov.class, url: ov.url });
    overlaysByBuilding.set(ov.building, list);
  }
  const accentOf = (ref: string, fallback = DAY.teal): string => {
    const token = space.presentation?.accentOverrides?.[ref];
    return (token && ACCENT_HEX[token]) || fallback;
  };

  // --- city: ground, districts, roads ------------------------------------------
  const cb_ = layout.city.bounds;
  const campus = layout.city.campus;
  const startBuilding = lBuildingById.get(space.presentation?.start?.building ?? "");
  const frontage = (() => {
    if (!startBuilding) return null;
    const { doorDir, size } = startBuilding;
    const door = entrancePoint(startBuilding);
    const facadeWidth = Math.abs(doorDir.z) * size.w + Math.abs(doorDir.x) * size.d;
    const offset = (x: number, z: number): WalkPoint => ({
      x: (x - door.x) * doorDir.z - (z - door.z) * doorDir.x,
      z: (x - door.x) * doorDir.x + (z - door.z) * doorDir.z
    });
    let left = -Math.max(13, facadeWidth / 2 + 9);
    let right = -left;
    const buildings = new Set([startBuilding.id]);
    for (const building of layout.city.buildings) {
      if (building.doorDir.x !== doorDir.x || building.doorDir.z !== doorDir.z) continue;
      const nextDoor = entrancePoint(building);
      const local = offset(nextDoor.x, nextDoor.z);
      if (Math.abs(local.z) > 2.6 || Math.abs(local.x) > 30) continue;
      buildings.add(building.id);
      const halfWidth = (Math.abs(doorDir.z) * building.size.w + Math.abs(doorDir.x) * building.size.d) / 2;
      left = Math.min(left, local.x - halfWidth - 2.4);
      right = Math.max(right, local.x + halfWidth + 2.4);
    }
    const road = layout.city.roads[0];
    const avenue = road?.points[0] ? offset(road.points[0].x, road.points[0].z).z : 19;
    const avenueEdge = avenue - (road?.width ?? 0) / 2;
    const ownLane = !campus && (!road || avenueEdge > 12.8);
    const lane = campus ? 13 : ownLane ? 7.8 : Math.max(5, avenue);
    const roadWidth = campus ? 0 : ownLane ? 4.8 : road?.width ?? 0;
    const sidewalk = campus ? 0 : 2.15;
    const spawnDistance = campus ? 12.3 : Math.max(8, Math.min(12, lane + roadWidth / 2 + sidewalk * 0.58));
    return { door, doorDir, facadeWidth, offset, buildings, left, right, lane, roadWidth, sidewalk, ownLane, spawnDistance };
  })();
  const overviewRoot = new pc.Entity("system-overview");
  cityRoot.addChild(overviewRoot);
  overviewRoot.enabled = false;
  const overviewLabels: LabelPoint[] = [];
  const cityLinks = cityRelationships(space);
  const systemLinks = new Map(cityLinks.map((link) => [link.id, link]));
  const linkVisuals = new Map<string, { root: pc.Entity; label: LabelPoint; points: WalkPoint[] } | null>();
  const ground = part(
    cityRoot,
    "box",
    Math.max(600, cb_.w * 3),
    0.5,
    Math.max(600, cb_.d * 3),
    cb_.x + cb_.w / 2,
    -0.27,
    cb_.z + cb_.d / 2,
    materialFor(DAY.ground),
    "ground"
  );
  void ground;

  let contactShadowMaterial: pc.StandardMaterial | undefined;
  if (campus) {
    const { x, z, w, d } = campus;
    const backdrop = makeScreen(8, 128);
    const atmosphere = backdrop.ctx.createLinearGradient(0, 0, 0, backdrop.canvas.height);
    atmosphere.addColorStop(0, "#80afc5");
    atmosphere.addColorStop(0.49, "#c0d5d4");
    atmosphere.addColorStop(0.61, "#e6ded0");
    atmosphere.addColorStop(1, "#b3bbb3");
    backdrop.ctx.fillStyle = atmosphere;
    backdrop.ctx.fillRect(0, 0, backdrop.canvas.width, backdrop.canvas.height);
    backdrop.material.useLighting = false;
    backdrop.material.useFog = false;
    backdrop.material.cull = pc.CULLFACE_FRONT;
    backdrop.material.depthWrite = false;
    backdrop.material.update();
    uploadScreen(backdrop);
    part(cityRoot, "sphere", 1040, 1040, 1040, x + w / 2, 0, z + d / 2, backdrop.material, "campus-sky");
    const paving = studioStone(20, 15, screens);
    part(cityRoot, "box", w + 0.4, 0.30, d + 0.4, x + w / 2, -0.13, z + d / 2, materialFor("#b5a48d"), "campus-edge");
    part(cityRoot, "box", w, 0.11, d, x + w / 2, -0.01, z + d / 2, paving, "campus-paving");
    const { x: px, z: pz } = layout.city.plaza.pos;
    part(cityRoot, "cylinder", 5.6, 0.16, 5.6, px, 0.12, pz, materialFor("#af9c7e"), "plaza-border");
    part(cityRoot, "cylinder", 5.27, 0.12, 5.27, px, 0.16, pz, materialFor("#dfceb6"));
    part(cityRoot, "cylinder", 3.5, 0.4, 3.5, px, 0.24, pz, materialFor("#8a805e"), "plaza-planter");
    part(cityRoot, "cylinder", 3.1, 0.055, 3.1, px, 0.455, pz, materialFor("#7c925b"));
    addSolid("city", px, pz, 3.0, 3.0, 0.48, "plaza planter");

  }
  const addContactShadow = (parent: pc.Entity, x: number, z: number, width: number, depth: number, y = 0.024): void => {
    if (!contactShadowMaterial) {
      const shade = makeScreen(64, 64);
      const gradient = shade.ctx.createRadialGradient(32, 32, 10, 32, 32, 32);
      gradient.addColorStop(0, "rgba(28,39,36,.35)");
      gradient.addColorStop(0.68, "rgba(28,39,36,.22)");
      gradient.addColorStop(1, "rgba(28,39,36,0)");
      shade.ctx.fillStyle = gradient;
      shade.ctx.fillRect(0, 0, 64, 64);
      uploadScreen(shade);
      contactShadowMaterial = shade.material;
      contactShadowMaterial.emissive.fromString("#4f4637");
      contactShadowMaterial.emissiveMap = null;
      contactShadowMaterial.opacityMap = shade.texture;
      contactShadowMaterial.opacityMapChannel = "a";
      contactShadowMaterial.blendType = pc.BLEND_NORMAL;
      contactShadowMaterial.depthWrite = false;
      contactShadowMaterial.useLighting = false;
      contactShadowMaterial.update();
    }
    const shadow = new pc.Entity("contact-shadow");
    shadow.addComponent("render", { type: "plane", material: contactShadowMaterial, castShadows: false });
    shadow.setLocalScale(width, 1, depth);
    shadow.setLocalPosition(x, y, z);
    parent.addChild(shadow);
  };
  const addCampusShadow = (x: number, z: number, width: number, depth: number): void => {
    addContactShadow(cityRoot, x, z, width, depth, 0.062);
  };

  layout.city.districts.forEach((d, i) => {
    part(
      cityRoot,
      "box",
      d.rect.w,
      0.12,
      d.rect.d,
      d.rect.x + d.rect.w / 2,
      -0.04,
      d.rect.z + d.rect.d / 2,
      materialFor(DAY.district[i % DAY.district.length]),
      `district:${d.id}`
    );
    const meta = space.city.districts.find((sd) => sd.id === d.id);
    // Obelisk marker.
    const ob = new pc.Entity(`marker:${d.id}`);
    ob.setPosition(d.markerPos.x, 0, d.markerPos.z);
    cityRoot.addChild(ob);
    if (campus) {
      part(ob, "box", 0.9, 0.27, 0.78, 0, 0.185, 0, materialFor("#ae9c82"));
      part(ob, "box", 0.58, 1.52, 0.17, 0, 1.0, 0, materialFor("#3b5b57"));
      part(ob, "box", 0.35, 0.58, 0.04, 0, 1.32, 0.095, materialFor("#85b5a9"));
    } else {
      part(ob, "box", 1.4, 0.3, 1.4, 0, 0.15, 0, materialFor(DAY.metal));
      part(ob, "box", 0.7, 5.4, 0.7, 0, 3, 0, materialFor("#cfd4d8"));
      part(ob, "box", 0.16, 4.6, 0.06, 0, 3, 0.37, materialFor("#0e2a27", accentOf(d.id), 0.9));
      mountPack(ob, "obelisk-marker", 6, 0, childrenOf(ob));
    }
    labelPoints.push({
      world: "city",
      id: `district:${d.id}`,
      x: d.markerPos.x,
      y: campus ? 2.15 : 6.4,
      z: d.markerPos.z,
      text: meta?.title ?? d.id,
      range2: campus ? 12 * 12 : 150 * 150,
      minor: false
    });
    if (meta) {
      interactables.push({
        world: "city",
        x: d.markerPos.x,
        z: d.markerPos.z,
        radius: 3,
        focus: { kind: "marker", ref: d.id, title: meta.title, hint: meta.kind ?? "domain" }
      });
    }
  });

  for (const road of layout.city.roads) {
    if (campus) break;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const seg = part(
        cityRoot,
        "box",
        road.width,
        0.08,
        len,
        (a.x + b.x) / 2,
        0.01,
        (a.z + b.z) / 2,
        materialFor(DAY.road),
        "road"
      );
      seg.lookAt(b.x, 0.01, b.z);
      // center stripe
      const stripeCount = Math.floor(len / 4);
      for (let s = 0; s < stripeCount; s++) {
        const t = (s + 0.5) / stripeCount;
        part(
          cityRoot,
          "box",
          0.18,
          0.09,
          1.6,
          a.x + (b.x - a.x) * t,
          0.02,
          a.z + (b.z - a.z) * t,
          materialFor(DAY.roadStripe)
        ).lookAt(b.x, 0.02, b.z);
      }
    }
  }

  if (frontage && !campus) {
    const { door, doorDir, left, right, lane, roadWidth, sidewalk, ownLane } = frontage;
    const court = new pc.Entity("focus-frontage");
    court.setPosition(door.x, 0, door.z);
    court.setEulerAngles(0, Math.atan2(doorDir.x, doorDir.z) * 180 / Math.PI, 0);
    cityRoot.addChild(court);
    const width = right - left;
    const middle = (left + right) / 2;
    const paving = materialFor("#bdbdb1");
    const curb = materialFor("#e0dcd0");
    const seam = materialFor("#a6a99e");
    const marking = materialFor("#deded2");
    if (ownLane) {
      part(court, "box", width, 0.07, roadWidth, middle, 0.016, lane, materialFor("#838989"), "frontage-lane");
      for (let x = left + 2.4; x < right - 1.6; x += 4.4) {
        if (Math.abs(x) < 2.4) continue;
        part(court, "box", 1.55, 0.012, 0.085, x, 0.063, lane, marking);
      }
    }
    for (const side of [-1, 1]) {
      const edge = lane + side * roadWidth / 2;
      const center = edge + side * sidewalk / 2;
      part(court, "box", width, 0.10, sidewalk, middle, 0.045, center, paving, "sidewalk");
      part(court, "box", width, 0.13, 0.16, middle, 0.055, edge, curb, "curb");
      for (let x = left + 2; x < right - 0.2; x += 2) {
        part(court, "box", 0.028, 0.01, sidewalk - 0.13, x, 0.097, center, seam);
      }
    }
    for (let x = -1.25; x <= 1.26; x += 0.50) {
      part(court, "box", 0.25, 0.015, roadWidth - 0.54, x, 0.068, lane, marking, "crosswalk-stripe");
    }
  }

  // --- city: gate + plaza -------------------------------------------------------
  {
    const g = new pc.Entity("gate");
    g.setPosition(layout.city.gate.pos.x, 0, layout.city.gate.pos.z);
    g.setEulerAngles(0, (layout.city.gate.rot * 180) / Math.PI, 0);
    cityRoot.addChild(g);
    const pylon = materialFor("#cfd4d8");
    part(g, "box", 1.6, 7, 1.6, -6, 3.5, 0, pylon);
    part(g, "box", 1.6, 7, 1.6, 6, 3.5, 0, pylon);
    part(g, "box", 14.4, 1.4, 1.2, 0, 7.4, 0, pylon);
    part(g, "box", 13.8, 0.5, 0.2, 0, 7.4, 0.62, materialFor("#0e2a27", DAY.teal, 0.8));
    mountPack(g, "gate-arch", 14, 0, childrenOf(g));
    if (!campus) labelPoints.push({
      world: "city",
      id: "gate",
      x: layout.city.gate.pos.x,
      y: 9.2,
      z: layout.city.gate.pos.z,
      text: space.meta.name,
      range2: 220 * 220,
      minor: false
    });
  }
  // Plaza: master diagram hologram panel near the fountain.
  const masterDiagram = space.diagrams.find((d) => d.owner === "city");
  if (masterDiagram) {
    const p = layout.city.plaza.pos;
    const panelX = campus ? p.x + layout.city.plaza.radius + 2.3 : p.x;
    const panelZ = campus ? p.z - 0.4 : p.z - layout.city.plaza.radius - 1.5;
    const panel = new pc.Entity("plaza-panel");
    panel.setPosition(panelX, 0, panelZ);
    cityRoot.addChild(panel);
    for (const x of [-2.38, 2.38]) {
      part(panel, "box", 0.22, 2.75, 0.24, x, 1.38, 0, materialFor("#59756e"));
      part(panel, "box", 0.72, 0.12, 0.67, x, 0.06, 0, materialFor("#ab9c82"));
      addSolid("city", panelX + x, panelZ, 0.72, 0.67, 0.12, "city exhibit foot");
      addSolid("city", panelX + x, panelZ, 0.22, 0.24, 2.75, "city exhibit support");
    }
    const lay = layout.diagrams[masterDiagram.id];
    if (lay) {
      addDiagramExhibit(panel, masterDiagram, 5.65, 2.35, 2.52, true);
      addSolid("city", panelX, panelZ, 5.82, 0.30, 3.78, "city diagram exhibit");
    }
    interactables.push({
      world: "city",
      x: panelX,
      z: panelZ,
      radius: 4,
      focus: {
        kind: "panel",
        ref: masterDiagram.id,
        title: masterDiagram.title,
        summary: masterDiagram.note,
        sourcePath: masterDiagram.source?.path,
        source: masterDiagram.source,
        hint: "open diagram"
      },
      action: () => openDiagramPanel(masterDiagram)
    });
  }

  // --- city: props ---------------------------------------------------------------
  const furnitureSites: WalkSolid[] = [];
  const buildProp = (role: string, x: number, z: number, rot: number): void => {
    const e = new pc.Entity(`prop:${role}`);
    e.setPosition(x, 0, z);
    e.setEulerAngles(0, (rot * 180) / Math.PI, 0);
    cityRoot.addChild(e);
    switch (role) {
      case "tree-round": {
        const bark = materialFor(DAY.trunk);
        part(e, "cylinder", 0.32, 2.42, 0.32, 0, 1.21, 0, bark, "tree-trunk");
        const branch = part(e, "cylinder", 0.17, 0.94, 0.17, -0.27, 2.13, 0.05, bark, "tree-branch");
        branch.setLocalEulerAngles(0, 0, 36);
        part(e, "sphere", 2.32, 1.84, 2.05, -0.27, 2.82, -0.14, materialFor(DAY.leafDark), "canopy-shade");
        part(e, "sphere", 1.85, 1.60, 1.88, 0.64, 2.92, 0.13, materialFor(DAY.leaf), "canopy-east");
        part(e, "sphere", 1.59, 1.30, 1.57, -0.54, 3.35, 0.40, materialFor("#8eb377"), "canopy-light");
        part(e, "sphere", 1.69, 1.64, 1.72, 0.28, 3.48, -0.39, materialFor("#729a63"), "canopy-crown");
        break;
      }
      case "tree-tall": {
        part(e, "cylinder", 0.26, 2.22, 0.26, 0, 1.11, 0, materialFor(DAY.trunk));
        part(e, "cone", 2.0, 2.35, 2.0, 0, 2.99, 0, materialFor("#557b55"));
        part(e, "cone", 1.68, 2.44, 1.68, 0, 3.72, 0, materialFor(DAY.leafDark));
        part(e, "cone", 1.23, 2.25, 1.23, 0, 4.29, 0, materialFor("#84a878"));
        break;
      }
      case "street-lamp": {
        const metal = materialFor("#556567");
        part(e, "cylinder", 0.36, 0.13, 0.36, 0, 0.065, 0, metal);
        part(e, "cylinder", 0.145, 4.3, 0.145, 0, 2.15, 0, metal);
        part(e, "box", 0.9, 0.15, 0.29, 0.36, 4.28, 0, metal);
        part(e, "box", 0.54, 0.05, 0.21, 0.49, 4.192, 0, materialFor("#ebdec6", "#f4dbad", 0.32));
        break;
      }
      case "bench": {
        const timber = materialFor("#bb916a");
        const steel = materialFor("#51605d");
        for (const seat of [-0.18, 0, 0.18]) part(e, "box", 1.86, 0.072, 0.154, 0, 0.46, seat, timber);
        for (const side of [-1, 1]) {
          part(e, "box", 0.102, 0.39, 0.49, side * 0.77, 0.204, 0, steel);
          part(e, "box", 0.093, 0.48, 0.10, side * 0.77, 0.68, -0.23, steel);
        }
        for (const y of [0.68, 0.84]) part(e, "box", 1.85, 0.139, 0.075, 0, y, -0.266, timber);
        break;
      }
      case "plaza-fountain": {
        part(e, "cylinder", 7, 0.5, 7, 0, 0.25, 0, materialFor("#cfd4d8"));
        part(e, "cylinder", 6.4, 0.2, 6.4, 0, 0.55, 0, materialFor("#9fd2cd", DAY.teal, 0.25));
        part(e, "cylinder", 1.2, 1.6, 1.2, 0, 1.1, 0, materialFor("#cfd4d8"));
        part(e, "cylinder", 3, 0.3, 3, 0, 1.9, 0, materialFor("#cfd4d8"));
        const water = part(e, "cylinder", 2.5, 0.12, 2.5, 0, 2.1, 0, materialFor("#9fd2cd", DAY.teal, 0.4), "water");
        spinners.push(water);
        break;
      }
      case "signpost": {
        part(e, "cylinder", 0.1, 3.4, 0.1, 0, 1.7, 0, materialFor("#5a646b"));
        part(e, "box", 1.5, 0.4, 0.08, 0.6, 2.9, 0, materialFor("#e9edef"));
        part(e, "box", 1.3, 0.4, 0.08, -0.55, 2.4, 0.06, materialFor("#dfe7df"));
        part(e, "box", 1.1, 0.4, 0.08, 0.5, 1.9, -0.06, materialFor("#e7e2d4"));
        break;
      }
      default: {
        part(e, "sphere", 1.1, 1, 1.1, 0, 0.5, 0, materialFor(DAY.leaf));
      }
    }
    const targets: Record<string, number> = {
      "tree-round": 5,
      "tree-tall": 7,
      "street-lamp": 4.5,
      bench: 1.8,
      "plaza-fountain": 6.5,
      signpost: 3.2,
      "bush-round": 1.2,
      "planter-box": 1.4
    };
    mountPack(e, role, targets[role] ?? 1.4, 0, childrenOf(e));
    const halfSize = role === "plaza-fountain" ? 3.5 : role === "tree-round" || role === "tree-tall" ? 1.12 : 0.95;
    furnitureSites.push({ x, z, halfW: halfSize, halfD: halfSize });
  };
  for (const prop of layout.city.props) {
    if (!campus && frontage && ["street-lamp", "tree-round", "tree-tall", "bench"].includes(prop.role)) {
      const local = frontage.offset(prop.pos.x, prop.pos.z);
      const sightWidth = Math.max(7.6, frontage.facadeWidth * 0.58 + 3.2);
      if (local.z >= 1.5 && local.z <= frontage.spawnDistance + 8 && Math.abs(local.x) <= sightWidth) continue;
    }
    buildProp(prop.role, prop.pos.x, prop.pos.z, prop.rot);
    if (campus && prop.role === "tree-round") {
      const { x, z } = prop.pos;
      part(cityRoot, "box", 2.2, 0.12, 1.8, x, 0.105, z, materialFor("#a39177"));
      part(cityRoot, "box", 1.97, 0.055, 1.56, x, 0.175, z, materialFor("#77865a"));
      addSolid("city", x, z, 0.45, 0.45, 3.1, "tree trunk");
      addCampusShadow(x + 0.75, z + 1.28, 5.7, 4.5);
    }
  }
  if (campus) buildProp("tree-round", layout.city.plaza.pos.x, layout.city.plaza.pos.z, 0);

  function buildCampusShell(root: pc.Entity, building: CityLayout["buildings"][number], primary: boolean,
    archetype: SpaceBuilding["archetype"]): void {
    const { w, d, h } = building.size;
    const side = building.doorDir.z;
    const face = side * d / 2;
    const index = hashOf(building.id) % 3;
    const workshop = archetype === "hall";
    const narrow = archetype === "tower" || archetype === "landmark";
    const limestone = materialFor(primary ? "#ccb89c" : ["#c8b49c", "#b7b7aa", "#baad98"][index], undefined, 0.4, "limestone");
    const trim = materialFor(primary ? "#dac7ac" : ["#d4c2a7", "#c8c8bc", "#cabeaa"][index]);
    const shadow = materialFor("#776e60");
    const roof = materialFor("#687872");
    const frame = materialFor("#435b61");
    const glass = materialFor(["#456c83", "#456e79", "#4b6c78"][index], "#85b1c5", 0.16, "glazing");
    const lightGlass = materialFor(["#7299ad", "#6f9ba4", "#819da8"][index], "#b3d0d6", 0.23, "glazing");
    const base = Math.min(primary ? 5.32 : 4.54, h * 0.68);
    const upperH = h - base - 0.23;
    const upperW = w * (primary ? 0.87 : workshop ? 0.92 : narrow ? 0.75 : 0.83);
    const upperD = d * (primary ? 0.83 : workshop ? 0.89 : narrow ? 0.72 : 0.81);
    const upperX = primary || workshop ? 0 : (index === 0 ? -1 : 1) * (w - upperW) * 0.29;
    const upperZ = -side * (d - upperD) * 0.19;
    const upperFace = upperZ + side * upperD / 2;

    // The plinth stands proud so the overlapping walls cannot share a visible face.
    part(root, "box", w + 0.16, 0.27, d + 0.16, 0, 0.135, 0, shadow, "campus-foundation");
    part(root, "box", w, base, d, 0, base / 2 + 0.12, 0, limestone, "campus-podium");
    part(root, "box", w + 0.16, 0.28, d + 0.16, 0, base + 0.04, 0, trim, "podium-coping");
    part(root, "box", upperW, upperH, upperD, upperX, base + upperH / 2, upperZ, limestone, "campus-upper-volume");
    part(root, "box", upperW + 0.19, 0.26, upperD + 0.18, upperX, h - 0.18, upperZ, trim, "roof-coping");
    part(root, "box", upperW - 0.12, 0.11, upperD - 0.12, upperX, h - 0.045, upperZ, roof, "roof-deck");
    const roofRise = primary ? 0.65 : narrow ? 0.72 : 0.30;
    const roofX = upperX + upperW * (primary ? -0.18 : 0.19);
    const roofZ = upperZ - side * upperD * 0.22;
    part(root, "box", upperW * 0.29, roofRise, upperD * 0.31, roofX, h + roofRise / 2, roofZ, limestone, "roof-service-room");
    part(root, "box", upperW * 0.31, 0.11, upperD * 0.33, roofX, h + roofRise, roofZ, roof);

    const windowWidth = upperW * (workshop ? 0.88 : 0.80);
    const windowLow = base + 0.28;
    const windowHigh = h - 0.51;
    const windowH = Math.max(0.36, windowHigh - windowLow);
    const rows = Math.max(1, Math.ceil(windowH / (workshop ? 2.85 : 2.35)));
    const columns = Math.max(3, Math.min(9, Math.round(windowWidth / (workshop ? 2.25 : 1.58))));
    const revealZ = upperFace + side * 0.31;
    const rowHeight = windowH / rows;
    const panel = (width: number, height: number, x: number, y: number, z: number, material: pc.StandardMaterial): void => {
      part(root, "box", width, height, 0.08, x, y, z, material);
    };
    panel(windowWidth + 0.2, windowH + 0.1, upperX, windowLow + windowH / 2, upperFace + side * 0.048, shadow);
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const x = upperX + (col + 0.5) * windowWidth / columns - windowWidth / 2;
      const y = windowLow + (row + 0.5) * rowHeight;
      panel(windowWidth / columns - 0.11, rowHeight - 0.13, x, y, upperFace + side * 0.102,
        (col + row * 2 + index) % 4 === 0 ? lightGlass : glass);
    }
    for (let col = 0; col <= columns; col++) {
      const x = upperX + col * windowWidth / columns - windowWidth / 2;
      const pier = col === 0 || col === columns || narrow && col % 2 === 0;
      part(root, "box", pier ? 0.21 : 0.09, windowH + 0.14, pier ? 0.47 : 0.31,
        x, windowLow + windowH / 2, upperFace + side * 0.20, pier ? trim : frame, "facade-window-reveal");
    }
    for (let row = 0; row <= rows; row++) part(root, "box", windowWidth + 0.21, row % 2 ? 0.15 : 0.10, 0.39,
      upperX, windowLow + row * rowHeight, upperFace + side * 0.19, row === 0 || row === rows ? trim : frame, "facade-sill");
    for (const wing of [-1, 1]) {
      const openingWidth = w * (primary ? 0.265 : 0.23);
      const center = wing * w * 0.331;
      const lowerH = Math.min(3.17, base - 0.9);
      panel(openingWidth + 0.21, lowerH + 0.22, center, 0.47 + lowerH / 2, face + side * 0.053, shadow);
      panel(openingWidth, lowerH, center, 0.47 + lowerH / 2, face + side * 0.114, glass);
      for (let col = -1; col <= 1; col++) part(root, "box", 0.085, lowerH + 0.14, 0.25,
        center + col * openingWidth * 0.49, 0.47 + lowerH / 2, face + side * 0.23, frame);
      part(root, "box", openingWidth + 0.27, 0.14, 0.31, center, 0.45, face + side * 0.24, trim);
      const sideBays = workshop ? 3 : 4;
      for (let bay = 0; bay < sideBays; bay++) {
        const z = upperZ + (bay + 0.5) * upperD / sideBays - upperD / 2;
        const sideFace = upperX + wing * (upperW / 2 + 0.065);
        part(root, "box", 0.14, upperH * 0.68, upperD / sideBays * 0.77, sideFace, base + upperH * 0.51, z,
          bay % 2 ? glass : lightGlass, "side-window");
        part(root, "box", 0.20, upperH * 0.78, 0.11, sideFace + wing * 0.07, base + upperH * 0.51, z, frame);
      }
    }
    // The selected building has a taller stair/atrium volume and a visible return to the roof.
    if (primary) {
      const cap = Math.min(0.28, h * 0.035);
      const portalW = w * 0.36;
      part(root, "box", portalW + 0.63, windowH + cap, 0.40, upperX, windowLow + (windowH + cap) / 2, revealZ, frame, "atrium-reveal");
      panel(portalW, windowH - 0.22, upperX, windowLow + windowH / 2, revealZ + side * 0.26, lightGlass);
      part(root, "box", 0.115, windowH - 0.16, 0.1, upperX, windowLow + windowH / 2, revealZ + side * 0.335, frame);
      for (let row = 1; row < rows; row++) part(root, "box", portalW, 0.095, 0.1, upperX,
        windowLow + row * rowHeight, revealZ + side * 0.335, frame);
      for (const wing of [-1, 1]) part(root, "box", 0.28, windowH + cap, 0.62, upperX + wing * (portalW / 2 + 0.24),
        windowLow + (windowH + cap) / 2, revealZ + side * 0.10, trim, "atrium-pilaster");
    }
  }

  // --- city: buildings -----------------------------------------------------------
  for (const lb of layout.city.buildings) {
    const meta = buildingById.get(lb.id);
    if (!meta) continue;
    const root = new pc.Entity(`building:${lb.id}`);
    root.setPosition(lb.pos.x, 0, lb.pos.z);
    cityRoot.addChild(root);
    const hash = hashOf(lb.id);
    const facade = materialFor(DAY.facade[hash % DAY.facade.length], undefined, 0.4, "limestone");
    const glass = materialFor("#597780", "#adcbd3", 0.22, "window-band");
    const { w, d, h } = lb.size;
    const isStart = startBuilding?.id === lb.id;
    const onFrontage = Boolean(campus || frontage?.buildings.has(lb.id));
    addSolid("city", lb.pos.x, lb.pos.z, w, d, h);

    if (campus) {
      buildCampusShell(root, lb, isStart, meta.archetype);
      addCampusShadow(lb.pos.x + 0.95, lb.pos.z + lb.doorDir.z * 0.68, w + 5, d + 4.4);
    } else if (meta.archetype === "hall") {
      part(root, "box", w * 1.15, 0.4, d * 1.15, 0, 0.2, 0, materialFor("#c6cbce"));
      part(root, "box", w, h * 0.7, d, 0, (h * 0.7) / 2, 0, facade);
      part(root, "box", w * 0.92, h * 0.22, d * 0.9, 0, h * 0.78, 0, facade);
      part(root, "box", w * 0.7, h * 0.16, d * 0.8, 0, h * 0.94, 0, materialFor(DAY.roof));
      part(root, "box", w * 0.92, h * 0.35, 0.13, 0, h * 0.34, (d / 2 + 0.051) * (lb.doorDir.z || 1), glass);
    } else {
      part(root, "box", w * 1.15, 0.4, d * 1.15, 0, 0.2, 0, materialFor("#c6cbce"));
      const setback = meta.archetype === "tower" || meta.archetype === "landmark";
      const bodyH = setback ? h * 0.7 : h;
      part(root, "box", w, bodyH, d, 0, bodyH / 2, 0, facade);
      for (let y = 1.6; y < bodyH - 1; y += 2.6) {
        part(root, "box", w + 0.13, 1.22, d + 0.13, 0, y, 0, glass);
        part(root, "box", w + 0.21, 0.11, d + 0.21, 0, y - 0.66, 0, materialFor("#c2b6a3"));
      }
      part(root, "box", w * 1.04, 0.3, d * 1.04, 0, bodyH + 0.15, 0, materialFor(DAY.roof));
      if (setback) {
        const tw = w * 0.66;
        const td = d * 0.66;
        const topH = h - bodyH;
        part(root, "box", tw, topH, td, 0, bodyH + topH / 2, 0, facade);
        for (let y = 1.12; y < topH - 0.3; y += 2.06) {
          part(root, "box", tw + 0.13, 1.12, td + 0.13, 0, bodyH + y, 0, glass);
        }
        part(root, "box", tw * 1.06, 0.26, td * 1.06, 0, h + 0.13, 0, materialFor(DAY.roof));
        if (meta.archetype === "landmark") {
          part(root, "cylinder", 0.14, 3, 0.14, 0, h + 1.5, 0, materialFor(DAY.metal));
          part(root, "box", 1.2, 0.5, 0.14, 0, h + 0.6, 0, materialFor("#0e2a27", accentOf(lb.id), 0.9));
        }
      }
    }
    const fallbackShell = childrenOf(root);
    // The tower model reaches a tall, narrow footprint without the landmark's wider base shrinking its roof.
    const narrowOffice = isStart && h >= 16 && Math.max(w, d) / h <= 0.54;
    const compactOffice = onFrontage && !isStart && meta.archetype === "hall" && h <= 10 && Math.min(w, d) >= h * 0.72;
    const archetypeRole = narrowOffice ? "tower" : compactOffice ? "low" : meta.archetype ?? (h >= 16 ? "tower" : h >= 10 ? "slab" : "low");

    // Door portal on the avenue side.
    const { x: doorX, z: doorZ } = entrancePoint(lb);
    const door = new pc.Entity(`door:${lb.id}`);
    door.setPosition(doorX, 0, doorZ);
    door.lookAt(doorX + lb.doorDir.x, 0, doorZ + lb.doorDir.z);
    cityRoot.addChild(door);
    let fitEntrance: ((size: typeof lb.size) => void) | undefined;
    if (onFrontage) {
      const frame = materialFor("#8d9c98");
      const pane = materialFor("#5c9da9", "#add8db", 0.19, "glazing");
      part(door, "box", 4.1, 3.78, 0.22, 0, 1.88, -0.09, materialFor("#d9d1bf"));
      part(door, "box", 3.4, 3.55, 0.3, 0, 1.79, -0.14, frame);
      for (const side of [-1, 1]) {
        part(door, "box", 1.49, 3.03, 0.1, side * 0.78, 1.67, -0.32, pane);
        part(door, "box", 0.09, 0.43, 0.08, side * 0.17, 1.45, -0.40, frame);
      }
      part(door, "box", 3.4, 0.09, 0.6, 0, 0.06, -0.32, materialFor("#c6c0ae"));
      const facadeWidth = Math.abs(lb.doorDir.z) * w + Math.abs(lb.doorDir.x) * d;
      const plaqueWidth = isStart ? Math.min(10.5, Math.max(4.6, facadeWidth * 0.83)) : Math.min(6.2, Math.max(3.5, facadeWidth * 0.41));
      const plaqueHeight = isStart ? 1.55 : 1.24;
      const plaqueY = Math.min(h - 0.78, isStart ? 4.48 : 4.28);
      const rasterWidth = isStart ? 1024 : 640;
      const screen = makeScreen(rasterWidth, Math.round(rasterWidth * plaqueHeight / plaqueWidth), true);
      screen.material.useLighting = false;
      screen.material.update();
      const { ctx, canvas: sign } = screen;
      ctx.fillStyle = "#fff1d8";
      ctx.fillRect(0, 0, sign.width, sign.height);
      ctx.fillStyle = "#182922";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const font = (size: number) => `750 ${size}px system-ui, sans-serif`;
      const copy = fitDisplayCopy(meta.title, sign.width * 0.90, sign.height * 0.86, sign.height * 0.61, (text, size) => {
        ctx.font = font(size);
        return ctx.measureText(text).width;
      });
      ctx.font = font(copy.size);
      const top = (sign.height - copy.lines.length * copy.leading) / 2;
      for (const [index, line] of copy.lines.entries()) ctx.fillText(line, sign.width / 2, top + index * copy.leading);
      uploadScreen(screen);
      part(door, "box", plaqueWidth + 0.14, plaqueHeight + 0.13, 0.18, 0, plaqueY, -0.21, materialFor("#bcb19a"));
      addSignFace(door, plaqueWidth, plaqueHeight, plaqueY, -0.21, 0.18, -1, screen, "entry-plaque");
      if (campus) {
        const canopyWidth = Math.max(4.8, plaqueWidth + 0.6);
        const reach = isStart ? 2.25 : 1.68;
        const stone = materialFor("#c4ae92");
        const soffit = materialFor("#796f5b");
        part(door, "box", canopyWidth, 0.35, reach, 0, 3.76, -reach * 0.49, stone, "entrance-canopy");
        part(door, "box", canopyWidth - 0.22, 0.085, reach - 0.18, 0, 3.548, -reach * 0.48, soffit);
        part(door, "box", canopyWidth + 0.1, 0.093, 0.125, 0, 3.92, -reach + 0.04, materialFor("#decbb0"));
        for (const side of [-1, 1]) {
          const pier = side * (isStart ? 2.32 : 2.05);
          part(door, "box", 0.30, 3.48, 0.45, pier, 1.76, -0.20, stone, "entrance-pier");
          part(door, "box", 0.12, 0.63, 0.10, pier, 2.18, -0.49, materialFor("#e8d5ae", "#eecb91", 0.61));
          part(door, "box", 0.56, 0.05, 0.16, side * canopyWidth * 0.22, 3.486, -reach * 0.71,
            materialFor("#f2dbb5", "#ecd3ab", 0.52));
          const p = { x: doorX + lb.doorDir.z * pier + lb.doorDir.x * 0.20, z: doorZ - lb.doorDir.x * pier + lb.doorDir.z * 0.20 };
          addSolid("city", p.x, p.z, lb.doorDir.z ? 0.30 : 0.45, lb.doorDir.z ? 0.45 : 0.30, 3.5, "entry pier");
        }
        part(door, "box", canopyWidth, 0.08, 1.56, 0, 0.021, -0.71, materialFor("#baaa90"), "entrance-threshold");
        if (isStart) addCampusShadow(doorX + lb.doorDir.x * 1.3, doorZ + lb.doorDir.z * 1.3, 8.5, 3.8);
      } else if (!isStart) {
        const entryHeight = Math.max(3.8, plaqueY + plaqueHeight / 2 + 0.12);
        part(door, "box", Math.max(4.2, plaqueWidth + 0.3), entryHeight, 1.2, 0, entryHeight / 2, 0.51, facade, "entry-surround");
        const faceX = Math.abs(lb.doorDir.x);
        const faceZ = Math.abs(lb.doorDir.z);
        fitEntrance = (size) => {
          const faceWidth = faceZ * size.w + faceX * size.d;
          const inset = (faceX * (w - size.w) + faceZ * (d - size.d)) / 2;
          const scale = Math.min(0.76, size.h * 0.84 / entryHeight, faceWidth * 0.8 / Math.max(4.2, plaqueWidth + 0.3));
          door.setPosition(doorX - lb.doorDir.x * inset, 0, doorZ - lb.doorDir.z * inset);
          door.setLocalScale(scale, scale, scale);
        };
        fitEntrance(lb.size);
      }
    } else {
      part(door, "box", 2.6, 3.4, 0.4, 0, 1.7, -0.11, materialFor("#cfd4d8"));
      part(door, "box", 1.9, 2.9, 0.2, 0, 1.45, -0.33, materialFor("#123a36", accentOf(lb.id, DAY.door), 0.5));
      mountPack(door, "door-frame", 3.6, 0, childrenOf(door));
    }
    if (!campus) mountPack(root, `building-${archetypeRole}`, h, 0, fallbackShell, lb.size, fitEntrance);
    if (isStart && frontage && !campus) {
      const depth = Math.max(2.3, frontage.lane - frontage.roadWidth / 2 - frontage.sidewalk + 0.08);
      const approach = new pc.Entity("focus-approach");
      approach.setPosition(doorX + lb.doorDir.x * depth / 2, 0, doorZ + lb.doorDir.z * depth / 2);
      approach.setEulerAngles(0, Math.atan2(lb.doorDir.x, lb.doorDir.z) * 180 / Math.PI, 0);
      cityRoot.addChild(approach);
      part(approach, "box", 5.6, 0.1, depth, 0, 0.03, 0, materialFor("#c4c4b6"));
      const grout = materialFor("#adb4a6");
      part(approach, "box", 5.58, 0.01, 0.027, 0, 0.083, 0, grout);
      for (const x of [-1.4, 0, 1.4]) part(approach, "box", 0.027, 0.01, depth - 0.03, x, 0.083, 0, grout);
    }

    // Reserve ground landmarks after the lot and its walking route are placed.
    for (const ov of overlaysByBuilding.get(lb.id) ?? []) {
      if (ov.class === "landmark") {
        exteriorLandmarks.push({ layout: lb, url: ov.url });
      } else if (ov.class === "emblem") {
        const em = new pc.Entity(`overlay:emblem:${lb.id}`);
        em.setPosition(doorX + lb.doorDir.x * 0.6, 4.4, doorZ + lb.doorDir.z * 0.6);
        cityRoot.addChild(em);
        mountUrl(em, ov.url, 1.7, 0, []);
        spinners.push(em);
      }
    }

    if (!onFrontage) labelPoints.push({
      world: "city",
      id: `b:${lb.id}`,
      x: doorX + lb.doorDir.x * 0.38,
      y: 4.16,
      z: doorZ + lb.doorDir.z * 0.38,
      text: meta.title,
      range2: 65 * 65,
      minor: false
    });
    if (!campus || lb.doorDir.z <= 0) overviewLabels.push({
      world: "overview", id: `overview:${lb.id}`, ref: `overview:${lb.id}`,
      x: lb.pos.x, y: lb.size.h + 1.6, z: lb.pos.z, text: meta.title, range2: Infinity, minor: false
    });
    const hasInterior = interiorByBuilding.has(lb.id);
    if (hasInterior) {
      // A banner beside the door marks a building that has a lesson to enter.
      const bannerX = doorX + lb.doorDir.x * 1.15 - lb.doorDir.z * 3.05;
      const bannerZ = doorZ + lb.doorDir.z * 1.15 + lb.doorDir.x * 3.05;
      const banner = new pc.Entity(`lesson-banner:${lb.id}`);
      banner.setPosition(bannerX, 0, bannerZ);
      banner.setEulerAngles(0, Math.atan2(lb.doorDir.x, lb.doorDir.z) * 180 / Math.PI, 0);
      cityRoot.addChild(banner);
      part(banner, "cylinder", 0.09, 3.1, 0.09, 0, 1.55, 0, materialFor(DAY.metal));
      part(banner, "cylinder", 0.5, 0.08, 0.5, 0, 0.04, 0, materialFor(DAY.metal));
      part(banner, "box", 0.72, 1.75, 0.05, 0.42, 2.12, 0, materialFor("#1f6f66", DAY.teal, 0.22));
      mountPack(banner, "lesson-banner", 3.2, 0, childrenOf(banner));
      addSolid("city", bannerX, bannerZ, 0.5, 0.5, 3.1, "lesson banner");
    }
    const ownsDiagram = space.diagrams.some((item) =>
      item.owner === lb.id || item.owner.startsWith(`${lb.id}:`)
    );
    const localFlow = space.flows.find((flow) => flow.scope === `module:${lb.id}`);
    const openBuildingContent = ownsDiagram ? () => openInspect(lb.id) : localFlow ? () => { openReplay(localFlow.id); } : undefined;
    interactables.push({
      world: "city",
      x: doorX + lb.doorDir.x * 1.2,
      z: doorZ + lb.doorDir.z * 1.2,
      radius: 2.6,
      focus: {
        kind: hasInterior ? "door-enter" : "building",
        ref: lb.id,
        title: meta.title,
        summary: hasInterior ? undefined : meta.summary,
        source: meta.source,
        sourcePath: meta.source?.path,
        hint: hasInterior ? "enter" : ownsDiagram ? "inspect" : localFlow ? "related-flow" : "no-diagram"
      },
      action: hasInterior ? () => enterInterior(lb.id) : openBuildingContent
    });
    interactables.push({
      world: "city",
      x: lb.pos.x,
      z: lb.pos.z,
      radius: Math.max(w, d) / 2 + 3.5,
      focus: {
        kind: "building",
        ref: lb.id,
        title: meta.title,
        summary: meta.summary,
        sourcePath: meta.source?.path,
        source: meta.source,
        hint: ownsDiagram ? "inspect" : localFlow ? "related-flow" : "no-diagram"
      },
      action: openBuildingContent
    });
  }

  if (frontage && !campus) {
    const { door, doorDir, facadeWidth, lane, roadWidth, sidewalk } = frontage;
    const streetSide = lane - roadWidth / 2 - sidewalk * 0.53;
    const placeStreetProp = (role: string, lateral: number, outward: number, clearance: number, height: number): void => {
      const x = door.x + doorDir.z * lateral + doorDir.x * outward;
      const z = door.z - doorDir.x * lateral + doorDir.z * outward;
      if (blockedAt("city", x, z, clearance)) return;
      buildProp(role, x, z, Math.atan2(doorDir.x, doorDir.z));
      addSolid("city", x, z, clearance, clearance, height);
    };
    for (const side of [-1, 1]) {
      placeStreetProp("street-lamp", side * (facadeWidth / 2 + 3.5), streetSide, 0.34, 4.5);
      placeStreetProp("tree-round", side * (facadeWidth / 2 + 7), Math.max(1.6, streetSide - 1.85), 0.65, 1.7);
      placeStreetProp("bench", side * (facadeWidth / 2 + 5.4), streetSide - 0.75, 0.65, 0.92);
    }
  }
  if (frontage && campus) {
    const { door, doorDir, facadeWidth } = frontage;
    const plantedEdge = materialFor("#baa88c");
    const soil = materialFor("#6e7355");
    for (const side of [-1, 1]) {
      const lateral = side * (facadeWidth / 2 + 2.15);
      const x = door.x + doorDir.z * lateral + doorDir.x * 9.35;
      const z = door.z - doorDir.x * lateral + doorDir.z * 9.35;
      if (x < campus.x + 2.0 || x > campus.x + campus.w - 2.0 ||
        z < campus.z + 1.0 || z > campus.z + campus.d - 1.0 || blockedAt("city", x, z, 1.75)) continue;
      const bed = new pc.Entity("approach-planter");
      bed.setLocalPosition(x, 0, z);
      bed.setLocalEulerAngles(0, Math.atan2(doorDir.x, doorDir.z) * 180 / Math.PI, 0);
      cityRoot.addChild(bed);
      part(bed, "box", 3.52, 0.42, 1.6, 0, 0.245, 0, plantedEdge);
      part(bed, "box", 3.32, 0.075, 1.38, 0, 0.468, 0, soil);
      for (const [index, offset] of [-1.12, -0.28, 0.51, 1.14].entries()) {
        const hue = ["#687953", "#4c6748", "#79875e", "#58714a"][index];
        part(bed, "sphere", 0.76, 0.44 + index % 2 * 0.17, 0.86, offset, 0.71, index % 2 ? -0.19 : 0.21,
          materialFor(hue));
      }
      addSolid("city", x, z, doorDir.z ? 3.52 : 1.6, doorDir.z ? 1.6 : 3.52, 0.50, "approach planter");
      addCampusShadow(x + 0.27, z + 0.23, doorDir.z ? 5.1 : 2.7, doorDir.z ? 2.7 : 5.1);
    }
  }

  const drawOverviewStroke = (a: WalkPoint, b: WalkPoint, y: number, color: string, dashed: boolean, parent = overviewRoot): void => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) return;
    const count = dashed ? Math.min(14, Math.ceil(length / 4)) : 1;
    const district = parent === overviewRoot;
    const material = materialFor(color, color, district ? 0.12 : 0.28);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const beam = part(parent, "box", district ? 0.20 : dashed ? 0.31 : 0.42, 0.10, length / count * (dashed ? 0.63 : 1),
        a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t, material);
      beam.setLocalEulerAngles(0, yaw * 180 / Math.PI, 0);
    }
  };
  for (const [index, district] of layout.city.districts.entries()) {
    const { x, z, w, d } = district.rect;
    const corners = [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }];
    for (let i = 0; i < corners.length; i++) {
      drawOverviewStroke(corners[i], corners[(i + 1) % corners.length], 0.2, ["#467e79", "#587a9a", "#977349"][index % 3], true);
    }
    const title = space.city.districts.find((item) => item.id === district.id)?.title;
    if (title) overviewLabels.push({
      world: "overview", id: `district-overview:${district.id}`, x: x + w / 2, y: 1, z: z + d + 1,
      text: title, range2: Infinity, minor: false
    });
  }
  const overviewSolids = (solids.get("city") ?? []).filter((solid) => !solid.label || solid.label === "plaza planter");
  const overviewPairs = new Set(cityLinks.map(({ from, to }) => `${from}\u0000${to}`));
  function buildOverviewLink(link: CityRelationship): { root: pc.Entity; label: LabelPoint; points: WalkPoint[] } | null {
    const { id, title, kind } = link;
    const from = lBuildingById.get(link.from);
    const to = lBuildingById.get(link.to);
    if (!from || !to) return null;
    const lane = overviewPairs.has(`${link.to}\u0000${link.from}`) ? 0.82 : 0;
    const points = overviewLinkRoute(from, to, overviewSolids, walkPath, lane);
    if (!points) return null;
    const root = new pc.Entity(id);
    overviewRoot.addChild(root);
    const color = kind === "data" ? "#366eaa" : kind === "dependency" ? "#825d98" : kind === "message" ? "#9a6aa5" : "#23776f";
    const ink = materialFor(color, color, 0.26);
    const dashed = kind === "dependency" || kind === "message";
    const y = 0.43;
    let label = points[0];
    let longest = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      drawOverviewStroke(a, b, y, color, dashed, root);
      if (length > longest) {
        longest = length;
        label = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      }
    }
    const [a, b] = points.slice(-2);
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const arrowLength = Math.min(1.1, length);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const arrow = part(root, "cone", 0.8, arrowLength, 0.8,
      b.x - Math.sin(yaw) * arrowLength / 2, y, b.z - Math.cos(yaw) * arrowLength / 2, ink);
    arrow.setLocalEulerAngles(90, yaw * 180 / Math.PI, 0);
    const { x, z } = points[0];
    part(root, "cylinder", 0.64, 0.15, 0.64, x, y, z, ink);
    return { root, points, label: { world: "overview", id, ref: id, ...label, y: y + 0.38, text: title, range2: Infinity, minor: true } };
  }

  // --- city: flow traffic on routes ----------------------------------------------
  interface RoutePulse {
    flowId: string;
    points: { x: number; z: number }[];
    cum: number[];
    total: number;
    pulses: pc.Entity[];
    mats: pc.StandardMaterial[];
    active: boolean;
  }
  const routePulses: RoutePulse[] = [];
  for (const route of layout.city.routes) {
    const cum: number[] = [0];
    let total = 0;
    for (let i = 1; i < route.points.length; i++) {
      total += Math.hypot(
        route.points[i].x - route.points[i - 1].x,
        route.points[i].z - route.points[i - 1].z
      );
      cum.push(total);
    }
    if (total < 1) continue;
    const pulses: pc.Entity[] = [];
    const mats: pc.StandardMaterial[] = [];
    for (let k = 0; k < 3; k++) {
      const m = new pc.StandardMaterial();
      m.diffuse.fromString("#0a1413");
      m.emissive.fromString(DAY.teal);
      m.emissiveIntensity = 1.2;
      m.update();
      const s = new pc.Entity(`pulse:${route.flowId}:${k}`);
      s.addComponent("render", { type: "sphere" });
      s.render!.material = m;
      s.setLocalScale(0.5, 0.5, 0.5);
      cityRoot.addChild(s);
      pulses.push(s);
      mats.push(m);
    }
    const active = !space.presentation?.start || space.presentation.start.flow === route.flowId;
    for (const pulse of pulses) pulse.enabled = active;
    routePulses.push({ flowId: route.flowId, points: route.points, cum, total, pulses, mats, active });
    labelPoints.push({
      world: "city",
      id: `route:${route.flowId}`,
      x: route.points[0].x,
      y: 1.6,
      z: route.points[0].z,
      text: `● ${route.routeNumber} — ${flowById.get(route.flowId)?.title ?? route.flowId}`,
      range2: 70 * 70,
      minor: true
    });
  }

  // --- lights ---------------------------------------------------------------------
  const sun = new pc.Entity("sun");
  sun.addComponent("light", {
    type: "directional",
    color: new pc.Color().fromString("#fff4e0"),
    intensity: 1.35,
    castShadows: false
  });
  sun.setEulerAngles(55, 35, 0);
  app.root.addChild(sun);
  const fill = new pc.Entity("fill");
  fill.addComponent("light", {
    type: "directional",
    color: new pc.Color().fromString("#bcd4e4"),
    intensity: 0.55,
    castShadows: false
  });
  fill.setEulerAngles(30, -130, 0);
  app.root.addChild(fill);
  if (campus && frontage) {
    const bounce = new pc.Entity("campus-entrance-bounce");
    bounce.addComponent("light", { type: "omni", range: 12, intensity: 0.34, color: new pc.Color().fromString("#efd4b2") });
    bounce.setLocalPosition(frontage.door.x + frontage.doorDir.x * 4 - frontage.doorDir.z * 2.2, 4.8,
      frontage.door.z + frontage.doorDir.z * 4 + frontage.doorDir.x * 2.2);
    cityRoot.addChild(bounce);
  }

  // --- diagram screens --------------------------------------------------------------
  function addDiagramExhibit(parent: pc.Entity, diagram: SpaceDiagram, width: number, height: number, y: number, twoSided = false): void {
    const face = makeScreen(1152, Math.round(1152 * height / width), true);
    face.material.useLighting = false;
    face.material.update();
    const { canvas: card, ctx } = face;
    const w = card.width;
    const h = card.height;
    const inset = w * 0.058;
    const copy = (value: string, weight: number, preferredSize: number, top: number, boxHeight: number): void => {
      const font = (size: number) => `${weight} ${size}px system-ui, sans-serif`;
      const fit = fitDisplayCopy(value, w - inset * 2, boxHeight, preferredSize, (text, size) => {
        ctx.font = font(size);
        return ctx.measureText(text).width;
      });
      ctx.font = font(fit.size);
      for (const [index, line] of fit.lines.entries()) ctx.fillText(line, inset, top + index * fit.leading);
    };
    const type = diagramTitle(diagram);
    const stock = ctx.createLinearGradient(0, 0, w, h);
    stock.addColorStop(0, "#fff9ea");
    stock.addColorStop(1, "#efe2c7");
    ctx.fillStyle = stock;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#19473d";
    ctx.fillRect(0, 0, w, h * 0.168);
    ctx.fillStyle = "#c29a52";
    ctx.fillRect(0, h * 0.168, w, h * 0.014);
    ctx.fillStyle = "#fff4da";
    ctx.textBaseline = "top";
    copy(type.toUpperCase(), 750, h * 0.064, h * 0.046, h * 0.09);
    ctx.fillStyle = "#24372d";
    copy(diagram.title, 780, h * 0.122, h * 0.23, h * 0.298);
    ctx.fillStyle = "#405247";
    copy(diagram.note?.trim() || `${diagram.nodes.length} items · ${diagram.edges.length} connections`,
      575, h * 0.07, h * 0.547, h * 0.244);
    ctx.fillStyle = "#d9c39b";
    ctx.fillRect(inset, h * 0.82, w - inset * 2, 2);
    ctx.fillStyle = "#126456";
    copy("E  ·  OPEN DIAGRAM  ↗", 750, h * 0.059, h * 0.867, h * 0.094);
    uploadScreen(face);
    part(parent, "box", width + 0.17, height + 0.17, 0.15, 0, y, 0, materialFor("#78684e"));
    part(parent, "box", width + 0.09, height + 0.09, 0.178, 0, y, 0, materialFor("#c2a979"));
    addSignFace(parent, width, height, y, 0, 0.178, 1, face, "diagram-exhibit-front");
    if (twoSided) addSignFace(parent, width, height, y, 0, 0.178, -1, face, "diagram-exhibit-back");
  }

  const stageDepth = -5000;
  interface GraphStage {
    root: pc.Entity;
    view: SpatialView;
    labels: LabelPoint[];
    textures: Screen[];
    fitPoints: Position3[];
    frame?: { width: number; height: number; insets: ViewInsets; yaw: number; zoom: number; fit: ReturnType<typeof fitOrthographic> };
    targets: Map<string, {
      focus: SpaceFocus;
      node?: SpatialNode;
      edge?: string;
      line?: { x: number; y?: number; z: number }[];
    }>;
    zoom: number;
    yaw: number;
    topDown?: boolean;
    selectedRef?: string;
    diagram?: SpaceDiagram;
    sequence?: { edges: SpatialEdge[]; step: number; progress: number; playing: boolean };
  }
  let graphStage: GraphStage | null = null;
  let replaySession: {
    flow: SpaceFlow;
    traces: ReplayTrace[];
    trace: ReplayTrace;
    edgeByPair: Map<string, string>;
    step: number;
    progress: number;
    playing: boolean;
  } | null = null;

  function closeGraphStage(): void {
    if (!graphStage) return;
    graphStage.root.destroy();
    for (const screen of graphStage.textures) {
      screen.material.destroy();
      screen.texture.destroy();
    }
    sun.light!.intensity = 1.35;
    fill.light!.intensity = 0.55;
    app.scene.ambientLight.fromString("#9fb4bd");
    graphStage = null;
    replaySession = null;
    char.enabled = true;
    focused = null;
    cb.onFocus(null);
    cb.onReplay?.(null);
  }

  const graphPlateHeight = 0.56;
  function addGraphNameplate(root: pc.Entity, node: SpatialNode, textures: Screen[]): void {
    const width = node.width * 0.89;
    const height = graphPlateHeight;
    const screen = makeScreen(448, Math.round(448 * height / width), true, textures);
    const { canvas: plate, ctx } = screen;
    const pad = plate.width * 0.045;
    ctx.fillStyle = "#eee2ca";
    ctx.fillRect(0, 0, plate.width, plate.height);
    ctx.fillStyle = "#bba17c";
    ctx.fillRect(pad, plate.height - 3, plate.width - pad * 2, 2);
    ctx.fillStyle = "#273a32";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const font = (size: number) => `720 ${size}px system-ui, sans-serif`;
    const fit = fitDisplayCopy(node.label, plate.width - pad * 2, plate.height * 0.9, plate.height * 0.73, (text, size) => {
      ctx.font = font(size);
      return ctx.measureText(text).width;
    });
    ctx.font = font(fit.size);
    const top = (plate.height - fit.leading * fit.lines.length) / 2;
    for (const [index, line] of fit.lines.entries()) ctx.fillText(line, plate.width / 2, top + index * fit.leading);
    screen.material.useLighting = false;
    screen.material.update();
    uploadScreen(screen);
    const y = (node.group ? 0.103 : 0.002) + 0.68;
    const z = node.z + node.depth / 2;
    part(root, "box", width + 0.045, height + 0.045, 0.024, node.x, y, z + 0.015, materialFor("#b39d7e"));
    part(root, "box", width, height, 0.012, node.x, y, z + 0.036, screen.material, "node-nameplate");
  }

  function addEntityTablePlate(root: pc.Entity, node: SpatialNode, fields: SpaceDiagramField[], textures: Screen[], types = false): void {
    const width = node.width * 0.93;
    const depth = node.depth * 0.93;
    const screen = makeScreen(512, Math.round(512 * depth / width), true, textures);
    const { canvas: plate, ctx } = screen;
    const rowCount = Math.min(6, Math.max(1, fields.length));
    const header = Math.min(plate.height * 0.47, plate.height / (rowCount + 1) * 1.28);
    const rowHeight = (plate.height - header) / rowCount;
    const pad = plate.width * 0.052;
    ctx.fillStyle = "#f6eddc";
    ctx.fillRect(0, 0, plate.width, plate.height);
    ctx.fillStyle = "#295c57";
    ctx.fillRect(0, 0, plate.width, header);
    ctx.fillStyle = "#fff9e9";
    ctx.textBaseline = "middle";
    ctx.font = `720 ${Math.min(36, header * 0.63)}px system-ui, sans-serif`;
    ctx.fillText(node.label, pad, header / 2, plate.width - pad * 2);
    for (const [index, field] of fields.slice(0, fields.length > 6 ? 5 : 6).entries()) {
      const y = header + index * rowHeight;
      ctx.fillStyle = index % 2 === 0 ? "#f6eddc" : "#e5d9c3";
      ctx.fillRect(0, y, plate.width, rowHeight);
      ctx.font = `620 ${Math.min(26, rowHeight * 0.66)}px monospace`;
      ctx.fillStyle = "#253932";
      ctx.fillText(field.name, pad, y + rowHeight / 2, plate.width * 0.5 - pad * 2);
      ctx.fillStyle = "#465651";
      ctx.fillText(field.type, plate.width * 0.51, y + rowHeight / 2, plate.width * 0.28 - pad);
      if (field.keys?.length) {
        ctx.fillStyle = "#1d6459";
        ctx.fillText(field.keys.join(" "), plate.width * 0.79, y + rowHeight / 2, plate.width * 0.21 - pad);
      }
    }
    if (!fields.length || fields.length > 6) {
      ctx.font = `620 ${Math.min(25, rowHeight * 0.63)}px system-ui, sans-serif`;
      ctx.fillStyle = "#465651";
      ctx.fillText(fields.length ? `+${fields.length - 5} ${types ? "members · select type" : "fields · select entity"}`
        : types ? "Type overview" : "Entity overview", pad,
        plate.height - rowHeight / 2, plate.width - pad * 2);
    }
    screen.material.useLighting = false;
    screen.material.update();
    uploadScreen(screen);
    const surface = part(root, "box", width, depth, 0.015, node.x, (node.visualHeight ?? 1.07) + 0.011, node.z,
      screen.material, "entity-table");
    surface.setLocalEulerAngles(-90, 0, 0);
  }

  function studioStone(tilesX: number, tilesZ: number, textures: Screen[]): pc.StandardMaterial {
    const surface = makeScreen(192, 192, true, textures);
    const { width, height } = surface.canvas;
    const pixels = surface.ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / width * Math.PI * 2;
        const v = y / height * Math.PI * 2;
        const mottling = Math.cos(u) * Math.cos(v) * 2.4 + Math.cos(2 * u) * Math.sin(v) * 0.9;
        const grain = (((Math.imul(x + 17, y + 37) ^ Math.imul(y + 19, x + 23)) & 7) - 3.5) * 0.36;
        const edge = Math.min(x, y, width - x - 1, height - y - 1);
        const grout = edge === 0 ? 15 : edge === 1 ? 7 : 0;
        const i = (x + y * width) * 4;
        pixels.data[i] = 204 + mottling + grain - grout;
        pixels.data[i + 1] = 189 + mottling + grain - grout;
        pixels.data[i + 2] = 167 + mottling + grain - grout;
        pixels.data[i + 3] = 255;
      }
    }
    surface.ctx.putImageData(pixels, 0, 0);
    surface.texture.addressU = pc.ADDRESS_REPEAT;
    surface.texture.addressV = pc.ADDRESS_REPEAT;
    uploadScreen(surface);
    const material = surface.material;
    material.emissiveMap = null;
    material.emissiveIntensity = 0;
    material.diffuse.fromString("#ffffff");
    material.diffuseMap = surface.texture;
    material.diffuseMapTiling.set(tilesX, tilesZ);
    material.gloss = 0.21;
    material.update();
    return material;
  }

  function openGraphStage(id: string, title: string, nodes: SpatialNode[], edges: SpatialEdge[], diagram?: SpaceDiagram): GraphStage {
    closeInspect();
    if (isLocked()) document.exitPointerLock();
    stopAuto();
    char.enabled = false;
    sun.light!.intensity = 1.02;
    fill.light!.intensity = 0.39;
    app.scene.ambientLight.fromString("#969488");
    const root = new pc.Entity("spatial-graph");
    root.setPosition(0, 0, stageDepth);
    app.root.addChild(root);
    const textures: Screen[] = [];
    const floor = (tilesX: number, tilesZ: number) => studioStone(tilesX, tilesZ, textures);
    const view = diagram?.kind === "sequence"
      ? renderSpatialSequence(root, nodes, edges, part, materialFor, app.graphicsDevice, addContactShadow, floor)
      : renderSpatialGraph(
        root, nodes, edges, part, materialFor,
        (parent, icon, height, fallback) => mountPack(parent, `icon-${icon}`, height, 0, fallback),
        diagram?.kind, app.graphicsDevice, addContactShadow, floor
      );
    const labels: LabelPoint[] = [];
    const targets: GraphStage["targets"] = new Map();
    const entityMap = diagram?.kind === "erd" || diagram?.kind === "class";
    const entityFields = entityMap ? new Map(diagram.nodes.map(({ id, fields }) => [id, fields ?? []])) : undefined;
    for (const node of nodes) {
      if (entityFields) addEntityTablePlate(root, node, entityFields.get(node.id) ?? [], textures, diagram?.kind === "class");
      else if (node.y === undefined && diagram?.kind !== "matrix") addGraphNameplate(root, node, textures);
      const ref = `stage:${id}:node:${node.id}`;
      labels.push({
        world: "stage", id: ref, ref, x: node.x, y: node.y !== undefined ? node.y + 0.31 : (node.visualHeight ?? 1.85) + 0.1,
        z: stageDepth + node.z - (entityMap ? node.depth / 2 + 0.20 : 0), text: node.label, range2: Infinity, minor: false
      });
      targets.set(ref, {
        node,
        focus: { kind: "node", ref, title: node.label, summary: node.summary, sourcePath: node.source?.path, source: node.source }
      });
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const [index, link] of view.linkShapes.entries()) {
      const { edge, label } = link;
      const from = byId.get(edge.from)!.label;
      const to = byId.get(edge.to)!.label;
      const ref = `stage:${id}:edge:${edge.id}`;
      const badge = diagram?.kind === "matrix";
      if (edge.label || badge) labels.push({
        world: "stage", id: ref, ref, x: label.x, y: label.y ?? 0.38, z: stageDepth + label.z,
        text: badge ? String(index + 1) : edge.label!, range2: Infinity, minor: true, badge
      });
      if (entityMap && edge.cardinality) {
        for (const side of ["from", "to"] as const) {
          const start = side === "from" ? link.points[0] : link.points.at(-1)!;
          const next = side === "from" ? link.points[1] : link.points.at(-2)!;
          const fraction = Math.min(0.42, 0.62 / Math.hypot(next.x - start.x, next.z - start.z));
          labels.push({ world: "stage", id: `${ref}:${side}`, ref, x: start.x + (next.x - start.x) * fraction,
            y: 0.61, z: stageDepth + start.z + (next.z - start.z) * fraction, text: edge.cardinality[side], range2: Infinity, minor: true });
        }
      }
      targets.set(ref, {
        edge: edge.id,
        line: link.points,
        focus: { kind: "edge", ref, title: edge.label ?? `${from} → ${to}`, summary: edge.detail ?? (edge.label ? `${from} → ${to}` : undefined), sourcePath: edge.source?.path, source: edge.source }
      });
    }
    for (const [index, group] of view.groupLabels.entries()) {
      labels.push({
        world: "stage", id: `stage:${id}:group:${index}`, x: group.x, y: 0.7, z: stageDepth + group.z,
        text: group.label, range2: Infinity, minor: false
      });
    }
    const fitPoints = labels.map(({ x, y, z }) => ({ x, y, z: z - stageDepth }));
    for (const node of nodes) {
      for (const x of [node.x - node.width * 0.56, node.x + node.width * 0.56]) {
        for (const z of [node.z - node.depth * 0.58, node.z + node.depth * 0.58]) {
          fitPoints.push({ x, y: node.y === undefined ? 0.12 : node.y + 0.36, z });
          fitPoints.push({ x, y: node.y === undefined ? (node.visualHeight ?? 1.85) + 0.15 : 0, z });
        }
      }
    }
    for (const link of view.linkShapes) {
      fitPoints.push(...link.points.map(({ x, y, z }) => ({ x, y: y ?? 0.28, z })));
    }
    if (!fitPoints.length) fitPoints.push({ x: view.x, y: 0, z: view.z });
    root.name = title;
    graphStage = {
      root, view, labels, textures, fitPoints, targets, zoom: 1, yaw: diagram?.kind === "sequence" || entityMap ? 0 : -0.22, diagram,
      sequence: diagram?.kind === "sequence" && edges.length ? { edges, step: 0, progress: 1, playing: false } : undefined
    };
    return graphStage;
  }

  function emitSpatialDiagram(): void {
    const stage = graphStage;
    const diagram = stage?.diagram;
    if (!stage || !diagram) return;
    const sequence = stage.sequence;
    const edge = sequence?.edges[sequence.step];
    if (edge) {
      stage.view.paint(edge.to, edge.id);
      stage.view.pulse(edge.id, sequence?.progress ?? 1);
    }
    cb.onInspect({
      diagramId: diagram.id, title: diagram.title, kind: diagram.kind, owner: diagram.owner, spatial: true,
      playing: sequence?.playing ?? false, step: sequence?.step ?? 0, steps: sequence?.edges.length ?? 0,
      caption: edge?.label, source: edge?.source ?? diagram.source, topDown: stage.topDown
    });
  }

  const edgeKey = (from: string, to: string): string => `${from}\u0000${to}`;
  const replayEdge = (): string | undefined => {
    if (!replaySession || replaySession.step === 0) return undefined;
    const { trace, step, edgeByPair } = replaySession;
    return edgeByPair.get(edgeKey(trace.steps[step - 1].id, trace.steps[step].id));
  };

  function emitReplay(): void {
    if (!replaySession || !graphStage) return;
    const { flow, trace, traces, step, playing, progress, edgeByPair } = replaySession;
    const node = trace.steps[step];
    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    for (let i = 0; i < step; i++) {
      visitedNodes.add(trace.steps[i].id);
      if (i === 0) continue;
      const edge = edgeByPair.get(edgeKey(trace.steps[i - 1].id, trace.steps[i].id));
      if (edge !== undefined) visitedEdges.add(edge);
    }
    graphStage.view.paint(node.id, replayEdge(), visitedNodes, visitedEdges);
    graphStage.view.pulse(replayEdge(), progress);
    cb.onReplay?.({
      flowId: flow.id,
      title: flow.title,
      scenarioId: trace.id,
      scenarios: traces.map(({ id, title, summary }) => ({ id, title, summary })),
      summary: trace.summary,
      playing,
      step,
      stepId: node.point.id,
      steps: trace.steps.length,
      timeline: trace.steps.map(({ point }) => ({ caption: point.caption ?? point.actor ?? point.ref, actor: point.actor })),
      caption: node.point.caption ?? node.point.actor ?? node.point.ref,
      actor: node.point.actor,
      detail: node.point.detail,
      state: node.point.state,
      source: node.point.source ?? flow.source,
      finished: step === trace.steps.length - 1 && progress >= 1 && !playing
    });
  }

  function openReplay(flowId: string, selection?: ReplaySelection): boolean {
    const flow = flowById.get(flowId);
    if (!flow) return false;
    const replay = buildFlowReplay(flow);
    const cursor = selectReplayCursor(replay.traces, selection);
    if (!cursor) return false;
    const { trace, step } = cursor;
    const buildingId = flow.scope.startsWith("module:") ? flow.scope.slice(7) : undefined;
    if (buildingId && interiorByBuilding.has(buildingId) && activeInteriorId !== buildingId) enterInterior(buildingId);
    if (!buildingId && mode === "interior") exitInterior();
    const edgeByPair = new Map<string, string>();
    const edges = replay.edges.map((edge, i) => {
      const id = String(i);
      edgeByPair.set(edgeKey(edge.from, edge.to), id);
      return { ...edge, id };
    });
    const entry = new Set(replay.traces.map((item) => item.steps[0].id));
    const hasNext = new Set(edges.map((edge) => edge.from));
    const actorKey = (value: string): string => value.trim().normalize("NFKC").toLowerCase();
    const actorIcons = new Map<string, string>();
    for (const diagram of space.diagrams) {
      if (diagram.owner !== (buildingId ?? "city") || diagram.kind !== "graph") continue;
      for (const node of diagram.nodes) {
        if (node.icon && !actorIcons.has(actorKey(node.label))) actorIcons.set(actorKey(node.label), node.icon);
      }
    }
    const nodes = replay.nodes.map((node) => {
      const label = node.point.caption ?? node.point.actor ?? node.point.ref;
      const kind = node.decision ? "decision" : entry.has(node.id) ? "initial" : hasNext.has(node.id) ? "service" : "terminal";
      return {
        ...node,
        width: node.decision ? 1.7 : 2.95,
        depth: node.decision ? 1.7 : 1.38,
        label,
        summary: node.point.detail,
        kind,
        icon: node.point.actor ? actorIcons.get(actorKey(node.point.actor)) : undefined,
        source: node.point.source ?? flow.source
      };
    });
    openGraphStage(`flow:${flow.id}`, flow.title, nodes, edges);
    replaySession = { flow, traces: replay.traces, trace, edgeByPair, step, progress: step > 0 ? 1 : 0, playing: false };
    emitReplay();
    return true;
  }

  function seekReplay(stepIndex: number): void {
    if (!replaySession || !Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= replaySession.trace.steps.length) return;
    replaySession.step = stepIndex;
    replaySession.progress = 1;
    replaySession.playing = false;
    emitReplay();
  }

  const diagramForBuilding = (buildingId: string): SpaceDiagram | undefined =>
    space.diagrams.find((d) => d.owner === buildingId && d.kind === "graph") ??
    space.diagrams.find((d) => d.owner === buildingId) ??
    space.diagrams.find((d) => d.owner.startsWith(`${buildingId}:`));

  /** Every diagram kind opens on the walkable stage. */
  function openDiagramPanel(diagram: SpaceDiagram): void {
    const lay = layout.diagrams[diagram.id];
    if (!lay) return;
    const graph = diagram.kind === "sequence" ? spatialSequence(diagram) : spatialDiagram(diagram, lay);
    openGraphStage(`diagram:${diagram.id}`, diagram.title, graph.nodes, graph.edges, diagram);
    emitSpatialDiagram();
  }

  function openInspect(buildingId: string): void {
    const lb = lBuildingById.get(buildingId);
    const diagram = diagramForBuilding(buildingId);
    if (!lb || !diagram) return;
    if (activeInteriorId !== buildingId) applyShotAngle(buildingId);
    openDiagramPanel(diagram);
  }

  function closeInspect(): void {
    closeGraphStage();
    cb.onInspect(null);
  }

  // --- interiors -----------------------------------------------------------------------
  let interiorIndex = 0;
  let mode: "city" | "interior" = "city";
  let activeWorld = "city";
  const passageZ = 6.9;
  let activeInteriorId: string | null = null;
  let cityReturn: { x: number; z: number } | null = null;
  let indoorLocation: "lobby" | "floor" | "corridor" | null = null;
  let corridorReturn: { x: number; z: number } | null = null;
  let interiorStone: pc.StandardMaterial | undefined;
  const lobbySpawnZ = (lobby: InteriorLayout["lobby"]): number => lobby.rect.z + Math.min(4.9, lobby.rect.d * 0.28);
  const corridorDepth = (interior: InteriorLayout): number =>
    Math.max(90, ...interior.floors.map((floor) => floor.rect.z + floor.rect.d + 15));

  function updateIndoorLocation(): void {
    if (!cb.onInteriorLocation) return;
    const building = activeInteriorId ? interiorRootByBuilding.get(activeInteriorId) : undefined;
    const il = activeInteriorId ? layout.interiors[activeInteriorId] : undefined;
    let location: typeof indoorLocation = null;
    if (building && il && mode === "interior") {
      const x = charX - building.originX;
      const lobby = il.lobby.rect;
      location = charZ >= corridorDepth(il) - 8 ? "corridor"
        : x >= lobby.x && x <= lobby.x + lobby.w && charZ >= lobby.z && charZ <= lobby.z + lobby.d ? "lobby" : "floor";
    }
    if (location !== indoorLocation) {
      indoorLocation = location;
      cb.onInteriorLocation(location);
    }
  }

  function buildInterior(buildingId: string): { root: pc.Entity; originX: number; built: boolean; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } } {
    const existing = interiorRootByBuilding.get(buildingId);
    if (existing?.built) return existing;
    const il: InteriorLayout | undefined = layout.interiors[buildingId];
    const interior = interiorByBuilding.get(buildingId);
    const meta = buildingById.get(buildingId);
    const originX = 5000 + interiorIndex++ * 600;
    const root = new pc.Entity(`interior:${buildingId}`);
    root.setPosition(originX, 0, 0);
    root.enabled = false;
    app.root.addChild(root);
    const world = `int:${buildingId}`;
    const entry = { root, originX, built: true, bounds: { minX: originX - 60, maxX: originX + 260, minZ: -40, maxZ: 200 } };
    interiorRootByBuilding.set(buildingId, entry);
    if (!il || !interior || !meta) return entry;

    const wallMat = materialFor("#ddd1be", "#d0b491", 0.11, "limestone");
    const floorMat = interiorStone ??= studioStone(10, 8, screens);
    const wood = materialFor("#a78565", "#b38a60", 0.16);
    const frame = materialFor("#65766e");
    const glazing = materialFor("#a7c9cc", "#c4e4e5", 0.31, "glazing");
    const lob = il.lobby;
    const passageHalfWidth = 1.65;
    const roomAreas: NonNullable<ReturnType<typeof surfaces.get>> = [];
    surfaces.set(world, roomAreas);
    const wall = (w: number, h: number, d: number, x: number, z: number): void => {
      part(root, "box", w, h, d, x, h / 2, z, wallMat);
      addSolid(world, originX + x, z, w, d, h, "interior wall");
    };

    const roomShell = (
      rect: { x: number; z: number; w: number; d: number },
      connects: { left?: boolean; right?: boolean; entrance?: number }
    ): void => {
      roomAreas.push({ kind: "rect", ...rect, x: originX + rect.x });
      part(root, "box", rect.w, 0.2, rect.d, rect.x + rect.w / 2, -0.1, rect.z + rect.d / 2, floorMat);
      const h = 4.2;
      const ceiling = materialFor("#e1d4c1", "#c6ae8f", 0.26);
      const light = materialFor("#f5e8cf", "#fff0c6", 0.61);
      part(root, "box", rect.w, 0.14, rect.d, rect.x + rect.w / 2, h + 0.07, rect.z + rect.d / 2, ceiling);
      part(root, "box", rect.w - 0.6, 0.17, 0.25, rect.x + rect.w / 2, h - 0.08, rect.z + rect.d - 0.21, wood);
      part(root, "box", rect.w - 0.6, 0.025, 0.055, rect.x + rect.w / 2, h - 0.18, rect.z + rect.d - 0.36, light);
      for (const x of [rect.x + rect.w * 0.28, rect.x + rect.w * 0.72]) {
        for (let z = rect.z + 3.3; z < rect.z + rect.d - 2; z += 5.1) {
          part(root, "box", 1.9, 0.07, 0.15, x, h - 0.065, z, light);
        }
      }
      wall(rect.w, h, 0.25, rect.x + rect.w / 2, rect.z + rect.d);
      part(root, "box", rect.w - 0.28, 0.17, 0.11, rect.x + rect.w / 2, 0.085, rect.z + rect.d - 0.15, wood);
      for (const [side, connected] of [[rect.x, connects.left], [rect.x + rect.w, connects.right]] as const) {
        if (!connected) {
          wall(0.25, h, rect.d, side, rect.z + rect.d / 2);
          continue;
        }
        const near = passageZ - passageHalfWidth - rect.z;
        const far = rect.z + rect.d - passageZ - passageHalfWidth;
        wall(0.25, h, near, side, rect.z + near / 2);
        wall(0.25, h, far, side, rect.z + rect.d - far / 2);
        part(root, "box", 0.35, h - 2.9, passageHalfWidth * 2, side, (h + 2.9) / 2, passageZ, wallMat);
        for (const direction of [-1, 1]) {
          const z = passageZ + direction * (passageHalfWidth + 0.10);
          part(root, "box", 0.42, 2.92, 0.21, side, 1.46, z, wood);
          part(root, "box", 0.06, 2.14, 0.045, side + (side === rect.x ? 0.24 : -0.24), 1.64, z, light);
        }
        part(root, "box", 0.42, 0.23, passageHalfWidth * 2 + 0.4, side, 2.96, passageZ, wood);
      }
      const entrance = connects.entrance;
      if (entrance === undefined) wall(rect.w, h, 0.25, rect.x + rect.w / 2, rect.z);
      else {
        const leftW = Math.max(0.1, entrance - 1.4 - rect.x);
        const rightW = Math.max(0.1, rect.x + rect.w - entrance - 1.4);
        wall(leftW, h, 0.25, rect.x + leftW / 2, rect.z);
        wall(rightW, h, 0.25, rect.x + rect.w - rightW / 2, rect.z);
        part(root, "box", 2.8, h - 3.1, 0.25, entrance, (h + 3.1) / 2, rect.z, wallMat);
      }
      const windows = Math.min(7, Math.max(2, Math.floor(rect.w / 4)));
      for (let i = 0; i < windows; i++) {
        const windowX = rect.x + (i + 0.5) * rect.w / windows;
        const width = rect.w / windows - 0.31;
        part(root, "box", width, 2.36, 0.11, windowX, 2.17, rect.z + rect.d - 0.18, frame);
        part(root, "box", width - 0.15, 2.18, 0.04, windowX, 2.17, rect.z + rect.d - 0.25, glazing);
        part(root, "box", width - 0.08, 0.06, 0.09, windowX, 2.14, rect.z + rect.d - 0.28, frame);
        part(root, "box", 0.058, 2.17, 0.07, windowX, 2.17, rect.z + rect.d - 0.28, frame);
        part(root, "box", width + 0.08, 0.11, 0.3, windowX, 0.96, rect.z + rect.d - 0.23, wood);
      }
    };
    const passage = (left: number, right: number): void => {
      const width = right - left;
      const depth = passageHalfWidth * 2;
      const x = (left + right) / 2;
      roomAreas.push({ kind: "rect", x: originX + left - 0.12, z: passageZ - passageHalfWidth, w: width + 0.24, d: depth });
      part(root, "box", width + 0.16, 0.2, depth, x, -0.1, passageZ, floorMat);
      part(root, "box", width, 0.014, 0.47, x, 0.015, passageZ, materialFor("#7bab9e"));
      for (const side of [-1, 1]) {
        const z = passageZ + side * passageHalfWidth;
        wall(width, 1.05, 0.15, x, z);
        const bays = Math.max(2, Math.ceil(width / 2.7));
        const bay = width / bays;
        for (let i = 0; i < bays; i++) {
          const px = left + (i + 0.5) * bay;
          part(root, "box", bay - 0.09, 1.77, 0.075, px, 1.96, z, glazing);
          part(root, "box", 0.08, 1.91, 0.14, px - bay / 2, 1.98, z, frame);
        }
        part(root, "box", width, 0.12, 0.19, x, 1.03, z, wood);
        part(root, "box", width, 0.10, 0.15, x, 2.87, z, frame);
      }
      part(root, "box", width, 0.12, depth, x, 3.36, passageZ, materialFor("#e4d8c5", "#c6ae8f", 0.42));
      part(root, "box", width * 0.75, 0.07, 0.19, x, 3.24, passageZ, materialFor("#f4e8d6", "#f3d5a6", 0.66));
    };

    roomShell(lob.rect, { entrance: lob.entry.x, right: il.floors.length > 0 });

    // Reception.
    // Persisted city layouts can still place the desk in the arrival lane.
    const receptionX = Math.abs(lob.reception.x - lob.entry.x) < 2.6 ? lob.rect.x + lob.rect.w * 0.28 : lob.reception.x;
    const rec = new pc.Entity("reception");
    rec.setPosition(receptionX, 0, lob.reception.z);
    root.addChild(rec);
    part(rec, "box", 3, 1.05, 0.9, 0, 0.52, 0, materialFor("#cfc8ba"));
    part(rec, "box", 3.2, 0.1, 1.1, 0, 1.12, 0, materialFor("#b9a98c"));
    part(rec, "box", 3, 0.3, 0.08, 0, 0.6, 0.47, materialFor("#123a36", DAY.teal, 0.5));
    mountPack(rec, "reception-desk", 2.4, 0, childrenOf(rec));
    addSolid(world, originX + receptionX, lob.reception.z, 3.2, 1.1, 1.18, "reception desk");
    addContactShadow(root, receptionX + 0.14, lob.reception.z + 0.14, 4.3, 2.3);

    const guideMark = materialFor("#7aaca0");
    if (il.floors.length) {
      const start = { x: lob.entry.x, z: lobbySpawnZ(lob) };
      const entryX = lob.rect.x + lob.rect.w;
      const finish = { x: entryX, z: passageZ };
      const yaw = Math.atan2(finish.x - start.x, finish.z - start.z) * 180 / Math.PI;
      const distance = Math.hypot(finish.x - start.x, finish.z - start.z);
      const steps = Math.ceil(distance / 1.35);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const arrow = new pc.Entity("workshop-wayfinding");
        arrow.setLocalPosition(start.x + t * (finish.x - start.x), 0.014, start.z + t * (finish.z - start.z));
        arrow.setLocalEulerAngles(0, yaw, 0);
        root.addChild(arrow);
        for (const side of [-1, 1]) {
          const leg = part(arrow, "box", 0.085, 0.015, 0.27, side * 0.09, 0, 0, guideMark);
          leg.setLocalEulerAngles(0, -side * 42, 0);
        }
      }
      const sign = makeScreen(640, 116, true);
      sign.material.useLighting = false;
      sign.material.update();
      sign.ctx.fillStyle = "#f1e7d0";
      sign.ctx.fillRect(0, 0, 640, 116);
      sign.ctx.fillStyle = "#2e5b4f";
      sign.ctx.fillRect(0, 0, 12, 116);
      sign.ctx.textBaseline = "middle";
      sign.ctx.font = "750 50px system-ui, sans-serif";
      sign.ctx.fillText("Workshop", 34, 58);
      sign.ctx.fillText("→", 552, 58);
      uploadScreen(sign);
      const workshopSign = new pc.Entity("workshop-wayfinding-sign");
      workshopSign.setLocalPosition(entryX - 0.18, 3.30, passageZ);
      workshopSign.setLocalEulerAngles(0, -90, 0);
      root.addChild(workshopSign);
      part(workshopSign, "box", 3.10, 0.66, 0.12, 0, 0, 0, frame, "workshop-sign-frame");
      addSignFace(workshopSign, 2.98, 0.54, 0, 0, 0.12, 1, sign, "workshop-sign-face");
    }

    const localDiagram = diagramForBuilding(buildingId);
    const localFlow = interior.lobby.catalogRefs.map((id) => flowById.get(id)).find(Boolean);
    const coveredDoc = interior.lobby.coverageRefs.map((index) => space.meta.coverage[index]).find(Boolean);
    const question = space.assessment?.questions.find((item) => item.building === buildingId);
    const stops: { tab: "diagrams" | "flows" | "docs" | "learn"; label: string; color: string; source?: SpaceSource }[] = [
      { tab: "diagrams", label: "Architecture", color: "#36776e", source: localDiagram?.source },
      { tab: "flows", label: "Workflows", color: "#2b788d", source: localFlow?.source },
      { tab: "docs", label: "Docs", color: "#916633", source: coveredDoc ? { path: coveredDoc.doc } : undefined },
      { tab: "learn", label: "Learning", color: "#527353", source: question?.source }
    ];
    const side = lob.rect.x + lob.rect.w;
    const directoryZ = Math.min(lob.rect.z + lob.rect.d - 4.3, passageZ + 6.2);
    part(root, "box", 0.21, 2.65, 8.65, side - 0.2, 1.77, directoryZ, wood);
    part(root, "box", 0.17, 0.19, 8.72, side - 0.31, 3.15, directoryZ, materialFor("#ede0c2", "#ead7a9", 0.38));
    const lobbyWash = new pc.Entity("directory-wall-wash");
    lobbyWash.setLocalPosition(side - 1.55, 3.72, directoryZ);
    lobbyWash.addComponent("light", { type: "omni", range: 7.8, intensity: 0.31, color: new pc.Color().fromString("#efd0a3") });
    root.addChild(lobbyWash);
    addContactShadow(root, side - 0.52, directoryZ, 1.65, 8.65);
    const directoryFrame = new pc.Entity("lobby-directory-heading");
    directoryFrame.setPosition(side - 0.25, 0, directoryZ);
    directoryFrame.setLocalEulerAngles(0, -90, 0);
    root.addChild(directoryFrame);
    const heading = makeScreen(832, 100, true);
    heading.material.useLighting = false;
    heading.material.update();
    heading.ctx.fillStyle = "#e8dcc3";
    heading.ctx.fillRect(0, 0, heading.canvas.width, heading.canvas.height);
    heading.ctx.fillStyle = "#284036";
    heading.ctx.textBaseline = "top";
    const headingFont = (size: number) => `750 ${size}px system-ui, sans-serif`;
    const headingCopy = fitDisplayCopy(meta.title, 748, 84, 61, (text, size) => {
      heading.ctx.font = headingFont(size);
      return heading.ctx.measureText(text).width;
    });
    heading.ctx.font = headingFont(headingCopy.size);
    const headingTop = (100 - headingCopy.lines.length * headingCopy.leading) / 2;
    for (const [index, line] of headingCopy.lines.entries()) heading.ctx.fillText(line, 42, headingTop + index * headingCopy.leading);
    uploadScreen(heading);
    part(directoryFrame, "box", 8.06, 0.91, 0.15, 0, 3.59, 0.04, frame);
    addSignFace(directoryFrame, 7.94, 0.79, 3.59, 0.04, 0.15, 1, heading, "lobby-directory-title");
    for (const direction of [-1, 1]) {
      part(root, "box", 0.19, 3.53, 0.12, side - 0.28, 1.97, directoryZ + direction * 4.36, frame);
    }
    for (const [index, stop] of stops.entries()) {
      const x = side - 0.32;
      const z = directoryZ + (index - 1.5) * 2.03;
      const screen = makeScreen(384, 125, true);
      screen.material.useLighting = false;
      screen.material.update();
      const { ctx } = screen;
      ctx.fillStyle = "#f4eedf";
      ctx.fillRect(0, 0, 384, 125);
      ctx.fillStyle = stop.color;
      ctx.fillRect(0, 0, 384, 11);
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.fillText(`0${index + 1}`, 22, 43);
      ctx.fillStyle = "#243534";
      ctx.font = "700 48px system-ui, sans-serif";
      ctx.fillText(stop.label, 22, 99, 336);
      uploadScreen(screen);
      part(root, "box", 0.09, 1.38, 1.87, x, 1.79, z, frame);
      const plaque = new pc.Entity("lobby-directory-plaque");
      plaque.setLocalPosition(x, 0, z);
      plaque.setLocalEulerAngles(0, -90, 0);
      root.addChild(plaque);
      addSignFace(plaque, 1.72, 1.20, 1.79, 0, 0.09, 1, screen, "lobby-directory-action");
      interactables.push({
        world, x: x - 0.52, z, radius: 1.35,
        focus: { kind: "directory", ref: `directory:${buildingId}:${stop.tab}`, title: stop.label, hint: "open", source: stop.source, sourcePath: stop.source?.path },
        action: () => {
          if (stop.tab === "diagrams" && localDiagram) openInspect(buildingId);
          else if (stop.tab === "flows" && localFlow && interior.lobby.catalogRefs.length === 1) openReplay(localFlow.id);
          else cb.onOpenDirectory?.(stop.tab);
        }
      });
    }

    // Centerpiece pedestal.
    part(root, "box", 1.6, 0.9, 1.6, lob.centerpiece.x, 0.45, lob.centerpiece.z, materialFor("#cfc8ba"));
    addContactShadow(root, lob.centerpiece.x + 0.14, lob.centerpiece.z + 0.14, 2.6, 2.6);
    addSolid(world, originX + lob.centerpiece.x, lob.centerpiece.z, 1.6, 1.6, 0.9, "lobby centerpiece");
    const exhibit = new pc.Entity("lobby-exhibit");
    exhibit.setLocalPosition(lob.centerpiece.x, 0.91, lob.centerpiece.z);
    root.addChild(exhibit);
    const focalRole = localDiagram?.nodes.find((node) => node.icon)?.icon;
    const marks = focalRole ? renderIconGlyph(exhibit, focalRole, 0.64, part, materialFor) : [];
    if (!focalRole) {
      const gem = part(exhibit, "box", 0.7, 0.7, 0.7, 0, 0.74, 0, materialFor("#123a36", accentOf(buildingId), 0.8), "gem");
      gem.setLocalEulerAngles(35, 45, 0);
      spinners.push(gem);
    }
    const exhibitLight = new pc.Entity("exhibit-light");
    exhibitLight.setLocalPosition(lob.centerpiece.x - 1.1, 3.05, lob.centerpiece.z + 0.6);
    exhibitLight.addComponent("light", {
      type: "omni", range: 4, intensity: 0.85, color: new pc.Color().fromString("#fff1d7")
    });
    root.addChild(exhibitLight);
    const buildingOverlays = overlaysByBuilding.get(buildingId) ?? [];
    if (focalRole && !buildingOverlays.some(({ class: kind }) => kind === "centerpiece")) {
      mountPack(exhibit, `icon-${focalRole}`, 1.55, 0, marks);
    }
    for (const ov of buildingOverlays) {
      if (ov.class === "centerpiece") {
        const cp = new pc.Entity("overlay-centerpiece");
        cp.setPosition(lob.centerpiece.x, 0, lob.centerpiece.z);
        root.addChild(cp);
        mountContainer(containerAsset(`url:${ov.url}`, ov.url), cp, 1.7, 0.896, [exhibit], {
          fit: { w: 1.52, h: 1.7, d: 1.52 },
          onFit: () => exhibits.push(cp)
        });
      } else if (ov.class === "icon") {
        const ic = new pc.Entity("overlay-icon");
        ic.setPosition(lob.entry.x, 3.3, lob.entry.z + 1.6);
        root.addChild(ic);
        mountUrl(ic, ov.url, 1.1, 0, []);
        spinners.push(ic);
      }
    }
    interactables.push({
      world,
      x: lob.centerpiece.x,
      z: lob.centerpiece.z,
      radius: 2.4,
      focus: { kind: "centerpiece", ref: buildingId, title: localDiagram?.title ?? meta.title, summary: meta.summary,
        sourcePath: localDiagram?.source?.path ?? meta.source?.path, source: localDiagram?.source ?? meta.source,
        hint: localDiagram ? "open diagram" : undefined },
      action: localDiagram ? () => openInspect(buildingId) : undefined
    });

    for (const p of lob.plants) {
      const pe = new pc.Entity("plant");
      pe.setPosition(p.x, 0, p.z);
      root.addChild(pe);
      part(pe, "cylinder", 0.5, 0.5, 0.5, 0, 0.25, 0, materialFor("#b5a888"));
      part(pe, "sphere", 1, 1.1, 1, 0, 1.1, 0, materialFor(DAY.leaf));
      mountPack(pe, "lobby-plant", 1.6, 0, childrenOf(pe));
      addSolid(world, originX + p.x, p.z, 0.6, 0.6, 0.62, "planter");
      addContactShadow(root, p.x + 0.12, p.z + 0.11, 1.35, 1.28);
    }
    for (const s of lob.seating) {
      const se = new pc.Entity("sofa");
      se.setPosition(s.x, 0, s.z);
      root.addChild(se);
      part(se, "box", 2, 0.45, 0.9, 0, 0.25, 0, materialFor("#d9cfb8"));
      part(se, "box", 2, 0.6, 0.18, 0, 0.75, -0.36, materialFor("#cfc3a8"));
      const proxy = addSolid(world, originX + s.x, s.z, 2, 0.9, 1.05, "sofa");
      addContactShadow(root, s.x + 0.16, s.z + 0.16, 2.8, 1.7);
      mountPack(se, "sofa", 2.2, 0, childrenOf(se), { w: 2.2, h: 1.12, d: 1.04 }, ({ w, h, d }) => {
        proxy.halfW = w / 2;
        proxy.halfD = d / 2;
        proxy.height = h;
      });
    }

    // Reading corner on the free wall: shelves, a table and chairs that open the documents.
    // `solid` is the footprint in room axes; a long model is turned to lie along the named axis.
    const furnish = (name: string, role: string, size: number, x: number, z: number, facing: number | "along-x" | "along-z",
      solid: { w: number; d: number; h: number }, fallback: (entity: pc.Entity) => void): void => {
      const entity = new pc.Entity(name);
      entity.setPosition(x, 0, z);
      root.addChild(entity);
      fallback(entity);
      if (assets?.has(role)) {
        mountContainer(packAsset(role), entity, size, 0, childrenOf(entity), typeof facing === "number" ? { yaw: facing }
          : { chooseYaw: (w, d) => (w >= d) === (facing === "along-x") ? 0 : 90 });
      }
      addSolid(world, originX + x, z, solid.w, solid.d, solid.h, name);
      addContactShadow(root, x + 0.1, z + 0.1, solid.w + 0.5, solid.d + 0.5);
    };
    const readingZ = lob.rect.z + lob.rect.d * 0.55;
    const wallX = lob.rect.x;
    if (lob.rect.w >= 20 && Math.abs(receptionX - (wallX + 3.2)) > 3.4) {
      for (const offset of [-1.15, 1.15]) {
        furnish("bookshelf", "bookshelf", 2.2, wallX + 0.52, readingZ + offset, "along-z", { w: 0.5, d: 1.25, h: 2.2 }, (shelf) => {
          part(shelf, "box", 0.42, 2.1, 1.2, 0, 1.05, 0, wood);
          for (const y of [0.45, 0.95, 1.45]) part(shelf, "box", 0.3, 0.28, 1.06, 0.08, y, 0, materialFor("#6f9c93"));
        });
      }
      furnish("reading-table", "table-long", 2.6, wallX + 3.25, readingZ, "along-z", { w: 1.1, d: 2.6, h: 0.78 }, (table) => {
        part(table, "box", 1, 0.08, 2.5, 0, 0.74, 0, wood);
        for (const end of [-1.1, 1.1]) part(table, "box", 0.8, 0.7, 0.1, 0, 0.35, end, frame);
      });
      for (const offset of [-0.7, 0.7]) {
        furnish("reading-chair", "chair", 0.95, wallX + 4.45, readingZ + offset, -90, { w: 0.5, d: 0.5, h: 0.9 }, (chair) => {
          part(chair, "box", 0.45, 0.07, 0.45, 0, 0.46, 0, wood);
          part(chair, "box", 0.06, 0.45, 0.45, 0.2, 0.72, 0, wood);
        });
      }
      interactables.push({
        world, x: wallX + 3.25, z: readingZ, radius: 2.1,
        focus: { kind: "directory", ref: `directory:${buildingId}:docs:reading`, title: "Reading corner", hint: "open docs",
          source: coveredDoc ? { path: coveredDoc.doc } : undefined, sourcePath: coveredDoc?.doc },
        action: () => cb.onOpenDirectory?.("docs")
      });
    }
    // A standing directory by the elevator when there are floors to choose from.
    if (interior.floors.length) {
      furnish("floor-directory", "floor-sign", 1.8, lob.elevator.x + 2.5, lob.elevator.z - 0.75, "along-x", { w: 0.8, d: 0.45, h: 1.8 }, (sign) => {
        part(sign, "box", 0.7, 1.5, 0.08, 0, 0.95, 0, materialFor("#2f3d3a"));
        part(sign, "box", 0.8, 0.12, 0.4, 0, 0.06, 0, frame);
      });
    }
    // The learning stop keeps its trophy beside the plaque when this building has questions.
    if (question) {
      const trophyZ = directoryZ + 1.5 * 2.03;
      part(root, "box", 0.46, 0.6, 0.46, side - 0.72, 0.3, trophyZ, materialFor("#cfc8ba"));
      addSolid(world, originX + side - 0.72, trophyZ, 0.46, 0.46, 0.6, "learning plinth");
      const trophy = new pc.Entity("learning-trophy");
      trophy.setPosition(side - 0.72, 0.6, trophyZ);
      root.addChild(trophy);
      part(trophy, "cylinder", 0.26, 0.3, 0.26, 0, 0.15, 0, materialFor("#c9a44a", DAY.amber, 0.3));
      mountPack(trophy, "trophy", 0.48, 0, childrenOf(trophy));
    }

    // Elevator.
    const elev = new pc.Entity("elevator");
    elev.setPosition(lob.elevator.x, 0, lob.elevator.z);
    root.addChild(elev);
    part(elev, "box", 2.4, 3.4, 0.3, 0, 1.7, 0, materialFor(DAY.metal));
    part(elev, "box", 1, 2.9, 0.1, -0.55, 1.45, 0.12, materialFor("#8f9aa1"));
    part(elev, "box", 1, 2.9, 0.1, 0.55, 1.45, 0.12, materialFor("#8f9aa1"));
    mountPack(elev, "elevator-doors", 3.2, 0, childrenOf(elev));
    interactables.push({
      world,
      x: lob.elevator.x,
      z: lob.elevator.z - 1,
      radius: 2,
      focus: { kind: "elevator", ref: buildingId, title: "Elevator", hint: `${interior.floors.length}` },
      action: () => cb.onElevator(buildingId, interior.floors.map((f) => ({ id: f.id, title: f.title })))
    });
    // Exit door back to the city.
    interactables.push({
      world,
      x: lob.entry.x,
      z: lob.entry.z - 0.4,
      radius: 1.6,
      focus: { kind: "door-exit", ref: buildingId, title: meta.title, hint: "exit" },
      action: () => exitInterior()
    });

    // Corridor origins first (floor doors teleport to them).
    const corridorOrigin = new Map<string, { x: number; z: number; spawnOffset: number }>();
    let nextCorridorX = lob.rect.x + lob.rect.w + 14;
    const baseCorridorZ = corridorDepth(il);
    for (const cor of il.corridors) {
      const xs = cor.segments.flatMap((segment) => [segment.from.x, segment.to.x]);
      const x = nextCorridorX + 4 - Math.min(0, ...xs);
      corridorOrigin.set(cor.flowId, { x, z: baseCorridorZ, spawnOffset: cor.gates.some((gate) => gate.pos.z < 0) ? -3.7 : -1.1 });
      nextCorridorX = x + Math.max(0, ...xs) + 8;
    }

    // Floors, laid out to the right of the lobby.
    let floorOriginX = lob.rect.x + lob.rect.w + 14;
    il.floors.forEach((lf, fi) => {
      const fx = floorOriginX - lf.rect.x;
      passage(floorOriginX - 14, floorOriginX);
      roomShell({ x: fx + lf.rect.x, z: lf.rect.z, w: lf.rect.w, d: lf.rect.d }, { left: true, right: fi < il.floors.length - 1 });
      const sf = interior.floors[fi];
      const componentNodes = sf?.diagrams.flatMap((id) => diagramById.get(id)?.nodes ?? []) ?? [];
      interactables.push({
        world, x: floorOriginX - 1.1, z: passageZ, radius: 1.3,
        focus: { kind: "door-enter", ref: `${buildingId}:${lf.id}`, title: sf?.title ?? lf.id, hint: "workshop", source: sf?.source, sourcePath: sf?.source?.path },
        action: () => gotoFloor(buildingId, lf.id)
      });
      for (const ped of lf.pedestals) {
        const px = fx + ped.pos.x;
        const pz = ped.pos.z;
        const pe = new pc.Entity("pedestal");
        pe.setPosition(px, 0, pz);
        root.addChild(pe);
        const base = part(pe, "box", 1.1, 0.8, 1.1, 0, 0.4, 0, materialFor("#cfc8ba"));
        addSolid(world, originX + px, pz, 1.1, 1.1, 0.85, `pedestal: ${ped.label}`);
        const marker = new pc.Entity("pedestal-role");
        marker.setLocalPosition(0, 0.82, 0);
        pe.addChild(marker);
        mountPack(pe, "pedestal", 1.3, 0, [base], undefined, ({ h }) => marker.setLocalPosition(0, h + 0.02, 0));
        if (ped.icon) {
          const marks = renderIconGlyph(marker, ped.icon, 0.42, part, materialFor);
          mountPack(marker, `icon-${ped.icon}`, 0.85, 0, marks);
        } else {
          const gem = part(marker, "box", 0.55, 0.55, 0.55, 0, 0.53, 0, materialFor("#123a36", DAY.teal, 0.7), "pedestal-gem");
          gem.setLocalEulerAngles(35, 45, 0);
          spinners.push(gem);
        }
        const evidence = componentNodes.find((node) => node.label.toLocaleLowerCase() === ped.label.toLocaleLowerCase())?.source;
        if (evidence) interactables.push({
          world, x: px, z: pz, radius: 1.4,
          focus: { kind: "pedestal", ref: `ped:${buildingId}:${lf.id}:${ped.label}`, title: ped.label, source: evidence, sourcePath: evidence.path }
        });
        labelPoints.push({
          world,
          id: `ped:${buildingId}:${lf.id}:${ped.label}`,
          x: originX + px,
          y: 2.2,
          z: pz,
          text: ped.label,
          range2: 8 * 8,
          minor: true
        });
      }
      for (const { panel, z, width } of workshopExhibits(lf.panels, lf.rect, passageZ, passageHalfWidth)) {
        const diagram = diagramById.get(panel.diagramId);
        const lay = layout.diagrams[panel.diagramId];
        if (!diagram || !lay) continue;
        const wp = new pc.Entity(`panel:${panel.diagramId}`);
        wp.setPosition(fx + panel.pos.x + Math.sign(panel.pos.x) * 0.22, 2.3, z);
        wp.setEulerAngles(0, (panel.rot * 180) / Math.PI, 0);
        root.addChild(wp);
        addDiagramExhibit(wp, diagram, width, Math.min(2.2, width * 0.43), 0);
        interactables.push({
          world,
          x: fx + panel.pos.x * 0.86,
          z,
          radius: 3,
          focus: {
            kind: "panel",
            ref: panel.diagramId,
            title: diagram.title,
            summary: diagram.note,
            sourcePath: diagram.source?.path,
            source: diagram.source,
            hint: "open diagram"
          },
          action: () => openDiagramPanel(diagram)
        });
      }
      for (const st of lf.infoStands) {
        const stand = new pc.Entity("info-stand");
        stand.setPosition(fx + st.pos.x, 0, st.pos.z);
        stand.setLocalEulerAngles(0, st.rot * 180 / Math.PI, 0);
        root.addChild(stand);
        part(stand, "box", 0.20, 0.97, 0.20, 0, 0.49, 0, wood);
        const top = part(stand, "box", 1.4, 0.075, 0.60, 0, 1.01, 0, materialFor("#d1ded2", "#dce7d9", 0.18));
        top.setLocalEulerAngles(-19, 0, 0);
        mountPack(stand, "info-stand", 1.7, 0, childrenOf(stand));
      }
      lf.corridorDoors.forEach((cd) => {
        const f = flowById.get(cd.flowId);
        const frame = materialFor("#766e5c");
        for (const side of [-1, 1]) part(root, "box", 0.18, 2.8, 0.23, fx + cd.pos.x + side, 1.4, cd.pos.z, frame);
        part(root, "box", 2.18, 0.25, 0.25, fx + cd.pos.x, 2.81, cd.pos.z, frame);
        part(root, "box", 1.72, 2.51, 0.055, fx + cd.pos.x, 1.3, cd.pos.z + 0.095, materialFor("#87adad", DAY.teal, 0.16));
        part(root, "box", 0.07, 0.59, 0.10, fx + cd.pos.x + 0.63, 1.27, cd.pos.z - 0.07, frame);
        labelPoints.push({
          world,
          id: `cdoor:${buildingId}:${cd.flowId}`,
          x: originX + fx + cd.pos.x,
          y: 3.5,
          z: cd.pos.z,
          text: "⇢ Workflow",
          range2: 10 * 10,
          minor: true
        });
        const corridorStart = corridorOrigin.get(cd.flowId);
        interactables.push({
          world,
          x: fx + cd.pos.x,
          z: cd.pos.z - 0.8,
          radius: 1.8,
          focus: { kind: "door-enter", ref: `flow:${cd.flowId}`, title: f?.title ?? cd.flowId, hint: "corridor", source: f?.source, sourcePath: f?.source?.path },
          action: corridorStart
            ? () => {
              corridorReturn = { x: originX + fx + cd.pos.x, z: cd.pos.z - 1.7 };
              camPitch = 0.12;
              camDist = 3.25;
              teleportChar(originX + corridorStart.x, corridorStart.z + corridorStart.spawnOffset, originX + corridorStart.x, corridorStart.z + 4);
            }
            : undefined
        });
      });
      floorOriginX += lf.rect.w + 14;
    });

    // Corridors, laid out beyond the floors (z+).
    let maxCorZ = 0;
    for (const cor of il.corridors) {
      const origin = corridorOrigin.get(cor.flowId)!;
      const baseX = origin.x;
      const baseZ = origin.z;
      const f = flowById.get(cor.flowId);
      const pathStone = materialFor("#dedbd0");
      const accent = materialFor("#76a49a");
      for (const [index, seg] of cor.segments.entries()) {
        const len = Math.hypot(seg.to.x - seg.from.x, seg.to.z - seg.from.z);
        if (len < 0.01) continue;
        const yaw = Math.atan2(seg.to.x - seg.from.x, seg.to.z - seg.from.z) * 180 / Math.PI;
        maxCorZ = Math.max(maxCorZ, seg.from.z, seg.to.z);
        roomAreas.push({
          kind: "segment", width: 3.4,
          from: { x: originX + baseX + seg.from.x, z: baseZ + seg.from.z },
          to: { x: originX + baseX + seg.to.x, z: baseZ + seg.to.z }
        });
        const sPart = part(
          root,
          "box",
          3.4,
          0.14,
          len + 3.2,
          baseX + (seg.from.x + seg.to.x) / 2,
          -0.07,
          baseZ + (seg.from.z + seg.to.z) / 2,
          pathStone,
          "corridor"
        );
        sPart.setLocalEulerAngles(0, yaw, 0);
        const line = part(root, "box", 0.11, 0.012, len, baseX + (seg.from.x + seg.to.x) / 2,
          0.015 + index * 0.0001, baseZ + (seg.from.z + seg.to.z) / 2, accent);
        line.setLocalEulerAngles(0, yaw, 0);
      }
      const exitZ = baseZ - 5.1;
      part(root, "box", 0.14, 2.4, 0.17, baseX - 1.39, 1.2, exitZ, materialFor("#817765"));
      part(root, "box", 0.14, 2.4, 0.17, baseX + 1.39, 1.2, exitZ, materialFor("#817765"));
      part(root, "box", 2.92, 0.19, 0.18, baseX, 2.36, exitZ, materialFor("#817765"));
      labelPoints.push({ world, id: `return:${cor.flowId}`, x: originX + baseX, y: 2.65, z: exitZ, text: "← Workshop", range2: 16 * 16, minor: false });
      interactables.push({
        world, x: baseX, z: exitZ + 0.25, radius: 1.35,
        focus: { kind: "door-enter", ref: `return:${cor.flowId}`, title: "Back to workshop", hint: "workshop" },
        action: () => {
          const back = corridorReturn;
          if (!back) return;
          corridorReturn = null;
          camPitch = 0.12;
          camDist = 3.3;
          teleportChar(back.x, back.z, back.x, back.z - 4);
        }
      });
      labelPoints.push({
        world,
        id: `cor:${cor.flowId}`,
        x: originX + baseX,
        y: 3.6,
        z: baseZ - 4,
        text: f ? `FLOW — ${f.title}` : cor.flowId,
        range2: 60 * 60,
        minor: false
      });
      cor.stations.forEach((st, si) => {
        const sx = baseX + st.pos.x;
        const sz = baseZ + st.pos.z;
        part(root, "box", 1, 0.7, 1, sx + 1.6, 0.35, sz, materialFor("#cfc8ba"));
        part(root, "box", 0.5, 0.5, 0.5, sx + 1.6, 1.1, sz, materialFor("#123a36", DAY.teal, 0.7));
        let point = f?.path[si];
        if (f && si >= f.path.length) {
          let branchIndex = si - f.path.length;
          for (const branch of f.branches ?? []) {
            if (branchIndex < branch.path.length) {
              point = branch.path[branchIndex];
              break;
            }
            branchIndex -= branch.path.length;
          }
        }
        labelPoints.push({
          world,
          id: `st:${cor.flowId}:${si}`,
          x: originX + sx + 1.6,
          y: 2.1,
          z: sz,
          text: `${st.stepIndex + 1}. ${st.caption ?? point?.caption ?? point?.ref ?? ""}`.slice(0, 80),
          range2: 16 * 16,
          minor: true
        });
        interactables.push({
          world,
          x: sx,
          z: sz,
          radius: 1.6,
          focus: {
            kind: "station",
            ref: `${cor.flowId}:${point?.id ?? si}`,
            title: st.caption ?? point?.caption ?? `Step ${st.stepIndex + 1}`,
            summary: st.branch ? `Branch: ${st.branch}` : undefined,
            hint: f && point?.id ? "playback" : undefined,
            sourcePath: point?.source?.path ?? f?.source?.path,
            source: point?.source ?? f?.source
          },
          action: f && point?.id ? () => openReplay(f.id, { stepId: point.id }) : undefined
        });
      });
      cor.forks.forEach((fk, index) => {
        part(root, "box", 0.18, 2.4, 0.18, baseX + fk.pos.x - 1.4, 1.2, baseZ + fk.pos.z, materialFor(DAY.metal));
        part(root, "box", 2.4, 0.8, 0.1, baseX + fk.pos.x - 1.4, 2.6, baseZ + fk.pos.z, materialFor("#123a36", DAY.amber, 0.5));
        labelPoints.push({
          world,
          id: `fork:${cor.flowId}:${index}`,
          x: originX + baseX + fk.pos.x - 1.4,
          y: 3.3,
          z: baseZ + fk.pos.z,
          text: `? ${fk.condition}`,
          range2: 20 * 20,
          minor: true
        });
      });
      cor.gates.forEach((gt, gi) => {
        const gx = baseX + gt.pos.x;
        const gz = baseZ + gt.pos.z;
        const gRoot = new pc.Entity(`gate:${cor.flowId}:${gi}`);
        gRoot.setPosition(gx, 0, gz);
        root.addChild(gRoot);
        part(gRoot, "box", 0.3, 1.6, 0.3, -1.6, 0.8, 0, materialFor(DAY.metal));
        part(gRoot, "box", 0.3, 1.6, 0.3, 1.6, 0.8, 0, materialFor(DAY.metal));
        const bar = part(gRoot, "box", 3.1, 0.18, 0.18, 0, 1.1, 0, materialFor("#5a4420", DAY.amber, 0.8), "bar");
        const packGate = Boolean(assets?.has("gate-checkpoint"));
        if (packGate) {
          // The barrier spans the walkway whichever way the model was authored.
          mountContainer(packAsset("gate-checkpoint"), gRoot, 3.3, 0, childrenOf(gRoot),
            { chooseYaw: (w, d) => w >= d ? 0 : 90, fit: { w: 3.3, h: 1.6, d: 1.2 } });
        }
        const gateSolid = addSolid(world, originX + gx, gz, 3.16, 0.18, 1.19, "branch gate");
        const condition = cor.forks[gt.beforeForkIndex]?.condition ?? "checkpoint";
        interactables.push({
          world,
          x: gx,
          z: gz,
          radius: 1.8,
          focus: { kind: "gate", ref: cor.flowId, title: condition, hint: "open" },
          action: () => {
            bar.setLocalEulerAngles(0, 0, 80);
            bar.setLocalPosition(1.45, 1.7, 0);
            // The pack model is one piece, so an opened gate swings aside along the walkway.
            if (packGate) {
              gRoot.setLocalEulerAngles(0, 90, 0);
              gRoot.setLocalPosition(gx + 1.75, 0, gz + 1.6);
            }
            gateSolid.active = false;
          },
          entity: gRoot
        });
      });
    }

    entry.bounds = {
      minX: originX + lob.rect.x - 20,
      maxX: originX + Math.max(floorOriginX, nextCorridorX) + 40,
      minZ: lob.rect.z - 16,
      maxZ: baseCorridorZ + maxCorZ + 24
    };
    return entry;
  }

  // --- character -----------------------------------------------------------------------
  const char = new pc.Entity("character");
  app.root.addChild(char);
  const visual = new pc.Entity("char-visual");
  char.addChild(visual);
  const poseProceduralAvatar = buildProceduralAvatar(visual, part, materialFor);
  const shadowImage = makeScreen(64, 64);
  const shadowGradient = shadowImage.ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  shadowGradient.addColorStop(0, "rgba(30, 36, 31, .58)");
  shadowGradient.addColorStop(0.45, "rgba(30, 36, 31, .32)");
  shadowGradient.addColorStop(1, "rgba(30, 36, 31, 0)");
  shadowImage.ctx.fillStyle = shadowGradient;
  shadowImage.ctx.fillRect(0, 0, 64, 64);
  uploadScreen(shadowImage);
  const shadowMaterial = shadowImage.material;
  shadowMaterial.emissive.fromString("#282e27");
  shadowMaterial.emissiveMap = null;
  shadowMaterial.opacityMap = shadowImage.texture;
  shadowMaterial.opacityMapChannel = "a";
  shadowMaterial.blendType = pc.BLEND_NORMAL;
  shadowMaterial.depthWrite = false;
  shadowMaterial.useLighting = false;
  shadowMaterial.update();
  const contactShadow = new pc.Entity("walker-contact-shadow");
  contactShadow.addComponent("render", { type: "plane", material: shadowMaterial });
  app.root.addChild(contactShadow);

  // The idle rig determines the opening character. Motion clips stream after it.
  let charAnimEntity: pc.Entity | null = null;
  let currentAnim = "";
  let packMotionScale = 1.78;
  let charRootBone: pc.GraphNode | null = null;
  const charRootHome = new pc.Vec3();
  const charRootWorld = new pc.Vec3();
  const characterTracks = new Set<string>();
  const CHAR_PRESETS = ["idle", "walk", "run", "jump"] as const;

  const setupPackCharacter = (): void => {
    if (!assets) return;
    const alternates = ["character-default.rigged", "character-default"].filter((role) => assets.has(role));
    const mountAlternate = (): void => {
      const role = alternates.shift();
      if (role) mountContainer(packAsset(role), char, 1.78, 0, [visual], { yaw: -90, onUnavailable: mountAlternate }, true);
    };
    if (!assets.has("character-default.anim.idle")) return mountAlternate();
    const idle = packAsset("character-default.anim.idle");
    const finish = prepareMount(idle, char, 1.78, [visual], true);
    const unavailable = (): void => {
      finish("unavailable");
      mountAlternate();
    };
    observeContainer(idle, char, (result) => {
      if (disposed) return;
      if (result.status === "unavailable") return unavailable();
      if (result.status === "failed") return finish("failed");
      if (result.status !== "loaded") return;
      let mounted: pc.Entity | undefined;
      try {
        const res = result.asset.resource as {
          instantiateRenderEntity?: () => pc.Entity;
          animations?: { resource: pc.AnimTrack }[];
        } | null;
        if (!res?.instantiateRenderEntity) return unavailable();
        const model = res.instantiateRenderEntity();
        const pendingMeshes = model.findComponents("render")
          .flatMap((render) => (render as pc.RenderComponent).meshInstances ?? []).filter((mesh) => mesh.visible);
        for (const mesh of pendingMeshes) mesh.visible = false;
        const holder = mounted = new pc.Entity("char-glb");
        holder.setLocalEulerAngles(0, -90, 0);
        holder.addChild(model);
        char.addChild(holder);
        const afterUpdate = (step: () => void): void => {
          app.once("update", () => {
            if (disposed || !holder.parent) return;
            try {
              step();
            } catch {
              holder.destroy();
              charAnimEntity = null;
              finish("failed");
            }
          });
        };
        afterUpdate(() => {
          const aabb = unionAabb(model);
          const h = aabb ? aabb.halfExtents.y * 2 : 0;
          if (!aabb || !pendingMeshes.length || !Number.isFinite(h) || h <= 0.0001) {
            holder.destroy();
            return unavailable();
          }
          const s = 1.78 / h;
          packMotionScale = s;
          holder.setLocalScale(s, s, s);
          afterUpdate(() => {
            const after = unionAabb(model);
            if (!after) {
              holder.destroy();
              return unavailable();
            }
            const bottom = after.center.y - after.halfExtents.y;
            const lp = holder.getLocalPosition();
            holder.setLocalPosition(lp.x, lp.y + (char.getPosition().y - bottom), lp.z);
            const idleTrack = res.animations?.[0]?.resource;
            if (idleTrack) {
              // Animation states on the implicit single-layer graph.
              model.addComponent("anim", { activate: true });
              const anim = model.anim;
              if (!anim) throw new Error("no anim component");
              anim.assignAnimation("idle", idleTrack);
              characterTracks.add("idle");
              const addTrack = (preset: typeof CHAR_PRESETS[number]): void => {
                if (!assets.has(`character-default.anim.${preset}`)) return;
                const container = packAsset(`character-default.anim.${preset}`);
                queuedAnimationClips.add(container);
                observeContainer(container, model, (clip) => {
                  if (clip.status !== "loaded" || disposed || !model.parent) return;
                  try {
                    const r = clip.asset.resource as { animations?: { resource: pc.AnimTrack }[] } | null;
                    const track = r?.animations?.[0]?.resource;
                    if (track) {
                      anim.assignAnimation(preset, track, undefined, 1, preset !== "jump");
                      characterTracks.add(preset);
                    }
                  } catch {
                    /* that preset stays unavailable */
                  }
                });
              };
              for (const preset of CHAR_PRESETS) if (preset !== "idle") addTrack(preset);
              // The bundled rig drives Hip in a rotated local basis. Preserve
              // vertical bob and pin horizontal root motion in world space.
              charRootBone = model.findByName("Hip");
              if (charRootBone) charRootHome.copy(charRootBone.getLocalPosition());
              charAnimEntity = model;
              currentAnim = "idle";
            }
            for (const mesh of pendingMeshes) mesh.visible = true;
            finish("ready");
          });
        });
      } catch {
        mounted?.destroy();
        finish("failed");
      }
    });
  };
  setupPackCharacter();

  const cityBounds = { minX: cb_.x - 10, maxX: cb_.x + cb_.w + 10, minZ: cb_.z - 10, maxZ: cb_.z + cb_.d + 10 };
  const gateSpawn = { x: layout.city.gate.pos.x + 6, z: layout.city.gate.pos.z };
  const sidewalkY = (x: number, z: number): number => {
    if (campus && x >= campus.x && x <= campus.x + campus.w && z >= campus.z && z <= campus.z + campus.d) return 0.046;
    if (!frontage) return 0;
    const local = frontage.offset(x, z);
    const fromLane = Math.abs(local.z - frontage.lane) - frontage.roadWidth / 2;
    return local.x >= frontage.left && local.x <= frontage.right && fromLane >= 0 && fromLane <= frontage.sidewalk ? 0.095 : 0;
  };
  const arrival = (() => {
    if (!startBuilding || !frontage) return null;
    const { size } = startBuilding;
    const { door, doorDir, facadeWidth, spawnDistance: preferred } = frontage;
    const end = entrancePoint(startBuilding, 1.9);
    const neighborPoints: Position3[] = [];
    if (campus) for (const side of [-1, 1]) {
      const edge = Math.min(...layout.city.buildings.flatMap((building) => {
        if (building.id === startBuilding.id || building.doorDir.z !== doorDir.z) return [];
        const nextDoor = entrancePoint(building);
        const local = frontage.offset(nextDoor.x, nextDoor.z);
        return local.x * side > 0 && Math.abs(local.z) < 1.4 ? [Math.abs(local.x) - building.size.w / 2] : [];
      }));
      if (edge <= facadeWidth * 1.3) {
        const lateral = side * Math.min(facadeWidth * 0.97, edge + 1.6);
        neighborPoints.push({ x: lateral * doorDir.z, y: 2.1, z: -lateral * doorDir.x });
      }
    }
    for (const distance of [preferred, preferred * 0.82, preferred * 0.64, 7]) {
      for (const lateral of campus ? [5.3, 3.1, 0, -2.5] : [0, -2.5, 2.5]) {
        const spawn = {
          x: door.x + distance * doorDir.x + lateral * doorDir.z,
          z: door.z + distance * doorDir.z - lateral * doorDir.x
        };
        if (spawn.x < cityBounds.minX || spawn.x > cityBounds.maxX || spawn.z < cityBounds.minZ || spawn.z > cityBounds.maxZ) continue;
        const path = walkPath(spawn, end, solids.get("city") ?? [], (x, z) => onSurface("city", x, z));
        if (!path) continue;
        const points: Position3[] = [];
        for (const side of [-0.52, 0.52]) {
          const x = side * facadeWidth * doorDir.z;
          const z = -side * facadeWidth * doorDir.x;
          points.push({ x, y: 0, z }, { x, y: size.h + (campus ? 0.93 : 0.45), z });
        }
        const ground = sidewalkY(spawn.x, spawn.z);
        points.push({ x: spawn.x - door.x, y: ground, z: spawn.z - door.z });
        points.push({ x: spawn.x - door.x, y: ground + 1.95, z: spawn.z - door.z });
        const axis = Math.atan2(doorDir.x, doorDir.z);
        const yaw = axis + (campus ? 0.08 : 0.11);
        const fov = Math.max(65, Math.min(83, 65 + (size.h - 8) * 1.1));
        const entrance = { ...entrancePoint(startBuilding, 0.64), y: 1.7 };
        return { door, spawn, path, points, neighborPoints, entrance, axis, yaw, fov };
      }
    }
    return null;
  })();
  if (exteriorLandmarks.length) {
    const entrances: WalkSolid[] = layout.city.buildings.map((building) => {
      const { doorDir } = building;
      return {
        ...entrancePoint(building, 2.8),
        halfW: Math.abs(doorDir.z) * 1.62 + Math.abs(doorDir.x) * 3.0,
        halfD: Math.abs(doorDir.x) * 1.62 + Math.abs(doorDir.z) * 3.0
      };
    });
    const approach = arrival ? [arrival.spawn, ...arrival.path] : [];
    for (const { layout: building, url } of exteriorLandmarks) {
      const meta = buildingById.get(building.id);
      if (!meta) continue;
      const { doorDir, size } = building;
      const door = entrancePoint(building);
      const facadeWidth = Math.abs(doorDir.z) * size.w + Math.abs(doorDir.x) * size.d;
      const blockers = [...(solids.get("city") ?? []), ...entrances, ...furnitureSites];
      const site = streetExhibitSite(door, doorDir, facadeWidth, blockers, approach, (candidate) => {
        const { x, z, halfW, halfD } = candidate;
        const minX = campus?.x ?? cityBounds.minX;
        const minZ = campus?.z ?? cityBounds.minZ;
        const maxX = campus ? campus.x + campus.w : cityBounds.maxX;
        const maxZ = campus ? campus.z + campus.d : cityBounds.maxZ;
        if (x - halfW < minX || x + halfW > maxX || z - halfD < minZ || z + halfD > maxZ) return false;
        return Boolean(campus) || !layout.city.roads.some((road) => road.points.some((point, i) => {
          const prior = road.points[i - 1];
          return prior && distanceToSegment(x, z, { x: prior.x, y: prior.z }, { x: point.x, y: point.z }) <
            road.width / 2 + Math.hypot(halfW, halfD) + 0.25;
        }));
      });
      if (!site) continue;
      const { x, z, halfW, halfD } = site;
      const { w, d } = STREET_EXHIBIT_SIZE;
      const groundY = sidewalkY(x, z);
      const base = 0.19;
      const st = new pc.Entity(`overlay:landmark:${building.id}`);
      st.setPosition(x, groundY, z);
      st.lookAt(x + doorDir.x, groundY, z + doorDir.z);
      cityRoot.addChild(st);
      part(st, "box", w - 0.12, base - 0.055, d - 0.12, 0, (base - 0.055) / 2, 0,
        materialFor("#877a67"), "street-exhibit-base");
      part(st, "box", w, 0.055, d, 0, base - 0.055 / 2, 0,
        materialFor("#c7b495"), "street-exhibit-cap");
      addContactShadow(cityRoot, x + 0.15, z + 0.13, halfW * 2 + 0.9, halfD * 2 + 0.7, groundY + 0.012);
      const fallback = new pc.Entity("street-exhibit-directory");
      st.addChild(fallback);
      const rail = materialFor("#566560");
      for (const side of [-1, 1]) part(fallback, "box", 0.14, 0.72, 0.73, side * 0.71, base + 0.36, 0.13, rail);
      part(fallback, "box", 1.92, 0.10, 0.87, 0, base + 0.72, 0.13, materialFor("#c4ae8e"));
      part(fallback, "box", 1.82, 0.51, 0.08, 0, base + 0.98, -0.23, rail);
      const screen = makeScreen(576, 156, true);
      screen.material.useLighting = false;
      screen.material.update();
      screen.ctx.fillStyle = "#eaddbf";
      screen.ctx.fillRect(0, 0, screen.canvas.width, screen.canvas.height);
      screen.ctx.fillStyle = "#30443a";
      screen.ctx.textBaseline = "top";
      const font = (fontSize: number) => `750 ${fontSize}px system-ui, sans-serif`;
      const title = fitDisplayCopy(meta.title, 516, 102, 57, (text, fontSize) => {
        screen.ctx.font = font(fontSize);
        return screen.ctx.measureText(text).width;
      });
      screen.ctx.font = font(title.size);
      const top = (156 - title.leading * title.lines.length) / 2;
      for (const [i, line] of title.lines.entries()) screen.ctx.fillText(line, 30, top + title.leading * i);
      uploadScreen(screen);
      addSignFace(fallback, 1.72, 0.46, base + 0.98, -0.23, 0.08, -1, screen, "street-directory-title");
      const proxy = addSolid("city", x, z, halfW * 2, halfD * 2, groundY + base + 1.24, "street exhibit");
      const visitor = arrival && building.id === startBuilding?.id ? arrival.spawn : entrancePoint(building, 14);
      mountContainer(containerAsset(`url:${url}`, url), st, 2.5, base - 0.002, [fallback], {
        chooseYaw: (modelW, modelD) => streetExhibitYaw(modelW, modelD, site, doorDir, visitor),
        fit: { w: halfW * 2 - 0.14, h: 2.25, d: halfD * 2 - 0.14 },
        onFit: ({ h }) => { proxy.height = groundY + base + h; }
      });
    }
  }
  if (arrival) {
    const pathMaterial = materialFor("#c4e5dc", "#a5cfc3", 0.19);
    let from = arrival.spawn;
    for (const to of arrival.path) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dz);
      if (length > 0.75) {
        const yaw = Math.atan2(dx, dz) * 180 / Math.PI;
        if (campus) {
          const strip = part(cityRoot, "box", 2.05, 0.018, length, (from.x + to.x) / 2, 0.065, (from.z + to.z) / 2,
            materialFor("#4f8d86"), "pedestrian-approach");
          strip.setLocalEulerAngles(0, yaw, 0);
        }
        const markers = Math.max(1, Math.floor(length / 2.7));
        for (let i = 0; i < markers; i++) {
          const t = (i + 0.5) / markers;
          const marker = new pc.Entity("approach-arrow");
          const x = from.x + t * dx;
          const z = from.z + t * dz;
          const local = frontage?.offset(x, z);
          if (frontage && local && Math.abs(local.z - frontage.lane) <= frontage.roadWidth / 2) continue;
          marker.setPosition(x, 0.115, z);
          marker.setEulerAngles(0, yaw, 0);
          cityRoot.addChild(marker);
          for (const side of [-1, 1]) {
            const arm = part(marker, "box", 0.105, 0.025, 0.33, side * 0.11, 0, 0, pathMaterial);
            arm.setLocalEulerAngles(0, -side * 42, 0);
          }
        }
      }
      from = to;
    }
  }
  let arrivalActive = arrival !== null;
  let charX = arrival?.spawn.x ?? gateSpawn.x;
  let charZ = arrival?.spawn.z ?? gateSpawn.z;
  let charY = 0;
  let vy = 0;
  let jumpAge = 0;
  let velocityX = 0;
  let velocityZ = 0;
  const walkSpeed = 1.85;
  const runSpeed = 4.45;
  const jumpSpeed = 5.15;
  const gravity = 18;
  const airborneTime = 2 * jumpSpeed / gravity;
  const startYaw = arrival ? Math.atan2(arrival.door.x - charX, arrival.door.z - charZ) : Math.PI / 2;
  let charYaw = startYaw * 180 / Math.PI;
  let gaitPhase = 0;
  let locomotion: WalkDiagnostics["animation"] = "idle";
  let cameraSnap = true;
  let cameraLimited = false;
  let boomDistance = 7.5;
  let boomLimit = 7.5;
  let avatarVisible = true;
  let reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let motionContact: WalkDiagnostics["contact"] = null;
  let motionCollider: string | undefined;
  let frameDisplacement = 0;
  let requestedSpeed = 0;
  let resolvedSpeed = 0;

  const teleportChar = (x: number, z: number, faceX?: number, faceZ?: number): void => {
    arrivalActive = false;
    const worldSolids = solids.get(activeWorld) ?? [];
    const available = (px: number, pz: number): boolean =>
      onSurface(activeWorld, px, pz) && !worldSolids.some((solid) => intersectsWalker(px, pz, solid));
    let destination = { x, z };
    if (!available(x, z)) {
      for (const radius of [0.45, 0.9, 1.45]) {
        const candidates = [
          { x: x + radius, z }, { x: x - radius, z }, { x, z: z + radius }, { x, z: z - radius }
        ];
        const safe = candidates.find((candidate) => available(candidate.x, candidate.z));
        if (!safe) continue;
        destination = safe;
        break;
      }
    }
    charX = destination.x;
    charZ = destination.z;
    charY = 0;
    vy = 0;
    jumpAge = 0;
    velocityX = 0;
    velocityZ = 0;
    gaitPhase = 0;
    locomotion = "idle";
    focused = null;
    cb.onFocus(null);
    avatarVisible = true;
    cameraSnap = true;
    if (faceX !== undefined && faceZ !== undefined) {
      camYaw = Math.atan2(faceX - charX, faceZ - charZ);
      charYaw = (camYaw * 180) / Math.PI;
    }
    updateIndoorLocation();
  };

  // --- camera --------------------------------------------------------------------------
  const followFov = 62;
  const camEntity = new pc.Entity("camera");
  camEntity.addComponent("camera", {
    clearColor: new pc.Color().fromString(DAY.sky),
    farClip: 700,
    nearClip: 0.1,
    fov: followFov
  });
  app.root.addChild(camEntity);
  let camYaw = startYaw;
  let camPitch = startBuilding ? 0.36 : 0.28;
  let camDist = 5.6;
  let cityCamera = { pitch: camPitch, distance: camDist };
  let viewInsets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  let inputBlocked = false;
  let openingModels: OpeningModelsState = { status: "loading", pending: 0 };
  const isInputBlocked = (): boolean => inputBlocked || openingModels.status !== "ready";
  let draggingStage = false;
  let stageDragDistance = 0;
  const isEditing = (): boolean => Boolean(document.activeElement?.matches("input,textarea,select,[contenteditable='true']"));

  const isLocked = (): boolean => document.pointerLockElement === canvas;
  const onCanvasDown = (event: MouseEvent): void => {
    draggingStage = Boolean(graphStage && event.button === 0 && !isInputBlocked());
    stageDragDistance = 0;
  };
  const endStageDrag = (): void => { draggingStage = false; };
  const onMouseMove = (e: MouseEvent): void => {
    if (graphStage) {
      if (draggingStage && !isInputBlocked()) {
        stageDragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
        const limit = graphStage.sequence ? 0.27 : 0.9;
        graphStage.yaw = Math.max(-limit, Math.min(limit, graphStage.yaw - e.movementX * 0.006));
      }
      return;
    }
    if (!isLocked() || isInputBlocked()) return;
    if (e.movementX !== 0 || e.movementY !== 0) arrivalActive = false;
    camYaw -= e.movementX * 0.0035;
    const [lower, upper] = mode === "interior" ? [-0.38, 0.68] : [-0.5, 1.25];
    camPitch = Math.max(lower, Math.min(upper, camPitch + e.movementY * 0.0035));
  };
  const onWheel = (e: WheelEvent): void => {
    if (graphStage) {
      graphStage.zoom = Math.max(0.64, Math.min(2.3, graphStage.zoom + e.deltaY * 0.001));
      return;
    }
    if (isInputBlocked()) return;
    arrivalActive = false;
    const [near, far] = mode === "interior" ? [2.15, 5.6] : [3.4, 13];
    camDist = Math.max(near, Math.min(far, camDist + e.deltaY * 0.01));
  };
  function pickStage(event: MouseEvent): void {
    const stage = graphStage;
    const camera = camEntity.camera;
    if (!stage || !camera || stageDragDistance >= 4) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const safe = viewRect(rect.width, rect.height, viewInsets);
    if (x < safe.left || x > safe.right || y < safe.top || y > safe.bottom) return;
    let hit: string | undefined;
    let closest = 12;
    let nodeHit: string | undefined;
    let nodeDistance = Infinity;
    const point = new pc.Vec3();
    const project = (px: number, py: number, pz: number): pc.Vec3 =>
      camera.worldToScreen(point.set(px, py, stageDepth + pz));
    for (const [ref, target] of stage.targets) {
      if (target.node) {
        const node = target.node;
        const planeY = node.y ?? 0.55;
        const center = project(node.x, planeY, node.z);
        const corners: pc.Vec3[] = [];
        for (const side of [-1, 1]) for (const end of [-1, 1]) {
          corners.push(project(
            node.x + side * node.width / 2,
            node.y === undefined ? planeY : planeY + end * 0.35,
            node.y === undefined ? node.z + end * node.depth / 2 : node.z
          ));
        }
        const contains = x >= Math.min(...corners.map((p) => p.x)) - 5 && x <= Math.max(...corners.map((p) => p.x)) + 5 &&
          y >= Math.min(...corners.map((p) => p.y)) - 5 && y <= Math.max(...corners.map((p) => p.y)) + 5;
        const distance = Math.hypot(x - center.x, y - center.y);
        if (contains && distance < nodeDistance) {
          nodeHit = ref;
          nodeDistance = distance;
        }
      } else if (target.line) {
        const points = target.line.map((p) => project(p.x, p.y ?? 0.28, p.z));
        for (let i = 1; i < points.length; i++) {
          const distance = distanceToSegment(x, y, points[i - 1], points[i]);
          if (distance < closest) {
            closest = distance;
            hit = ref;
          }
        }
      }
    }
    const target = nodeHit ?? hit;
    if (target) focusRef(target);
  }
  const onCanvasClick = (event: MouseEvent): void => {
    if (isInputBlocked()) return;
    if (graphStage) {
      pickStage(event);
    } else if (bird && overviewConnections.length) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const safe = viewRect(rect.width, rect.height, viewInsets);
      if (x < safe.left || x > safe.right || y < safe.top || y > safe.bottom) return;
      const camera = camEntity.camera;
      if (!camera) return;
      let nearest = 12;
      let selected: string | undefined;
      for (const { id } of overviewConnections) {
        const points = linkVisuals.get(id)?.points;
        if (!points) continue;
        const positions = points.map((p) => camera.worldToScreen(new pc.Vec3(p.x, 0.43, p.z)));
        for (let i = 1; i < positions.length; i++) {
          const distance = distanceToSegment(x, y, positions[i - 1], positions[i]);
          if (distance >= nearest) continue;
          nearest = distance;
          selected = id;
        }
      }
      if (selected) focusRef(selected);
    } else if (!isLocked() && !bird) {
      void canvas.requestPointerLock()?.catch(() => undefined);
    }
  };
  const onLockChange = (): void => cb.onLock(isLocked());
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", endStageDrag);
  canvas.addEventListener("mousedown", onCanvasDown);
  canvas.addEventListener("click", onCanvasClick);
  canvas.addEventListener("wheel", onWheel, { passive: true });
  document.addEventListener("pointerlockchange", onLockChange);

  // --- modes ---------------------------------------------------------------------------
  let bounds = cityBounds;

  function arriveInLobby(originX: number, lobby: InteriorLayout["lobby"], hasWorkshop: boolean): void {
    const x = originX + lobby.entry.x;
    const z = lobbySpawnZ(lobby);
    camPitch = 0.17;
    camDist = 4.15;
    const faceX = hasWorkshop ? originX + lobby.rect.x + lobby.rect.w : x;
    teleportChar(x, z, faceX, hasWorkshop ? passageZ : z + 5);
  }

  function enterInterior(buildingId: string): void {
    const il = layout.interiors[buildingId];
    if (!interiorByBuilding.has(buildingId) || !il) return;
    if (bird) setOverview(false);
    if (mode === "interior") {
      if (activeInteriorId === buildingId) return;
      exitInterior();
    }
    const entry = buildInterior(buildingId);
    const lb = lBuildingById.get(buildingId);
    cityReturn = lb
      ? streetExitPoint(entrancePoint(lb), lb.doorDir, (x, z) =>
          x >= cityBounds.minX && x <= cityBounds.maxX && z >= cityBounds.minZ && z <= cityBounds.maxZ &&
          !(solids.get("city") ?? []).some((solid) => intersectsWalker(x, z, solid))) ?? entrancePoint(lb, 3.1)
      : { x: charX, z: charZ };
    closeInspect();
    stopAuto();
    corridorReturn = null;
    cityCamera = { pitch: camPitch, distance: camDist };
    cityRoot.enabled = false;
    entry.root.enabled = true;
    mode = "interior";
    activeWorld = `int:${buildingId}`;
    activeInteriorId = buildingId;
    bounds = entry.bounds;
    arriveInLobby(entry.originX, il.lobby, il.floors.length > 0);
    cb.onMode("interior", buildingId);
  }

  function exitInterior(): void {
    if (mode !== "interior" || !activeInteriorId) return;
    if (bird) setOverview(false);
    closeInspect();
    stopAuto();
    corridorReturn = null;
    const building = lBuildingById.get(activeInteriorId);
    const entry = interiorRootByBuilding.get(activeInteriorId);
    if (entry) entry.root.enabled = false;
    cityRoot.enabled = true;
    mode = "city";
    activeWorld = "city";
    bounds = cityBounds;
    camPitch = cityCamera.pitch;
    camDist = cityCamera.distance;
    const back = cityReturn ?? { x: layout.city.gate.pos.x + 6, z: layout.city.gate.pos.z };
    teleportChar(back.x, back.z, building?.pos.x ?? back.x, building?.pos.z ?? back.z - 4);
    activeInteriorId = null;
    cb.onMode("city");
  }

  function gotoFloor(buildingId: string, floorId: string): void {
    closeInspect();
    stopAuto();
    corridorReturn = null;
    if (activeInteriorId !== buildingId) enterInterior(buildingId);
    const entry = interiorRootByBuilding.get(buildingId);
    const il = layout.interiors[buildingId];
    if (!entry || !il) return;
    // Floors are laid out sequentially right of the lobby (same math as build).
    let fx = il.lobby.rect.x + il.lobby.rect.w + 14;
    for (const lf of il.floors) {
      if (lf.id === floorId) {
        const x = entry.originX + fx + 3.8;
        camPitch = 0.08;
        camDist = 3.5;
        teleportChar(x, passageZ, x + 6, passageZ + 0.5);
        return;
      }
      fx += lf.rect.w + 14;
    }
  }

  function gotoLobby(): void {
    const id = activeInteriorId;
    const room = id ? interiorRootByBuilding.get(id) : undefined;
    const il = id ? layout.interiors[id] : undefined;
    if (!room || !il) return;
    closeInspect();
    stopAuto();
    corridorReturn = null;
    arriveInLobby(room.originX, il.lobby, il.floors.length > 0);
  }

  // --- tour / focus beacon ---------------------------------------------------------------
  const beacon = new pc.Entity("beacon");
  beacon.addComponent("render", { type: "cylinder" });
  beacon.render!.material = materialFor("#438b7a", "#64baa8", 0.3);
  beacon.setLocalScale(0.82, 0.024, 0.82);
  beacon.enabled = false;
  app.root.addChild(beacon);
  const markDestination = (x: number, z: number): void => {
    beacon.setPosition(x, activeWorld === "city" ? sidewalkY(x, z) + 0.035 : 0.035, z);
    beacon.enabled = true;
  };

  // Presentation camera shots (agent-directed, bounded tokens — D5).
  const inspectShotByTarget = new Map(
    (space.presentation?.cameraShots ?? [])
      .filter((s) => s.kind === "inspect")
      .map((s) => [s.target, s] as const)
  );
  const applyShotAngle = (ref: string): void => {
    const shot = inspectShotByTarget.get(ref);
    if (!shot) return;
    if (shot.angle === "high") camPitch = 0.85;
    else if (shot.angle === "low") camPitch = 0.08;
    else if (shot.angle === "orbit") {
      camPitch = 0.5;
      camYaw += 0.8;
    } else if (shot.angle === "three-quarter") {
      camPitch = 0.35;
      camYaw += 0.55;
    } else camPitch = 0.25; // front
  };

  const highlightFlowRoutes = (ref: string): void => {
    for (const r of routePulses) {
      r.active = r.flowId === ref;
      for (const m of r.mats) {
        m.emissiveIntensity = r.active ? 1.6 : 0.15;
        m.update();
      }
      for (const p of r.pulses) p.enabled = r.active;
    }
  };

  function focusRef(ref: string): void {
    const stageTarget = graphStage?.targets.get(ref);
    if (stageTarget && graphStage) {
      graphStage.selectedRef = ref;
      cb.onFocus(stageTarget.focus);
      if (!replaySession) {
        const sequence = graphStage.sequence;
        const message = sequence?.edges.findIndex((edge) => edge.id === stageTarget.edge) ?? -1;
        if (sequence && message >= 0) {
          sequence.step = message;
          sequence.progress = 1;
          sequence.playing = false;
          emitSpatialDiagram();
        } else {
          if (sequence) sequence.playing = false;
          graphStage.view.paint(stageTarget.node?.id, stageTarget.edge);
          graphStage.view.pulse(undefined, 0);
        }
      } else {
        const session = replaySession;
        let step = -1;
        for (const [index, node] of session.trace.steps.entries()) {
          const previous = session.trace.steps[index - 1];
          const edge = previous && session.edgeByPair.get(edgeKey(previous.id, node.id));
          if (node.id !== stageTarget.node?.id && (!stageTarget.edge || stageTarget.edge !== edge)) continue;
          if (step < 0 || Math.abs(index - session.step) < Math.abs(step - session.step)) step = index;
        }
        if (step >= 0) {
          replaySession.step = step;
          replaySession.progress = 1;
          replaySession.playing = false;
          emitReplay();
        }
      }
      return;
    }
    if (ref.startsWith("overview:")) {
      focusOverview(ref.slice(9));
      return;
    }
    const systemLink = systemLinks.get(ref);
    if (systemLink && bird) {
      const { title, summary, source } = systemLink;
      overviewFocus = undefined;
      overviewLink = ref;
      refreshOverviewLinks();
      cb.onFocus({ kind: "edge", ref, title, summary, sourcePath: source.path, source });
      return;
    }
    stopAuto();
    if (flowById.has(ref)) {
      highlightFlowRoutes(ref);
      openReplay(ref);
      return;
    }
    closeInspect();
    const diagram = diagramById.get(ref);
    if (diagram) {
      const split = diagram.owner.indexOf(":");
      if (split > 0 && interiorByBuilding.has(diagram.owner.slice(0, split))) {
        gotoFloor(diagram.owner.slice(0, split), diagram.owner.slice(split + 1));
        openDiagramPanel(diagram);
        return;
      }
      if (diagram.owner !== "city" && buildingById.has(diagram.owner)) {
        if (mode === "interior" && activeInteriorId !== diagram.owner) exitInterior();
        const lb = mode === "city" ? lBuildingById.get(diagram.owner) : undefined;
        if (lb) {
          teleportChar(
            lb.pos.x + lb.doorDir.x * (lb.size.w / 2 + 8),
            lb.pos.z + lb.doorDir.z * (lb.size.d / 2 + 8),
            lb.pos.x,
            lb.pos.z
          );
        }
        openDiagramPanel(diagram);
      } else {
        if (mode === "interior") exitInterior();
        const p = layout.city.plaza.pos;
        teleportChar(p.x, p.z + 6, p.x, p.z - 6);
        openDiagramPanel(diagram);
      }
      return;
    }
    const colon = ref.indexOf(":");
    if (colon > 0 && interiorByBuilding.has(ref.slice(0, colon))) {
      gotoFloor(ref.slice(0, colon), ref.slice(colon + 1));
      return;
    }
    if (bird) setOverview(false);
    // building / district / gate / plaza
    if (mode === "interior") exitInterior();
    const lb = lBuildingById.get(ref);
    if (lb) {
      const x = lb.pos.x + lb.doorDir.x * (lb.size.w / 2 + 7);
      const z = lb.pos.z + lb.doorDir.z * (lb.size.d / 2 + 7);
      teleportChar(x, z, lb.pos.x, lb.pos.z);
      applyShotAngle(ref);
      const entrance = entrancePoint(lb, 1.3);
      markDestination(entrance.x, entrance.z);
      return;
    }
    const district = layout.city.districts.find((d) => d.id === ref);
    if (district) {
      teleportChar(district.markerPos.x + 3, district.markerPos.z + 3, district.markerPos.x, district.markerPos.z);
      markDestination(district.markerPos.x + 0.8, district.markerPos.z + 0.8);
      return;
    }
    if (ref === "gate") teleportChar(layout.city.gate.pos.x + 4, layout.city.gate.pos.z, layout.city.gate.pos.x + 12, layout.city.gate.pos.z);
    if (ref === "plaza") teleportChar(layout.city.plaza.pos.x, layout.city.plaza.pos.z + 8, layout.city.plaza.pos.x, layout.city.plaza.pos.z);
  }

  function clearTourFocus(): void {
    beacon.enabled = false;
    stopAuto();
    trailRef = null;
    hideTrail();
    for (const r of routePulses) {
      r.active = true;
      for (const m of r.mats) {
        m.emissiveIntensity = 1.2;
        m.update();
      }
      for (const p of r.pulses) p.enabled = true;
    }
  }

  // --- locate quests: deterministic anchor point for any ref -------------------------------
  const refPoint = (ref: string): { world: string; x: number; z: number } | null => {
    const lb = lBuildingById.get(ref);
    if (lb) {
      return {
        world: "city",
        x: lb.pos.x + lb.doorDir.x * (lb.size.w / 2 + 2),
        z: lb.pos.z + lb.doorDir.z * (lb.size.d / 2 + 2)
      };
    }
    const district = layout.city.districts.find((d) => d.id === ref);
    if (district) return { world: "city", x: district.markerPos.x, z: district.markerPos.z };
    const route = layout.city.routes.find((r) => r.flowId === ref);
    if (route) return { world: "city", x: route.points[0].x, z: route.points[0].z };
    const flow = flowById.get(ref);
    if (flow?.scope.startsWith("module:")) {
      return refPoint(flow.scope.slice(7));
    }
    const diagram = diagramById.get(ref);
    if (diagram) {
      if (diagram.owner !== "city") return refPoint(diagram.owner);
      return { world: "city", x: layout.city.plaza.pos.x, z: layout.city.plaza.pos.z };
    }
    const colon = ref.indexOf(":");
    if (colon > 0) {
      const b = ref.slice(0, colon);
      const il = layout.interiors[b];
      const entry = interiorRootByBuilding.get(b);
      if (il && entry) {
        let fx = il.lobby.rect.x + il.lobby.rect.w + 14;
        for (const lf of il.floors) {
          if (lf.id === ref.slice(colon + 1)) {
            return { world: `int:${b}`, x: entry.originX + fx + 3.8, z: passageZ };
          }
          fx += lf.rect.w + 14;
        }
      }
      const blb = lBuildingById.get(b);
      if (blb) return { world: "city", x: blb.pos.x, z: blb.pos.z };
    }
    if (ref === "gate") return { world: "city", x: layout.city.gate.pos.x, z: layout.city.gate.pos.z };
    if (ref === "plaza") return { world: "city", x: layout.city.plaza.pos.x, z: layout.city.plaza.pos.z };
    return null;
  };
  const isNear = (ref: string, radius = 7): boolean => {
    const p = refPoint(ref);
    if (!p || p.world !== activeWorld) return false;
    const dx = p.x - charX;
    const dz = p.z - charZ;
    return dx * dx + dz * dz <= radius * radius;
  };

  // --- autopilot + tour trail ---------------------------------------------------------------
  let autoTarget: { path: WalkPoint[]; next: number; ref: string; stalled: number; reportCancellation: boolean } | null = null;
  function walkTo(ref: string, reportCancellation = false): boolean {
    if (bird) setOverview(false);
    if (flowById.has(ref) || diagramById.has(ref)) {
      focusRef(ref);
      return false;
    }
    const p = refPoint(ref);
    if (!p || p.world !== activeWorld) {
      autoTarget = null;
      beacon.enabled = false;
      focusRef(ref);
      return false;
    }
    const path = walkPath({ x: charX, z: charZ }, p, solids.get(activeWorld) ?? [], (x, z) => onSurface(activeWorld, x, z));
    if (!path) {
      autoTarget = null;
      beacon.enabled = false;
      focusRef(ref);
      return false;
    }
    markDestination(p.x, p.z);
    autoTarget = { path, next: 0, ref, stalled: 0, reportCancellation };
    return true;
  }
  function stopAuto(): void {
    const interrupted = autoTarget;
    autoTarget = null;
    if (interrupted) beacon.enabled = false;
    if (interrupted?.reportCancellation) cb.onAutoCancel?.(interrupted.ref);
  }
  const trailDots: pc.Entity[] = [];
  {
    const m = materialFor("#0e2a27", DAY.teal, 1.1);
    for (let k = 0; k < 14; k++) {
      const dotEnt = new pc.Entity(`trail:${k}`);
      dotEnt.addComponent("render", { type: "sphere" });
      dotEnt.render!.material = m;
      dotEnt.setLocalScale(0.26, 0.26, 0.26);
      dotEnt.enabled = false;
      app.root.addChild(dotEnt);
      trailDots.push(dotEnt);
    }
  }
  let trailRef: string | null = null;
  let trailPath: WalkPoint[] = [];
  let trailRefreshAt = 0;
  const hideTrail = (): void => {
    for (const dotEnt of trailDots) dotEnt.enabled = false;
  };
  function setTrail(ref: string | null): void {
    trailRef = ref;
    trailRefreshAt = 0;
    trailPath = [];
    if (!ref) hideTrail();
  }

  // --- focus + activate ------------------------------------------------------------------
  let focused: Interactable | null = null;
  const activate = (): void => {
    if (focused?.action) focused.action();
  };
  let bird = false;
  let overviewFocus: string | undefined;
  let overviewLink: string | undefined;
  let overviewConnections: CityRelationship[] = [];
  const refreshOverviewLinks = (): void => {
    overviewConnections = bird ? visibleOverviewLinks(cityLinks, overviewFocus, overviewLink) : [];
    const visible = new Set(overviewConnections.map(({ id }) => id));
    for (const [id, visual] of linkVisuals) if (visual) visual.root.enabled = visible.has(id);
    for (const link of overviewConnections) {
      if (!linkVisuals.has(link.id)) linkVisuals.set(link.id, buildOverviewLink(link));
    }
  };
  function setOverview(active: boolean): void {
    if (bird === active) return;
    if (active) {
      closeInspect();
      stopAuto();
      if (isLocked()) document.exitPointerLock();
    }
    if (mode === "interior" && activeInteriorId) {
      const room = interiorRootByBuilding.get(activeInteriorId);
      if (room) room.root.enabled = !active;
      cityRoot.enabled = active;
    }
    bird = active;
    overviewRoot.enabled = active;
    if (!active) overviewFocus = overviewLink = undefined;
    refreshOverviewLinks();
    cameraSnap = true;
    focused = null;
    cb.onFocus(null);
    cb.onOverview?.(active);
  }
  function focusOverview(buildingId: string): void {
    const building = buildingById.get(buildingId);
    if (!building) return;
    setOverview(true);
    overviewFocus = building.id;
    overviewLink = undefined;
    refreshOverviewLinks();
    cb.onFocus({
      kind: "building", ref: building.id, title: building.title, summary: building.summary,
      source: building.source, sourcePath: building.source?.path
    });
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isInputBlocked() || isEditing()) return;
    if (graphStage) {
      if (e.code === "Escape") closeInspect();
      return;
    }
    if (e.code === "KeyE" && !e.repeat) activate();
    if (e.code === "Space" && !e.repeat && !bird && charY <= 0.001 && !vy && !document.activeElement?.matches("button,a,summary")) {
      e.preventDefault();
      vy = jumpSpeed;
      jumpAge = 0;
    }
    if (e.code === "KeyM" && !e.repeat) setOverview(!bird);
    if (e.code === "Escape" && bird) setOverview(false);
  };
  window.addEventListener("keydown", onKeyDown);

  // --- update loop --------------------------------------------------------------------------
  const tmpTo = new pc.Vec3();
  const cameraPosition = new pc.Vec3();
  const nextCameraPosition = new pc.Vec3();
  const cameraLook = new pc.Vec3();
  const nextCameraLook = new pc.Vec3();
  let arrivalFrame: { width: number; height: number; insets: ViewInsets; fit?: ReturnType<typeof fitClearArrivalView> } | undefined;
  let overviewFrame: { width: number; height: number; insets: ViewInsets; focus?: string; fit: ReturnType<typeof fitOrthographic> } | undefined;
  const movePlayer = (dx: number, dz: number): void => {
    const x = Math.max(bounds.minX, Math.min(bounds.maxX, charX + dx));
    const z = Math.max(bounds.minZ, Math.min(bounds.maxZ, charZ + dz));
    const moved = walkMove({ x: charX, z: charZ }, { x: x - charX, z: z - charZ }, solids.get(activeWorld) ?? [],
      activeWorld === "city" ? undefined : (px, pz) => onSurface(activeWorld, px, pz));
    charX = moved.position.x;
    charZ = moved.position.z;
    if (moved.contact) {
      motionContact = moved.contact;
      motionCollider = moved.solid?.label;
    }
  };
  let hudTimer = 0;
  let previousStreetLabels = new Set<string>();

  const onUpdate = (dt: number): void => {
    elapsed += dt;
    motionContact = null;
    motionCollider = undefined;
    if (!reducedMotion) {
      for (const s of spinners) s.rotate(0, dt * 40, 0);
      for (const exhibit of exhibits) if (exhibit.parent?.enabled) exhibit.rotateLocal(0, dt * 16, 0);
    }

    // traffic pulses
    for (const r of routePulses) {
      if (!r.active) continue;
      r.pulses.forEach((p, k) => {
        const t = (((reducedMotion ? 0 : elapsed) * 6 + (k * r.total) / r.pulses.length) % r.total);
        let i = 1;
        while (i < r.cum.length && r.cum[i] < t) i++;
        const a = r.points[i - 1];
        const b = r.points[Math.min(i, r.points.length - 1)];
        const segLen = Math.max(0.0001, r.cum[Math.min(i, r.cum.length - 1)] - r.cum[i - 1]);
        const ft = Math.max(0, Math.min(1, (t - r.cum[i - 1]) / segLen));
        p.setPosition(a.x + (b.x - a.x) * ft, 0.5, a.z + (b.z - a.z) * ft);
      });
    }

    // tour trail: glowing dots from the walker toward the active stop
    if (trailRef && !graphStage) {
      const tp = refPoint(trailRef);
      if (tp && tp.world === activeWorld) {
        if (elapsed >= trailRefreshAt) {
          trailRefreshAt = elapsed + 0.45;
          trailPath = walkPath({ x: charX, z: charZ }, tp, solids.get(activeWorld) ?? [], (x, z) => onSurface(activeWorld, x, z)) ?? [];
        }
        const path = autoTarget?.ref === trailRef ? autoTarget.path.slice(autoTarget.next) : trailPath;
        const points = [{ x: charX, z: charZ }, ...path];
        const lengths = path.map((point, i) => Math.hypot(point.x - points[i].x, point.z - points[i].z));
        const distance = lengths.reduce((sum, length) => sum + length, 0);
        if (distance > 2.8) {
          trailDots.forEach((dotEnt, k) => {
            let along = 1 + ((distance - 1.8) * (k + 1)) / (trailDots.length + 1);
            let segment = 0;
            while (segment < lengths.length - 1 && along > lengths[segment]) along -= lengths[segment++];
            const from = points[segment];
            const to = points[segment + 1];
            const t = Math.min(1, along / Math.max(0.001, lengths[segment]));
            dotEnt.enabled = true;
            const s = reducedMotion ? 0.19 : 0.16 + 0.048 * (1 + Math.sin(elapsed * 6 - k * 0.7));
            dotEnt.setLocalScale(s, s, s);
            dotEnt.setPosition(from.x + (to.x - from.x) * t, 0.14, from.z + (to.z - from.z) * t);
          });
        } else {
          hideTrail();
        }
      } else {
        hideTrail();
      }
    }

    // movement
    const keyboardEnabled = !isInputBlocked() && !isEditing() && !graphStage && !bird;
    const kb = keyboardEnabled ? app.keyboard : undefined;
    const motionDt = Math.min(0.05, Math.max(0, dt));
    const previousX = charX;
    const previousZ = charZ;
    let mx = 0;
    let mz = 0;
    if (kb) {
      if (kb.isPressed(pc.KEY_W) || kb.isPressed(pc.KEY_UP)) mz += 1;
      if (kb.isPressed(pc.KEY_S) || kb.isPressed(pc.KEY_DOWN)) mz -= 1;
      if (kb.isPressed(pc.KEY_D)) mx += 1;
      if (kb.isPressed(pc.KEY_A)) mx -= 1;
      // The left and right arrows turn the view, so the city can be explored without a mouse.
      const turn = Number(kb.isPressed(pc.KEY_LEFT)) - Number(kb.isPressed(pc.KEY_RIGHT));
      if (turn) {
        camYaw += turn * motionDt * 1.9;
        arrivalActive = false;
      }
    }
    const moving = mx !== 0 || mz !== 0;
    if (moving || autoTarget || vy !== 0) arrivalActive = false;
    let desiredX = 0;
    let desiredZ = 0;
    let targetDistance = Infinity;
    if (moving) {
      const len = Math.hypot(mx, mz);
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      const speed = kb?.isPressed(pc.KEY_SHIFT) ? runSpeed : walkSpeed;
      desiredX = (mz * sin - mx * cos) * speed / len;
      desiredZ = (mz * cos + mx * sin) * speed / len;
    }
    if (autoTarget && keyboardEnabled) {
      if (moving) {
        const doneRef = autoTarget.ref;
        autoTarget = null;
        beacon.enabled = false;
        cb.onAutoCancel?.(doneRef);
      } else {
        const target = autoTarget.path[autoTarget.next];
        const adx = target.x - charX;
        const adz = target.z - charZ;
        targetDistance = Math.hypot(adx, adz);
        const finalPoint = autoTarget.next === autoTarget.path.length - 1;
        if (finalPoint && targetDistance < 1.45) {
          const doneRef = autoTarget.ref;
          autoTarget = null;
          beacon.enabled = false;
          velocityX = velocityZ = 0;
          cb.onAutoArrive?.(doneRef);
        } else if (!finalPoint && targetDistance < 0.14) {
          autoTarget.next++;
          velocityX = velocityZ = 0;
        } else {
          const speed = finalPoint && targetDistance > 35 ? runSpeed : walkSpeed;
          desiredX = adx * speed / targetDistance;
          desiredZ = adz * speed / targetDistance;
          if (!reducedMotion) {
            const turn = Math.atan2(adx, adz) - camYaw;
            camYaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-motionDt * 2.2));
          }
        }
      }
    }
    requestedSpeed = Math.hypot(desiredX, desiredZ);
    if (!keyboardEnabled) velocityX = velocityZ = 0;
    else if (motionDt) {
      const steps = Math.ceil(motionDt * 120);
      const step = motionDt / steps;
      const response = requestedSpeed ? 13 : 22;
      for (let i = 0; i < steps; i++) {
        const x = advanceVelocity(velocityX, desiredX, step, response);
        const z = advanceVelocity(velocityZ, desiredZ, step, response);
        velocityX = x.velocity;
        velocityZ = z.velocity;
        const travel = Math.hypot(x.travel, z.travel);
        if (travel <= 1e-5) continue;
        const cap = Math.min(1, targetDistance / travel);
        movePlayer(x.travel * cap, z.travel * cap);
        targetDistance = Math.max(0, targetDistance - travel * cap);
      }
    }
    frameDisplacement = Math.hypot(charX - previousX, charZ - previousZ);
    resolvedSpeed = motionDt ? frameDisplacement / motionDt : 0;
    if (autoTarget && requestedSpeed) {
      autoTarget.stalled = resolvedSpeed < 0.1 && motionContact ? autoTarget.stalled + motionDt : 0;
      if (autoTarget.stalled > 0.35) {
        const blockedRef = autoTarget.ref;
        autoTarget = null;
        beacon.enabled = false;
        cb.onAutoCancel?.(blockedRef);
      }
    }
    if (resolvedSpeed > 0.08) {
      const turn = Math.atan2(charX - previousX, charZ - previousZ) - charYaw * Math.PI / 180;
      charYaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-motionDt * 13)) * 180 / Math.PI;
    }
    if (charY > 0 || vy !== 0) {
      jumpAge += motionDt;
      charY = Math.max(0, charY + (vy - gravity * motionDt / 2) * motionDt);
      vy = charY > 0 ? vy - gravity * motionDt : 0;
    }

    const groundY = activeWorld === "city" ? sidewalkY(charX, charZ) : 0;
    char.setPosition(charX, charY + groundY, charZ);
    char.setEulerAngles(0, charYaw, 0);
    contactShadow.enabled = !graphStage && !bird;
    contactShadow.setPosition(charX, groundY + 0.018, charZ);
    const shadowSize = 0.93 + charY * 0.28;
    contactShadow.setLocalScale(shadowSize, 1, shadowSize * 0.78);
    locomotion = walkGait(resolvedSpeed, locomotion, charY > 0 || vy > 0);
    if (visual.enabled) {
      const running = locomotion === "run";
      gaitPhase = (gaitPhase + frameDisplacement * (running ? 3.5 : 5.2)) % (Math.PI * 2);
      poseProceduralAvatar(gaitPhase, Math.min(1, resolvedSpeed / walkSpeed), running,
        locomotion === "jump" ? Math.min(1, jumpAge / airborneTime) : undefined);
    }

    // GLB character: drive the idle/walk/run/jump states; re-anchor the root
    // bone so walk/run cycles never slide the mesh off the controller.
    if (charAnimEntity && !graphStage) {
      const want = characterTracks.has(locomotion) ? locomotion
        : locomotion === "run" && characterTracks.has("walk") ? "walk" : "idle";
      const animC = charAnimEntity.anim;
      if (animC?.baseLayer) {
        try {
          const layer = animC.baseLayer;
          if (want !== currentAnim) {
            layer.playing = true;
            layer.transition(want, want === "jump" ? 0 : 0.13);
            currentAnim = want;
          }
          if (want === "jump") {
            // The bundled clip contains multiple hops. Drive its first hop by the controller's single jump.
            const phase = Math.min(1, jumpAge / airborneTime);
            layer.playing = false;
            layer.activeStateCurrentTime = 0.05 + (phase < 0.5 ? phase * 0.49 : 0.245 + (phase - 0.5) * 0.34);
          } else {
            animC.speed = groundedClipRate(want, frameDisplacement, dt, packMotionScale);
          }
        } catch {
          /* missing preset — keep the current state */
        }
      }
      if (charRootBone?.parent) {
        charRootBone.parent.getWorldTransform().transformPoint(charRootHome, charRootWorld);
        const rootY = charRootBone.getPosition().y;
        charRootBone.setPosition(charRootWorld.x, want === "jump" ? charRootWorld.y : rootY, charRootWorld.z);
      }
    }

    // camera
    let cx: number;
    let cz: number;
    const camera = camEntity.camera!;
    cameraLimited = false;
    if (graphStage) {
      const stage = graphStage;
      const sequence = stage.sequence;
      const sequenceView = stage.diagram?.kind === "sequence";
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const { yaw, zoom, frame } = stage;
      if (!frame || frame.width !== width || frame.height !== height || frame.yaw !== yaw || frame.zoom !== zoom || frame.insets !== viewInsets) {
        const safe = viewRect(width, height, viewInsets, 32);
        const pitch = stage.topDown ? 1.49 : sequenceView ? 0.10 : replaySession ? 0.62 : 0.58;
        stage.frame = { width, height, insets: viewInsets, yaw, zoom, fit: fitOrthographic(stage.fitPoints, width, height, safe, yaw, pitch, zoom) };
      }
      const { target, halfHeight, back, distance } = stage.frame!.fit;
      camera.projection = pc.PROJECTION_ORTHOGRAPHIC;
      camera.farClip = Math.max(700, distance * 2);
      camera.orthoHeight = halfHeight;
      cx = target.x + back.x * distance;
      cz = stageDepth + target.z + back.z * distance;
      camEntity.setPosition(cx, target.y + back.y * distance, cz);
      camEntity.lookAt(target.x, target.y, stageDepth + target.z);
      cameraSnap = true;
      if (sequence?.playing) {
        sequence.progress = Math.min(1, sequence.progress + dt / 1.3);
        graphStage.view.pulse(sequence.edges[sequence.step].id, sequence.progress);
        if (sequence.progress >= 1) {
          if (sequence.step < sequence.edges.length - 1) {
            sequence.step++;
            sequence.progress = 0;
          } else sequence.playing = false;
          emitSpatialDiagram();
        }
      }
      if (replaySession?.playing) {
        const session = replaySession;
        session.progress = Math.min(1, session.progress + dt / 1.45);
        graphStage.view.pulse(replayEdge(), session.progress);
        if (session.progress >= 1) {
          if (session.step < session.trace.steps.length - 1) {
            session.step++;
            session.progress = 0;
          } else {
            session.playing = false;
          }
          emitReplay();
        }
      }
    } else if (bird) {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const focus = overviewLink ?? overviewFocus;
      if (!overviewFrame || overviewFrame.width !== width || overviewFrame.height !== height || overviewFrame.insets !== viewInsets || overviewFrame.focus !== focus) {
        const points: Position3[] = [];
        const included = new Set(overviewConnections.flatMap(({ from, to }) => [from, to]));
        if (overviewFocus) included.add(overviewFocus);
        if (!focus) points.push(
          { x: cb_.x, y: 0, z: cb_.z }, { x: cb_.x + cb_.w, y: 0, z: cb_.z },
          { x: cb_.x, y: 0, z: cb_.z + cb_.d }, { x: cb_.x + cb_.w, y: 0, z: cb_.z + cb_.d }
        );
        for (const building of layout.city.buildings) {
          if (focus && !included.has(building.id)) continue;
          points.push({ ...building.pos, y: building.size.h + 1.3 });
          if (focus) {
            for (const side of [-1, 1]) for (const end of [-1, 1]) points.push({
              x: building.pos.x + side * (building.size.w / 2 + 1.5),
              y: 0, z: building.pos.z + end * (building.size.d / 2 + 1.5)
            });
          }
        }
        for (const { id } of overviewConnections) {
          points.push(...(linkVisuals.get(id)?.points ?? []).map((point) => ({ ...point, y: 0.43 })));
        }
        overviewFrame = { width, height, insets: viewInsets, focus,
          fit: fitOrthographic(points, width, height, viewRect(width, height, viewInsets, 27), -0.48, 0.81, 1) };
      }
      const { back, distance, halfHeight, target } = overviewFrame.fit;
      camera.projection = pc.PROJECTION_ORTHOGRAPHIC;
      camera.farClip = Math.max(700, 320 + Math.hypot(cb_.w, cb_.d));
      camera.orthoHeight = halfHeight;
      cx = target.x + back.x * distance;
      cz = target.z + back.z * distance;
      camEntity.setPosition(cx, target.y + back.y * distance, cz);
      camEntity.lookAt(target.x, target.y, target.z);
      cameraSnap = true;
    } else {
      camera.projection = pc.PROJECTION_PERSPECTIVE;
      camera.farClip = 700;
      const inside = mode === "interior";
      const cosP = Math.cos(camPitch);
      const backX = -Math.sin(camYaw) * cosP;
      const backZ = -Math.cos(camYaw) * cosP;
      const sideX = -Math.cos(camYaw);
      const sideZ = Math.sin(camYaw);
      const origin = { x: charX, y: charY + groundY + 1.58, z: charZ };
      let fittedArrival = false;
      if (arrival && arrivalActive) {
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        if (!arrivalFrame || arrivalFrame.width !== width || arrivalFrame.height !== height || arrivalFrame.insets !== viewInsets) {
          const wideCampus = Boolean(campus && width >= 850);
          const insets = wideCampus ? { ...viewInsets, bottom: Math.max(viewInsets.bottom, 44) } : viewInsets;
          const safe = viewRect(width, height, insets, 18);
          const points = (wideCampus ? [...arrival.points, ...arrival.neighborPoints] : arrival.points).map((point) => ({
            x: arrival.door.x + point.x, y: point.y, z: arrival.door.z + point.z
          }));
          let yaw = arrival.yaw;
          if (campus) {
            const turn = width < 640 ? 0.36 : width < 850 ? 0.11 : Math.max(-0.08, Math.min(0.08, (1.78 - width / height) * 0.25));
            yaw += turn - 0.08;
          }
          const { axis, entrance } = arrival;
          const yaws = width < 850 ? [yaw, axis, axis - 0.34, axis + 0.34] : [yaw];
          const worldSolids = solids.get(activeWorld) ?? [];
          arrivalFrame = { width, height, insets: viewInsets, fit: fitClearArrivalView({
            points, width, height, rect: safe, yaws, fov: arrival.fov, avatar: origin, entrance,
            canSee: (from, to) => clearBoom(from, to, worldSolids, 0.15) === 1
          }) };
          if (!arrivalFrame.fit) cameraSnap = true;
        }
        if (arrivalFrame.fit) {
          fittedArrival = true;
          const { position, back } = arrivalFrame.fit;
          camera.fov = arrival.fov;
          cameraPosition.set(position.x, position.y, position.z);
          cameraLook.set(position.x - back.x * camDist, position.y - back.y * camDist, position.z - back.z * camDist);
          boomDistance = Math.hypot(position.x - origin.x, position.y - origin.y, position.z - origin.z);
          boomLimit = camDist;
          cameraSnap = false;
        }
      }
      if (!fittedArrival) {
        const fovDifference = followFov - camera.fov;
        if (Math.abs(fovDifference) > 0.01) {
          camera.fov = cameraSnap || reducedMotion ? followFov : camera.fov + fovDifference * (1 - Math.exp(-dt * 9));
        }
        const shoulder = inside ? 0.55 : 0.66;
        const endpoint = {
          x: charX + backX * camDist + sideX * shoulder,
          y: Math.max(0.48, Math.min(inside ? 3.10 : Infinity, origin.y + Math.sin(camPitch) * camDist)),
          z: charZ + backZ * camDist + sideZ * shoulder
        };
        const worldSolids = solids.get(activeWorld) ?? [];
        const clear = (target: Position3): number => {
          const walls = clearBoom(origin, target, worldSolids, 0.18);
          return inside ? Math.min(walls, clearSurface(origin, target, (x, z) => onSurface(activeWorld, x, z), 0.25)) : walls;
        };
        const fraction = clear(endpoint);
        const distance = fraction < 1 ? Math.max(0.06, fraction * camDist - 0.12) : camDist;
        cameraLimited = fraction < 1;
        boomLimit = followBoom(boomLimit, distance, dt, cameraSnap || reducedMotion);
        const t = boomLimit / camDist;
        nextCameraPosition.set(origin.x + (endpoint.x - origin.x) * t, origin.y + (endpoint.y - origin.y) * t, origin.z + (endpoint.z - origin.z) * t);
        const lookSide = Math.min(0.43, shoulder * t);
        nextCameraLook.set(charX + sideX * lookSide + Math.sin(camYaw) * 0.65,
          charY + groundY + 1.43, charZ + sideZ * lookSide + Math.cos(camYaw) * 0.65);
        if (cameraSnap || reducedMotion) {
          cameraPosition.copy(nextCameraPosition);
          cameraLook.copy(nextCameraLook);
          cameraSnap = false;
        } else {
          cameraPosition.lerp(cameraPosition, nextCameraPosition, 1 - Math.exp(-dt * 15));
          cameraLook.lerp(cameraLook, nextCameraLook, 1 - Math.exp(-dt * 18));
          // Clamp a lagging shoulder camera only when its interpolated position clips a solid or leaves the room.
          if (clear(cameraPosition) < 1) cameraPosition.copy(nextCameraPosition);
        }
        boomDistance = Math.hypot(cameraPosition.x - origin.x, cameraPosition.y - origin.y, cameraPosition.z - origin.z);
      }
      cx = cameraPosition.x;
      cz = cameraPosition.z;
      camEntity.setPosition(cameraPosition);
      camEntity.lookAt(cameraLook);
      // When a wall forces a close camera, clear the avatar from the lens
      // while preserving the same controller and collision position.
      avatarVisible = avatarVisibleAt(boomDistance, avatarVisible);
      char.enabled = avatarVisible;
      contactShadow.enabled = avatarVisible;
    }

    // focus
    if (!graphStage && !bird) {
      let best: Interactable | null = null;
      let bestD = Infinity;
      const localX = charX - (activeInteriorId ? interiorRootByBuilding.get(activeInteriorId)?.originX ?? 0 : 0);
      for (const it of interactables) {
        if (it.world !== activeWorld) continue;
        const dx = it.x - localX;
        const dz = it.z - charZ;
        const d2 = dx * dx + dz * dz;
        if (d2 > it.radius * it.radius * 4) continue;
        if (d2 < bestD) {
          bestD = d2;
          best = it;
        }
      }
      if (best !== focused) {
        focused = best;
        cb.onFocus(best ? best.focus : null);
      }
    }

    // labels + player, throttled
    hudTimer += dt;
    if (hudTimer >= 0.12) {
      hudTimer = 0;
      updateIndoorLocation();
      const cam = camEntity.camera;
      const { width, height } = app.graphicsDevice.clientRect;
      if (cam && width > 0 && height > 0) {
        const out = new pc.Vec3();
        const position = camEntity.getPosition();
        const forward = camEntity.forward;
        const safe = graphStage || bird || arrivalActive ? viewRect(width, height, viewInsets) : undefined;
        const activeNode = replaySession?.trace.steps[replaySession.step]?.id;
        const activeEdge = replaySession ? replayEdge() : graphStage?.sequence?.edges[graphStage.sequence.step]?.id;
        const modelRects = new Map<string, ViewRect>();
        for (const [ref, target] of graphStage?.targets ?? []) {
          const node = target.node;
          if (!node) continue;
          const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
          const vertical = node.y === undefined ? [0, node.visualHeight ?? 1.85] : [node.y - 0.4, node.y + 0.4];
          for (const x of [node.x - node.width * 0.57, node.x + node.width * 0.57]) {
            for (const z of [node.z - node.depth * 0.59, node.z + node.depth * 0.59]) {
              for (const y of vertical) {
                cam.worldToScreen(tmpTo.set(x, y, stageDepth + z), out);
                bounds.left = Math.min(bounds.left, out.x);
                bounds.right = Math.max(bounds.right, out.x);
                bounds.top = Math.min(bounds.top, out.y);
                bounds.bottom = Math.max(bounds.bottom, out.y);
              }
            }
          }
          modelRects.set(ref, bounds);
        }
        const list: { d: number; priority: number; x: number; y: number; l: SpaceLabel }[] = [];
        const neighborhood = bird && (overviewFocus || overviewLink) ? new Set([
          overviewFocus, ...overviewConnections.flatMap(({ from, to }) => [from, to])
        ]) : null;
        const visibleLabels = bird ? [...overviewLabels.filter(({ id }) =>
          !neighborhood || !id.startsWith("overview:") || neighborhood.has(id.slice(9))
        ), ...overviewConnections.flatMap(({ id }) => {
          const label = linkVisuals.get(id)?.label;
          return label ? [label] : [];
        })] : labelPoints;
        for (const lp of graphStage?.labels ?? visibleLabels) {
          if (!graphStage && !bird && lp.world !== activeWorld) continue;
          const dx = lp.x - charX;
          const dz = lp.z - charZ;
          const d2 = dx * dx + dz * dz;
          const paddedRange = !graphStage && !bird && previousStreetLabels.has(lp.id) ? lp.range2 * 1.16 : lp.range2;
          if (d2 > paddedRange) continue;
          tmpTo.set(lp.x, lp.y, lp.z);
          cam.worldToScreen(tmpTo, out);
          const projected = labelPosition(tmpTo, position, forward, cam.nearClip, cam.farClip, width, height, out);
          if (!projected) continue;
          if (arrivalActive && !bird && lp.id.startsWith("b:") && clearBoom(position, tmpTo, solids.get("city") ?? [], 0.03) < 1) continue;
          const target = lp.ref ? graphStage?.targets.get(lp.ref) : undefined;
          const active = target && (activeNode !== undefined && target.node?.id === activeNode || activeEdge !== undefined && target.edge === activeEdge);
          const priority = active || lp.ref !== undefined && lp.ref === graphStage?.selectedRef ? 0 : lp.minor ? 2 : 1;
          const physicalPlate = graphStage && graphStage.diagram?.kind !== "matrix" ? target?.node : undefined;
          if (priority > 0 && physicalPlate && physicalPlate.y === undefined && forward.z < -0.63) {
            const plateY = (physicalPlate.group ? 0.103 : 0.002) + 0.68;
            const plateZ = stageDepth + physicalPlate.z + physicalPlate.depth / 2 + 0.036;
            const start = cam.worldToScreen(new pc.Vec3(physicalPlate.x - physicalPlate.width * 0.445,
              plateY + graphPlateHeight / 2, plateZ));
            const end = cam.worldToScreen(new pc.Vec3(physicalPlate.x + physicalPlate.width * 0.445,
              plateY - graphPlateHeight / 2, plateZ));
            const readableHeight = physicalPlate.label.length > 24 ? 35 : 24;
            if (Math.abs(end.y - start.y) >= readableHeight &&
              Math.abs(end.x - start.x) >= Math.min(165, Math.max(58, physicalPlate.label.length * 6.5)) &&
              safe && Math.min(start.x, end.x) >= safe.left && Math.max(start.x, end.x) <= safe.right &&
              Math.min(start.y, end.y) >= safe.top && Math.max(start.y, end.y) <= safe.bottom) continue;
          }
          const importantReplayNode = target?.node && (target.node.kind === "initial" || target.node.kind === "terminal" || target.node.kind === "decision");
          if (graphStage && priority > 0 && target && !lp.badge && (
            graphStage.diagram?.kind === "matrix" || replaySession && (
              target.node ? !importantReplayNode && graphStage.labels.length > 9 : graphStage.labels.length > 12
            ) ||
            target.edge !== undefined && graphStage.labels.length > 15 && graphStage.diagram?.kind !== "sequence")) continue;
          list.push({
            d: d2,
            priority,
            x: out.x,
            y: out.y,
            l: {
              id: lp.id,
              text: lp.text,
              ...projected,
              minor: lp.minor,
              ref: lp.ref,
              active: priority === 0,
              badge: lp.badge
            }
          });
        }
        list.sort((a, b) => a.priority - b.priority || a.d - b.d);
        const accepted: SpaceLabel[] = [];
        const labelRects: ViewRect[] = [...modelRects.values()];
        for (const { l, x, y, priority } of list) {
          if (accepted.length >= (graphStage || bird ? 60 : 28)) break;
          if (safe && graphStage) {
            const metrics = stageLabelMetrics(l, safe.right - safe.left);
            const placed = placeWorldLabel(x, y, metrics.width / 2, metrics.height, safe, labelRects, l.ref ? modelRects.get(l.ref) : undefined);
            if (!placed) continue;
            l.xPct = 100 * placed.x / width;
            l.yPct = 100 * placed.y / height;
            l.lines = metrics.lines;
            l.widthPx = metrics.width;
            labelRects.push(placed.rect);
          } else if (safe) {
            const halfWidth = Math.min(l.minor ? 80 : 68, 9 + l.text.length * (l.minor ? 3.1 : 3.6));
            const labelHeight = l.minor ? 19 : 24;
            const rect = { left: x - halfWidth, right: x + halfWidth, top: y - labelHeight, bottom: y };
            if (rect.left < safe.left || rect.right > safe.right || rect.top < safe.top || rect.bottom > safe.bottom) {
              if (priority !== 0 || x < safe.left || x > safe.right || y < safe.top || y > safe.bottom) continue;
              // Keep the selected or active label readable when its anchor sits near an inset.
              const labelX = Math.max(safe.left + halfWidth, Math.min(safe.right - halfWidth, x));
              l.xPct = 100 * labelX / width;
              l.yPct = 100 * Math.max(safe.top + labelHeight, y) / height;
              rect.left = labelX - halfWidth;
              rect.right = labelX + halfWidth;
              rect.bottom = Math.max(safe.top + labelHeight, y);
              rect.top = rect.bottom - labelHeight;
            }
            if (priority > 0 && labelRects.some((other) => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top)) continue;
            labelRects.push(rect);
          }
          accepted.push(l);
        }
        previousStreetLabels = graphStage || bird ? new Set() : new Set(accepted.map(({ id }) => id));
        cb.onLabels(accepted);
      }
      cb.onPlayer({ x: charX, z: charZ, world: activeWorld });
    }
  };
  app.on("update", onUpdate);

  // Run after the camera has drawn a frame so its frustum reflects the actual
  // entrance or deep link. A mount stays pending through scale and seating.
  const modelSphere = new pc.BoundingSphere();
  let openingStartedAt: number | undefined;
  let nextStreamingPass = 0;
  const onModelFrame = (): void => {
    if (openingModels.status === "failed") return;
    const now = performance.now();
    const opening = openingModels.status === "loading";
    if (!opening && now < nextStreamingPass) return;
    nextStreamingPass = now + 140;
    openingStartedAt ??= now;
    const camera = camEntity.camera!;
    const cameraPosition = camEntity.getPosition();
    const prioritized = new Map<ContainerModel, number>();
    let failed = false;
    for (const mount of pendingMounts) {
      const avatar = mount.avatar && !graphStage && !bird;
      if (!avatar && !mount.parent.enabled) continue;
      const position = mount.parent.getPosition();
      const distance = Math.hypot(position.x - cameraPosition.x, position.y - cameraPosition.y, position.z - cameraPosition.z);
      modelSphere.center.set(position.x, position.y + mount.size * 0.45, position.z);
      modelSphere.radius = mount.size * 0.9;
      const visible = Boolean(camera.frustum.containsSphere(modelSphere));
      // Horizon props are streamed, even when their distant bounds meet the lens.
      const relevant = avatar || (opening ? visible && (Boolean(graphStage) || distance <= 85 + modelSphere.radius)
        : visible || distance <= 110 + modelSphere.radius);
      if (!relevant) continue;
      const priority = avatar ? -2 : visible ? distance : 1_000 + distance;
      if (priority < (prioritized.get(mount.container) ?? Infinity)) prioritized.set(mount.container, priority);
      failed ||= mount.failed;
    }
    if (opening) {
      const next = openingModelsState(prioritized.size, failed, now - openingStartedAt >= 15_000);
      if (next.status !== openingModels.status || next.pending !== openingModels.pending) {
        openingModels = next;
        cb.onOpeningModels?.(next);
      }
      if (next.status === "failed") return;
    }
    for (const clip of queuedAnimationClips) {
      if (clip.result) queuedAnimationClips.delete(clip);
      else prioritized.set(clip, opening ? 1_000 : -1);
    }
    const queued = [...prioritized].filter(([container]) => !container.result && !container.cancel);
    queued.sort((a, b) => a[1] - b[1]);
    for (const [container] of queued.slice(0, Math.max(0, 4 - activeModelLoads))) loadContainer(container);
  };
  app.on("postrender", onModelFrame);

  // --- resize ---------------------------------------------------------------------------------
  const container = canvas.parentElement;
  const resize = (): void => {
    const w = container?.clientWidth ?? window.innerWidth;
    const h = container?.clientHeight ?? window.innerHeight;
    app.resizeCanvas(w, h);
  };
  const ro = new ResizeObserver(resize);
  if (container) ro.observe(container);
  resize();

  app.start();
  cb.onMode("city");
  return {
    focusRef,
    clearTourFocus,
    exitInterior,
    enterBuilding: enterInterior,
    gotoLobby,
    gotoFloor,
    overview: {
      open: () => setOverview(true),
      fit: () => {
        overviewFocus = overviewLink = undefined;
        setOverview(true);
        refreshOverviewLinks();
      },
      focus: focusOverview,
      close: () => setOverview(false)
    },
    activate,
    isNear,
    walkTo,
    stopAuto,
    setTrail,
    setInputBlocked(blocked) {
      inputBlocked = blocked;
      if (blocked && isLocked()) document.exitPointerLock();
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      cameraSnap = true;
    },
    setViewInsets(insets) {
      if (insets.top === viewInsets.top && insets.right === viewInsets.right && insets.bottom === viewInsets.bottom && insets.left === viewInsets.left) return;
      viewInsets = insets;
    },
    motionSnapshot() {
      return {
        world: activeWorld, inputBlocked: isInputBlocked() || isEditing() || Boolean(graphStage) || bird,
        displacement: frameDisplacement, requestedSpeed, speed: resolvedSpeed, animation: locomotion,
        contact: motionContact, collider: motionCollider, cameraDistance: boomDistance, cameraLimited
      };
    },
    replay: {
      open: openReplay,
      select(scenarioId) {
        const trace = replaySession?.traces.find((candidate) => candidate.id === scenarioId);
        if (!trace || !replaySession) return;
        replaySession.trace = trace;
        replaySession.step = 0;
        replaySession.progress = 0;
        replaySession.playing = false;
        emitReplay();
      },
      play() {
        if (!replaySession) return;
        if (replaySession.step === replaySession.trace.steps.length - 1 && replaySession.progress >= 1) {
          replaySession.step = 0;
          replaySession.progress = 0;
        }
        replaySession.playing = true;
        emitReplay();
      },
      pause() {
        if (!replaySession) return;
        replaySession.playing = false;
        emitReplay();
      },
      step(dir) {
        if (!replaySession) return;
        seekReplay(Math.max(0, Math.min(replaySession.trace.steps.length - 1, replaySession.step + dir)));
      },
      seek: seekReplay,
      restart() {
        if (!replaySession) return;
        replaySession.step = 0;
        replaySession.progress = 0;
        replaySession.playing = false;
        emitReplay();
      },
      close() {
        if (replaySession) closeInspect();
      }
    },
    inspect: {
      open: openInspect,
      close: closeInspect,
      play: () => {
        const sequence = graphStage?.sequence;
        if (sequence) {
          if (sequence.progress >= 1 && sequence.step === sequence.edges.length - 1) sequence.step = 0;
          sequence.progress = sequence.progress >= 1 ? 0 : sequence.progress;
          sequence.playing = true;
          emitSpatialDiagram();
        }
      },
      pause: () => {
        if (graphStage?.sequence) {
          graphStage.sequence.playing = false;
          emitSpatialDiagram();
        }
      },
      step: (dir) => {
        const sequence = graphStage?.sequence;
        if (sequence) {
          sequence.step = Math.max(0, Math.min(sequence.edges.length - 1, sequence.step + dir));
          sequence.progress = 1;
          sequence.playing = false;
          emitSpatialDiagram();
        }
      },
      fit: () => {
        if (!graphStage) return;
        graphStage.zoom = 1;
        graphStage.yaw = 0;
      },
      bookmark: () => graphStage?.diagram ? { yaw: graphStage.yaw, zoom: graphStage.zoom, topDown: graphStage.topDown } : undefined,
      restoreBookmark: ({ yaw, zoom, topDown }) => {
        if (!graphStage?.diagram || !Number.isFinite(yaw) || !Number.isFinite(zoom)) return;
        const limit = graphStage.sequence ? 0.27 : 0.9;
        graphStage.yaw = Math.max(-limit, Math.min(limit, yaw));
        graphStage.zoom = Math.max(0.64, Math.min(2.3, zoom));
        graphStage.topDown = Boolean(topDown && graphStage.diagram.kind !== "sequence");
        graphStage.frame = undefined;
        emitSpatialDiagram();
      },
      setTopView: (active) => {
        if (!graphStage?.diagram || graphStage.diagram.kind === "sequence" || Boolean(graphStage.topDown) === active) return;
        graphStage.topDown = active;
        graphStage.frame = undefined;
        emitSpatialDiagram();
      }
    },
    dispose(): void {
      disposed = true;
      for (const container of containerAssetCache.values()) container.cancel?.();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", endStageDrag);
      canvas.removeEventListener("mousedown", onCanvasDown);
      canvas.removeEventListener("click", onCanvasClick);
      canvas.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("keydown", onKeyDown);
      ro.disconnect();
      app.off("update", onUpdate);
      app.off("postrender", onModelFrame);
      if (isLocked()) document.exitPointerLock();
      for (const screen of graphStage?.textures ?? []) {
        screen.material.destroy();
        screen.texture.destroy();
      }
      for (const screen of screens) {
        screen.material.destroy();
        screen.texture.destroy();
      }
      app.destroy();
    }
  };
}
