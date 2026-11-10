import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AskResult, type DocExcerpt } from "../api";
import type { SpaceAssessmentQuestion, SpaceDiagram, SpaceOverlay, SpacePayload, SpaceSource, SpaceTourStop } from "../space-types";
import { questionsFor, readProgress, saveProgress } from "./assessment";
import { cityRelationships } from "./city-relations";
import { DiagramExplanation } from "./DiagramExplanation";
import { diagramKindTitle } from "./diagram-explanation";
import { documentSection, evidenceInRange, evidenceViaSourceLinks, indexReadingEvidence, relatedReadingEvidence, type DocumentTarget, type ReadingEvidence } from "./document-navigation";
import { buildFlowReplay } from "./flow-replay";
import { LearningActivities, type LearningTab } from "./LearningActivities";
import { DiagramPanels, FocusEntrance, ReplayPanels, SourceInspector, type ReadingSelection } from "./LearningPanels";
import { worldHudPanel } from "./viewer-overlays";
import {
  createSpaceViewer,
  type DiagramPlayback,
  type FlowPlayback,
  type PackAssets,
  type SpaceFocus,
  type SpaceHandle,
  type SpaceLabel
} from "./space-engine";

/**
 * Knowledge City viewer — React shell around the deterministic space engine.
 * Owns: HUD labels, focus card, drawer (map of everything), elevator picker,
 * reading mode (real doc excerpts), diagram playback controls, and the tour
 * with checkpoints. The 3D itself lives in space-engine.ts.
 */

type DrawerTab = "buildings" | "diagrams" | "flows" | "docs" | "learn" | "guide";
type DiagramReturn = { diagram: string; selection?: string; camera?: ReturnType<SpaceHandle["inspect"]["bookmark"]>; flow: string; view: "Explain" | "Inspect" };

function unlockView(): void {
  if (document.pointerLockElement) document.exitPointerLock();
}

export interface OfflineSpace {
  payload: SpacePayload;
  packRoles: string[];
  assetBase: string;
  overlays?: SpaceOverlay[];
}

interface SpaceViewerProps {
  id?: string;
  onExit?: () => void;
  offline?: OfflineSpace;
  draftJobId?: string;
  initialArtifact?: string;
  guideAgent?: string;
  guideModel?: string;
}

export default function SpaceViewer(props: SpaceViewerProps) {
  const [attempt, setAttempt] = useState(0);
  return <SpaceViewerAttempt key={attempt} {...props} retry={() => setAttempt((current) => current + 1)} />;
}

function SpaceViewerAttempt({
  id, onExit, offline, draftJobId, initialArtifact, guideAgent, guideModel, retry
}: SpaceViewerProps & { retry: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<SpaceHandle | null>(null);
  const [payload, setPayload] = useState<SpacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cityReady, setCityReady] = useState(false);
  const setWorldInert = useCallback((element: HTMLDivElement | null) => {
    if (element) element.inert = !cityReady;
  }, [cityReady]);
  const [labels, setLabels] = useState<SpaceLabel[]>([]);
  const [focus, setFocus] = useState<SpaceFocus | null>(null);
  const [interiorLocation, setInteriorLocation] = useState<"lobby" | "floor" | "corridor" | null>(null);
  const [workshopWalk, setWorkshopWalk] = useState<{ ref: string; state: "walking" | "arrived" | "stopped" } | null>(null);
  const [locked, setLocked] = useState(false);
  const [mode, setMode] = useState<{ name: "city" | "interior"; buildingId?: string }>({
    name: "city"
  });
  const [inspect, setInspect] = useState<DiagramPlayback | null>(null);
  const [replay, setReplay] = useState<FlowPlayback | null>(null);
  const [explainId, setExplainId] = useState<string>();
  const [diagramReturn, setDiagramReturn] = useState<DiagramReturn | null>(null);
  const [pinDirectory, setPinDirectory] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<DrawerTab>("buildings");
  const [lesson, setLesson] = useState<LearningTab>("tour");
  const [lessonScope, setLessonScope] = useState("");
  const [overview, setOverview] = useState(false);
  const [search, setSearch] = useState("");
  const [elevator, setElevator] = useState<{
    buildingId: string;
    floors: { id: string; title: string }[];
  } | null>(null);
  const [reading, setReading] = useState<ReadingSelection | null>(null);
  const [readingTrail, setReadingTrail] = useState<ReadingSelection[]>([]);
  const [readingResume, setReadingResume] = useState<{ selection: ReadingSelection; trail: ReadingSelection[] } | null>(null);
  const readingRequest = useRef(0);
  const readingScroll = useRef(0);
  const [tourIdx, setTourIdx] = useState<number | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [tourAnswers, setTourAnswers] = useState<Record<number, boolean>>({});
  const [tourResume, setTourResume] = useState<number | null>(null);
  const [found, setFound] = useState(false);
  const [walking, setWalking] = useState(false);
  const [walkCancelled, setWalkCancelled] = useState(false);
  const [arrived, setArrived] = useState(true);
  const [auto, setAuto] = useState(false);
  const [autoArrived, setAutoArrived] = useState<string | null>(null);
  const [trophy, setTrophy] = useState<{ correct: number; asked: number; stops: number } | null>(null);
  const [overlays, setOverlays] = useState<SpaceOverlay[] | null>(null);
  const [packRoles, setPackRoles] = useState<Set<string> | null>(null);
  const [guideQ, setGuideQ] = useState("");
  const [guideBusy, setGuideBusy] = useState(false);
  const [guideA, setGuideA] = useState<AskResult | null>(null);
  const [guideReplay, setGuideReplay] = useState<SpaceAssessmentQuestion["replay"]>();
  const [guideReading, setGuideReading] = useState<{ source: SpaceSource; title: string } | null>(null);
  const [textScale] = useState(() => {
    const value = readProgress("kodyurd:text-scale");
    return value === 1.15 || value === 1.3 ? value : 1;
  });

  useEffect(() => {
    if (offline) {
      setPayload(offline.payload);
      setPackRoles(new Set(offline.packRoles));
      setOverlays(offline.overlays ?? []);
      return;
    }
    if (!id) return;
    const controller = new AbortController();
    const { signal } = controller;
    const deadline = window.setTimeout(() => {
      controller.abort();
      setError("The city data took too long to load. Try opening it again.");
    }, 20_000);
    Promise.all([
      draftJobId ? api.draft(id, draftJobId, signal) : api.space(id, signal),
      api.packManifest(signal),
      api.overlays(id, false, signal)
    ]).then(([scene, manifest, personal]) => {
      if (signal.aborted) return;
      setPayload(scene);
      setPackRoles(new Set(manifest.assets.map(({ role }) => role)));
      setOverlays(personal.items);
    }).catch((error: unknown) => {
      if (signal.aborted) return;
      controller.abort();
      setError(error instanceof Error ? error.message : "Could not read the city data.");
    }).finally(() => window.clearTimeout(deadline));
    return () => {
      controller.abort();
      window.clearTimeout(deadline);
    };
  }, [id, offline, draftJobId]);

  useEffect(() => {
    if (error || !payload || !canvasRef.current || packRoles === null || overlays === null) return;
    const assets: PackAssets = {
      has: (role) => packRoles.has(role),
      urlFor: (role) => (offline ? `${offline.assetBase}${role}.glb` : `/api/assets/pack/${role}.glb`)
    };
    let handle: SpaceHandle;
    let openingExpired = false;
    const deadline = window.setTimeout(() => {
      openingExpired = true;
      setError("The opening models took too long to load. Try opening the city again.");
    }, 25_000);
    try {
      handle = createSpaceViewer(canvasRef.current, payload, {
        onOpeningModels: ({ status }) => {
          if (openingExpired || status === "loading") return;
          window.clearTimeout(deadline);
          if (status === "ready") setCityReady(true);
          else setError("The opening models could not be loaded. Try opening the city again.");
        },
        onFocus: setFocus,
        onLabels: setLabels,
        onLock: setLocked,
        onPlayer: () => undefined,
        onMode: (name, buildingId) => { setMode({ name, buildingId }); setWorkshopWalk(null); setPinDirectory(false); },
        onInteriorLocation: setInteriorLocation,
        onOpenDirectory: (tab) => { unlockView(); setTab(tab); setDrawer(true); },
        onOverview: setOverview,
        onInspect: setInspect,
        onReplay: setReplay,
        onElevator: (buildingId, floors) => {
          unlockView();
          setElevator({ buildingId, floors });
        },
        onAutoArrive: (ref) => {
          setAutoArrived(ref);
          setWorkshopWalk((walk) => walk?.ref === ref ? { ...walk, state: "arrived" } : walk);
        },
        onAutoCancel: (ref) => {
          setWorkshopWalk((walk) => walk?.ref === ref ? { ...walk, state: "stopped" } : walk);
          setAuto(false);
          setWalking(false);
          setWalkCancelled(true);
          setArrived(false);
        }
      }, assets, overlays);
    } catch (error) {
      window.clearTimeout(deadline);
      setError(error instanceof Error ? error.message : "Could not start the city viewer.");
      return;
    }
    handleRef.current = handle;
    const linkedDiagram = payload.space.diagrams.find(({ id }) => id === initialArtifact);
    if (linkedDiagram) {
      handle.focusRef(linkedDiagram.id);
      setExplainId(linkedDiagram.kind === "graph" || linkedDiagram.kind === "erd" ? linkedDiagram.id : undefined);
    } else if (initialArtifact && payload.space.flows.some(({ id }) => id === initialArtifact)) handle.focusRef(initialArtifact);
    const systemMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let motion: string | null = null;
    try {
      motion = localStorage.getItem("kodyurd:motion");
    } catch {
      // The OS preference remains available without local storage.
    }
    const updateMotion = (): void => handle.setReducedMotion(motion === "reduce" || (motion !== "full" && systemMotion.matches));
    updateMotion();
    systemMotion.addEventListener("change", updateMotion);
    return () => {
      openingExpired = true;
      window.clearTimeout(deadline);
      handleRef.current = null;
      systemMotion.removeEventListener("change", updateMotion);
      handle.dispose();
    };
  }, [payload, packRoles, overlays, initialArtifact, offline, error]);

  useEffect(() => {
    handleRef.current?.setInputBlocked(!cityReady || Boolean(drawer || reading || elevator || trophy));
    if (drawer) {
      handleRef.current?.replay.pause();
      handleRef.current?.inspect.pause();
    }
  }, [cityReady, drawer, reading, elevator, trophy, payload, packRoles, overlays]);

  const openReading = useCallback(
    ({ path, from, to, anchor }: DocumentTarget, title?: string, asDocument = false) => {
      unlockView();
      handleRef.current?.replay.pause();
      handleRef.current?.inspect.pause();
      const request = ++readingRequest.current;
      readingScroll.current = 0;
      const selection = { path, startLine: from, endLine: to, title, document: asDocument };
      if (offline || !id) {
        setReading({
          ...selection,
          error:
            "Open the original workspace in Kodyurd to read this source excerpt."
        });
        return;
      }
      setReading(selection);
      api
        .doc(id, path, from, to, asDocument)
        .then(async (excerpt: DocExcerpt) => {
          if (readingRequest.current !== request) return;
          const section = anchor && documentSection(excerpt.sections, anchor);
          if (anchor && !section) {
            setReading({ ...selection, excerpt, error: "The linked heading was not found. Choose a section below." });
            return;
          }
          if (section && (section.startLine !== excerpt.from || section.endLine !== excerpt.to)) {
            excerpt = await api.doc(id, path, section.startLine, section.endLine, asDocument);
          }
          if (readingRequest.current === request) setReading({ ...selection, startLine: excerpt.from, endLine: excerpt.to, excerpt });
        })
        .catch((e: Error) => {
          if (readingRequest.current === request) setReading({ ...selection, error: e.message });
        });
    },
    [id, offline]
  );
  const openSource = useCallback((source: SpaceSource, title?: string): void => {
    openReading({ path: source.path, from: source.startLine, to: source.endLine }, title, /\.md$/i.test(source.path));
  }, [openReading]);
  const closeReading = useCallback((): void => {
    readingRequest.current += 1;
    setReading(null);
    setReadingTrail([]);
  }, []);
  const captureReading = (selection: ReadingSelection): ReadingSelection => {
    const root = canvasRef.current?.parentElement;
    const openEvidencePanels = Array.from(root?.querySelectorAll<HTMLDetailsElement>(".kd-source-inspector details[data-reading-evidence][open]") ?? [])
      .flatMap(({ dataset }) => dataset.readingEvidence ? [dataset.readingEvidence] : []);
    return { ...selection, scrollTop: readingScroll.current, openEvidencePanels };
  };
  const restoreReading = (selection: ReadingSelection): void => {
    readingRequest.current += 1;
    readingScroll.current = selection.scrollTop ?? 0;
    unlockView();
    handleRef.current?.replay.pause();
    handleRef.current?.inspect.pause();
    setReading(selection);
  };
  const browseReading = (target: DocumentTarget, asDocument = /\.md$/i.test(target.path)): void => {
    setReadingTrail([]);
    setReadingResume(null);
    openReading(target, undefined, asDocument);
  };
  const resumeReading = (): void => {
    if (!readingResume) return;
    restoreReading(readingResume.selection);
    setReadingTrail(readingResume.trail);
    setReadingResume(null);
    setDrawer(false);
  };

  const editorAction = async (action: "open" | "copy"): Promise<void> => {
    if (!reading) return;
    const request = readingRequest.current;
    const line = reading.startLine ?? reading.excerpt?.from;
    let pathLine = `${reading.path}${line ? `:${line}` : ""}`;
    let editorStatus: string;
    try {
      const result = !offline && id ? await api.openInEditor(id, reading.path, line, action) : undefined;
      pathLine = result?.pathLine ?? pathLine;
      if (request !== readingRequest.current) return;
      if (action === "copy") {
        await navigator.clipboard.writeText(pathLine);
        editorStatus = "Source location copied.";
      } else {
        editorStatus = result?.status === "dispatched"
          ? `Open request sent to ${result.editor ?? "your editor"}.`
          : result?.message ?? "Copy the source location to open it in your editor.";
      }
    } catch (error) {
      editorStatus = action === "copy" ? "Select the source location below to copy it." : error instanceof Error ? error.message : "Editor could not open.";
    }
    if (request === readingRequest.current) setReading((current) => current && { ...current, editorStatus, pathLine });
  };

  const focusSource = focus?.source ?? (focus?.sourcePath ? { path: focus.sourcePath } : undefined);
  const selectedDiagramItem = inspect && focus && (focus.kind === "node" || focus.kind === "edge") ? focus : undefined;
  const activeSource = replay ? replay.source : selectedDiagramItem?.source ?? inspect?.source ?? focusSource;

  // Preserve native keyboard navigation when a UI control owns focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!cityReady) return;
      if (e.code === "Escape") {
        if (reading) closeReading();
        else if (elevator) setElevator(null);
        else if (drawer) setDrawer(false);
        else if (trophy) setTrophy(null);
        return;
      }
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("button, input, select, textarea, a, [contenteditable], [tabindex]")) return;
      if (e.code === "KeyF" && activeSource && !reading) openSource(activeSource, replay?.caption ?? focus?.title);
      if (e.code === "Tab" && document.pointerLockElement === canvasRef.current) {
        e.preventDefault();
        unlockView();
        setDrawer((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cityReady, activeSource, focus?.title, replay?.caption, reading, drawer, elevator, trophy, openSource, closeReading]);

  const space = payload?.space;
  const flowsWithTraces = useMemo(() => (space?.flows ?? []).map((flow) => ({ flow, traces: buildFlowReplay(flow).traces })), [space]);
  const readingIndex = useMemo(() => indexReadingEvidence(space?.diagrams ?? [], flowsWithTraces), [space, flowsWithTraces]);
  const readingEvidence = useMemo(() => {
    if (!reading) return [];
    const from = reading.excerpt?.from ?? reading.startLine ?? 1;
    const to = reading.excerpt?.to ?? reading.endLine ?? from;
    return relatedReadingEvidence(readingIndex.get(reading.path.replaceAll("\\", "/")) ?? [], from, to);
  }, [reading, readingIndex]);
  const readingLibrary = useMemo(() => {
    const coverage = space?.meta.coverage ?? [];
    const query = search.trim().toLowerCase();
    const matches = (path: string): boolean => path.toLowerCase().includes(query);
    const documented = new Set(coverage.map(({ doc }) => doc.replaceAll("\\", "/")));
    const sources = [...readingIndex].filter(([path]) => !documented.has(path) && matches(path))
      .sort(([a], [b]) => a.localeCompare(b));
    return { docs: coverage.filter(({ doc }) => matches(doc)), sources, hasDocs: coverage.length > 0 };
  }, [space, search, readingIndex]);
  const start = space?.presentation?.start;
  const startBuilding = space?.city.buildings.find((building) => building.id === start?.building);
  const startFlow = space?.flows.find((flow) => flow.id === start?.flow);
  const startDiagram = space?.diagrams.find((diagram) => diagram.id === start?.diagram);
  const activeDiagram = space?.diagrams.find((diagram) => diagram.id === inspect?.diagramId);
  const explaining = Boolean(inspect?.spatial && activeDiagram && activeDiagram.id === explainId);
  const diagramOwner = (inspect?.owner ?? mode.buildingId)?.split(":")[0];
  const diagramFlow = startFlow?.scope === `module:${diagramOwner}`
    ? startFlow
    : space?.flows.find((flow) => flow.scope === `module:${diagramOwner}`);
  const relatedExplanationReplays = useMemo(() => {
    const source = selectedDiagramItem?.source;
    if (!activeDiagram || !source?.startLine) return [];
    const from = source.startLine;
    const to = source.endLine ?? from;
    const owner = activeDiagram.owner.split(":")[0];
    const allowed = new Set(flowsWithTraces.filter(({ flow }) => owner === "city" || flow.scope === `module:${owner}`).map(({ flow }) => flow.id));
    return (readingIndex.get(source.path.replaceAll("\\", "/")) ?? []).flatMap((item) =>
      item.kind === "replay" && item.target.stepIndex !== undefined && allowed.has(item.target.flow) && evidenceInRange(item.source, from, to)
        ? [item] : []).slice(0, 6);
  }, [activeDiagram, selectedDiagramItem, flowsWithTraces, readingIndex]);
  const stops: SpaceTourStop[] = space?.tour ?? [];
  const stop = tourIdx !== null ? stops[tourIdx] : undefined;
  const progressKey = space && `kodyurd:learn:${draftJobId ?? id ?? space.meta.sourceDir}:${space.meta.createdAt}`;
  const guideCitations: NonNullable<AskResult["citations"]> = guideA?.citations?.length ? guideA.citations : (guideA?.sources ?? []).map((path) => ({ path }));
  const replayBuilding = space?.flows.find(({ id }) => id === replay?.flowId)?.scope.split(":")[1];
  const tourKey = progressKey && `${progressKey}:tour`;
  const score = { asked: Object.keys(tourAnswers).length, correct: Object.values(tourAnswers).filter(Boolean).length };
  const questions = useMemo(() => space ? questionsFor(space) : [], [space]);
  const overviewLinks = useMemo(() => space ? cityRelationships(space) : [], [space]);
  const scopedQuestions = lessonScope ? questions.filter((question) => question.building === lessonScope) : questions;
  const openLearning = (next: LearningTab, building = ""): void => {
    unlockView();
    handleRef.current?.replay.pause();
    setLesson(next);
    setLessonScope(building && questions.some((question) => question.building === building) ? building : "");
    setTab("learn");
    setDrawer(true);
  };
  const openDiagramLibrary = (): void => {
    unlockView();
    setSearch("");
    setTab("diagrams");
    setDrawer(true);
  };
  const openDiagram = (diagram: SpaceDiagram): void => {
    unlockView();
    handleRef.current?.focusRef(diagram.id);
    setExplainId(diagram.kind === "graph" || diagram.kind === "erd" ? diagram.id : undefined);
    setDrawer(false);
  };
  const openReplay = ({ flow, scenario, step, stepIndex }: NonNullable<SpaceAssessmentQuestion["replay"]>): boolean => {
    const handle = handleRef.current;
    const bookmark: DiagramReturn | undefined = inspect?.spatial && activeDiagram ? {
      diagram: activeDiagram.id, selection: selectedDiagramItem?.ref, camera: handle?.inspect.bookmark(), flow,
      view: explaining ? "Explain" : "Inspect"
    } : undefined;
    if (!handle?.replay.open(flow, { scenarioId: scenario, stepId: step, stepIndex })) return false;
    if (bookmark) setDiagramReturn(bookmark);
    else if (replay?.flowId !== flow) setDiagramReturn(null);
    setDrawer(false);
    return true;
  };
  const replayFlowId = replay?.flowId;
  useEffect(() => {
    if (!replayFlowId) setDiagramReturn(null);
  }, [replayFlowId]);
  const restoreDiagram = (): void => {
    const handle = handleRef.current;
    if (!diagramReturn || !handle) return;
    handle.focusRef(diagramReturn.diagram);
    if (diagramReturn.selection) handle.focusRef(diagramReturn.selection);
    if (diagramReturn.camera) handle.inspect.restoreBookmark(diagramReturn.camera);
    setExplainId(diagramReturn.view === "Explain" ? diagramReturn.diagram : undefined);
    setDiagramReturn(null);
  };
  const openGuide = (documentContext: typeof guideReading = null): void => {
    handleRef.current?.replay.pause();
    handleRef.current?.inspect.pause();
    unlockView();
    setGuideReading(documentContext);
    setTab("guide");
    setDrawer(true);
  };
  const openReadingEvidence = (item: ReadingEvidence): void => {
    const handle = handleRef.current;
    if (!reading || !handle) return;
    if (item.kind === "replay") {
      if (!openReplay(item.target)) return;
    } else {
      handle.focusRef(item.id);
      if (item.itemRef) handle.focusRef(item.itemRef);
      setExplainId(item.id);
    }
    setReadingResume({ selection: captureReading(reading), trail: readingTrail });
    closeReading();
    setDrawer(false);
  };

  useEffect(() => {
    if (!tourKey) return;
    const progress = readProgress(tourKey) as { index?: number; answers?: Record<number, boolean> } | undefined;
    const index = progress?.index;
    setTourResume(typeof index === "number" && Number.isInteger(index) && index >= 0 && index < stops.length ? index : null);
    setTourAnswers(Object.fromEntries(Object.entries(progress?.answers ?? {}).filter(([index, answer]) => (
      typeof answer === "boolean" && stops[Number(index)]?.checkpoint
    ))));
  }, [tourKey, stops.length]);

  useEffect(() => {
    if (!pick || answered) return;
    const timer = window.setTimeout(() => setPick(null), 900);
    return () => window.clearTimeout(timer);
  }, [pick, answered, tourIdx]);

  const goToStop = (idx: number): void => {
    const s = stops[idx];
    if (!s) return;
    setTourIdx(idx);
    setTourResume(idx);
    if (tourKey) saveProgress(tourKey, { index: idx, answers: tourAnswers });
    setPick(null);
    setFound(false);
    setWalkCancelled(false);
    setAnswered(!s.checkpoint && !s.locate);
    handleRef.current?.setTrail(s.ref);
    if (s.locate) {
      handleRef.current?.stopAuto();
      setWalking(false);
      setArrived(true);
    } else if (auto) {
      const isWalking = handleRef.current?.walkTo(s.ref) ?? false;
      setWalking(isWalking);
      setArrived(!isWalking);
    } else {
      handleRef.current?.focusRef(s.ref);
      setWalking(false);
      setArrived(true);
    }
  };
  const endTour = (): void => {
    setTourIdx(null);
    setWalking(false);
    setAuto(false);
    handleRef.current?.setTrail(null);
    handleRef.current?.stopAuto();
    handleRef.current?.clearTourFocus();
  };

  const finishTour = (): void => {
    setTrophy({ correct: score.correct, asked: score.asked, stops: stops.length });
    endTour();
    setTourResume(null);
    if (tourKey) saveProgress(tourKey, { index: null, answers: {} });
  };

  const startTour = (index = 0, restart = false): void => {
    if (restart) setTourAnswers({});
    setDrawer(false);
    unlockView();
    handleRef.current?.replay.close();
    handleRef.current?.inspect.close();
    handleRef.current?.overview.close();
    goToStop(index);
    if (restart && tourKey) saveProgress(tourKey, { index, answers: {} });
  };

  // Locate quests: the stop completes when the walker actually reaches the ref.
  useEffect(() => {
    if (!stop?.locate) return;
    const target = stop.ref;
    const hasCheckpoint = Boolean(stop.checkpoint);
    const t = window.setInterval(() => {
      if (handleRef.current?.isNear(target, 8)) {
        setFound(true);
        if (!hasCheckpoint) setAnswered(true);
        window.clearInterval(t);
      }
    }, 400);
    return () => window.clearInterval(t);
  }, [stop]);

  // Autopilot: mark arrival, then advance after a narration-sized pause.
  useEffect(() => {
    if (!autoArrived) return;
    if (stop && autoArrived === stop.ref) {
      setWalking(false);
      setArrived(true);
    }
    setAutoArrived(null);
  }, [autoArrived, stop]);

  useEffect(() => {
    if (!auto || drawer || reading || tourIdx === null || !stop) return;
    if (!answered || !arrived) return;
    const ms = Math.min(9000, 2800 + stop.narration.length * 30);
    const t = window.setTimeout(() => {
      if (tourIdx + 1 >= stops.length) finishTour();
      else goToStop(tourIdx + 1);
    }, ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, answered, arrived, tourIdx, stop, drawer, reading]);

  const searchHits = useMemo(() => {
    if (!space || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return space.navigation.searchIndex
      .filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          (s.keywords ?? []).some((k) => k.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [space, search]);

  const diagramDirectory = useMemo(() => {
    const buildings = new Map(space?.city.buildings.map(({ id, title }) => [id, title]));
    const query = search.trim().toLowerCase();
    const rows = (space?.diagrams ?? []).map((diagram) => ({
      diagram,
      owner: diagram.owner === "city" ? "City" : buildings.get(diagram.owner.split(":")[0]) ?? "Building",
      kind: diagramKindTitle[diagram.kind]
    })).filter(({ diagram, owner, kind }) => `${diagram.title} ${owner} ${kind}`.toLowerCase().includes(query));
    const isArchitecture = ({ diagram }: typeof rows[number]): boolean => diagram.kind === "graph" || diagram.kind === "stack" || diagram.kind === "erd";
    return [
      { title: "Architecture", rows: rows.filter(isArchitecture) },
      { title: "Behavior and rules", rows: rows.filter((row) => !isArchitecture(row)) }
    ].filter((group) => group.rows.length > 0);
  }, [space, search]);

  const districts = useMemo(() => {
    if (!space) return [];
    return space.city.districts.map((d) => ({
      district: d,
      buildings: space.city.buildings.filter((b) => b.district === d.id)
    }));
  }, [space]);

  const interiorsByBuilding = useMemo(() => {
    const m = new Map<string, { id: string; title: string }[]>();
    for (const it of space?.interiors ?? []) {
      m.set(
        it.building,
        it.floors.map((f) => ({ id: f.id, title: f.title }))
      );
    }
    return m;
  }, [space]);

  const spatialStage = Boolean(replay || inspect?.spatial);
  const stageTransport = Boolean(replay || inspect?.kind === "sequence" && !explaining);
  const showEntrance = Boolean(mode.name === "city" && startBuilding && (startFlow || startDiagram) &&
    !overview && !locked && !drawer && !reading && !inspect && !replay && !stop);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.parentElement;
    const handle = handleRef.current;
    if (!canvas || !root || !handle) return;

    const hud = root.querySelector<HTMLElement>(".kd-city-hud");
    const panel = root.querySelector<HTMLElement>(reading ? ".kd-source-inspector"
      : spatialStage ? ".kd-replay-inspector" : overview ? ".kd-city-map" : ".kd-entrance");
    const transport = spatialStage ? root.querySelector<HTMLElement>(".kd-replay-transport") : null;
    const measure = (): void => {
      const bounds = canvas.getBoundingClientRect();
      const panelBounds = panel?.getBoundingClientRect();
      const stacked = Boolean(panelBounds && panelBounds.width > bounds.width * 0.55);
      const hudHeight = Math.max(0, (hud?.getBoundingClientRect().bottom ?? bounds.top) - bounds.top);
      root.style.setProperty("--kd-hud-bottom", `${hudHeight + 8}px`);
      root.style.setProperty("--kd-stage-panel-height", `${stacked ? panelBounds?.height ?? 0 : 0}px`);
      const top = Math.max(hudHeight,
        overview && stacked && panelBounds ? panelBounds.bottom - bounds.top : 0);
      const right = panelBounds && !stacked ? Math.max(0, bounds.right - panelBounds.left + 10) : 0;
      const panelBottom = panelBounds && stacked && !overview ? bounds.bottom - panelBounds.top : 0;
      const transportBottom = transport ? bounds.bottom - transport.getBoundingClientRect().top : 0;
      const bottom = Math.max(0, panelBottom, transportBottom);
      if (!spatialStage || !drawer) handle.setViewInsets({ top, right, bottom, left: 0 });
    };
    const observer = new ResizeObserver(measure);
    for (const element of [canvas, hud, panel, transport]) if (element) observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--kd-stage-panel-height");
      root.style.removeProperty("--kd-hud-bottom");
    };
  }, [spatialStage, stageTransport, explaining, showEntrance, overview, drawer, reading, payload, packRoles, overlays]);

  const eHint =
    focus?.kind === "door-enter"
      ? focus.hint === "corridor"
        ? "E — walk this flow"
        : focus.hint === "no-interior"
          ? undefined
          : "E — enter"
      : focus?.kind === "directory"
        ? `E — open ${focus.title}`
      : focus?.kind === "station" && focus.hint === "playback"
        ? "E — inspect this step"
      : focus?.kind === "door-exit"
        ? "E — back to the city"
        : focus?.kind === "elevator"
          ? "E — choose a floor"
          : focus?.kind === "gate"
            ? "E — open the gate"
            : focus?.kind === "building"
              ? focus.hint === "related-flow"
                ? "E — open related scenario"
                : focus.hint === "no-diagram" ? "Building map unavailable in this revision" : "E — inspect (live diagram)"
              : focus?.kind === "panel" || focus?.kind === "centerpiece" && focus.hint === "open diagram"
                ? "E — open diagram"
                : undefined;
  const interaction = eHint?.startsWith("E — ") ? eHint.slice(4) : undefined;
  const showWorldHud = !replay && !inspect && !drawer && !reading && !stop && !elevator;
  const hasDirectory = Boolean(showWorldHud && interiorLocation === "lobby" && mode.buildingId && !locked && !overview);
  const hasNearby = Boolean(showWorldHud && focus && !showEntrance);
  const hudPanel = worldHudPanel(hasDirectory, hasNearby, Boolean(interaction || focusSource), pinDirectory);
  const showDirectory = hudPanel === "directory";
  const showNearby = hudPanel === "nearby";
  const walkStatus = workshopWalk && showWorldHud && !overview
    ? workshopWalk.state === "walking" ? "Walking to the workshop…" : workshopWalk.state === "arrived" ? "Workshop reached" : "Workshop walk stopped"
    : undefined;

  return (
    <div className={`kd-space${spatialStage ? " kd-space-stage" : ""}${explaining ? " kd-space-explain" : ""} kd-text-${textScale === 1.3 ? "large" : textScale === 1.15 ? "medium" : "normal"} relative h-dvh w-full overflow-hidden`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div ref={setWorldInert} aria-hidden={!cityReady || undefined}>

      {/* world labels */}
      {labels.map((label) => {
        const position = { left: `${label.xPct}%`, top: `${label.yPct}%`, width: label.widthPx };
        const placement = "absolute -translate-x-1/2 -translate-y-full rounded";
        const measured = label.lines ? " kd-world-measured" : "";
        const text = label.lines?.join("\n") ?? label.text;
        const ref = label.ref;
        return ref ? (
          <button
            key={label.id}
            type="button"
            className={`${placement} kd-world-select px-2 py-1 text-[11px]${measured || " max-w-40 truncate"}${spatialStage && label.minor ? " kd-world-edge-label" : ""}${label.active ? " kd-world-active" : ""}${label.badge ? " kd-world-row" : ""}`}
            style={position}
            title={label.text}
            aria-label={label.badge ? `Decision row ${label.text}` : label.text}
            onClick={() => handleRef.current?.focusRef(ref)}
          >
            {text}
          </button>
        ) : (
          <div
            key={label.id}
            className={`${placement} pointer-events-none ${measured || " whitespace-nowrap"} ${spatialStage ? "kd-world-group-label" : label.minor
              ? "bg-black/40 px-1.5 py-0.5 text-[10px] text-white/90"
              : "bg-black/60 px-2 py-0.5 text-xs font-semibold text-white"}`}
            style={position}
          >
            {text}
          </div>
        );
      })}

      {/* top bar */}
      <div className="kd-city-hud">
        <div className="kd-space-top kd-city-title">
          <span className="truncate font-bold">{space?.meta.name ?? "Kodyurd"}</span>
          {draftJobId && <span className="kd-draft-badge">Draft</span>}
          {mode.name === "interior" && (
            <>
              <span className="truncate text-xs text-[#506762]">
                · {space?.city.buildings.find((b) => b.id === mode.buildingId)?.title}
              </span>
              <button
                type="button"
                className="kd-hud-link"
                onClick={() => handleRef.current?.exitInterior()}
              >
                ← City
              </button>
              <button type="button" className="kd-hud-link" onClick={() => { setWorkshopWalk(null); handleRef.current?.gotoLobby(); }}>Lobby</button>
            </>
          )}
        </div>
        <div className="kd-hud-actions">
          {readingResume && !reading && !drawer && <button type="button" className="kd-space-top" onClick={resumeReading}>↶ Resume reading</button>}
          <button type="button" className="kd-space-top" aria-pressed={overview} onClick={() => {
            unlockView();
            if (overview) handleRef.current?.overview.close();
            else handleRef.current?.overview.open();
          }}>{overview ? "Street view" : "City map"}</button>
          {Boolean(space?.diagrams.length) && <button type="button" className="kd-space-top" onClick={openDiagramLibrary}>Diagrams</button>}
          <button type="button" className="kd-space-top" onClick={() => openLearning("tour", mode.buildingId)}>Learn</button>
          <button
            type="button"
            className="kd-space-top"
            aria-expanded={drawer}
            onClick={() => {
              unlockView();
              setDrawer((v) => !v);
            }}
          >
            ☰ Menu <span className="hidden sm:inline">(Tab)</span>
          </button>
          {onExit && (
            <button
              type="button"
              className="kd-space-top"
              onClick={onExit}
            >
              Exit
            </button>
          )}
        </div>
      </div>

      {walkStatus && !showDirectory && !showNearby && (
        <p role="status" className="pointer-events-none absolute bottom-4 left-1/2 z-[3] max-w-[80vw] -translate-x-1/2 rounded-lg bg-[#edf1e4] px-4 py-2 text-center text-sm font-semibold text-[#234944] shadow">
          {walkStatus}
        </p>
      )}

      {payload && !locked && !overview && !drawer && !reading && !elevator && !replay && !inspect && !stop && !focus && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/70 px-3 py-2 text-[11px] text-white backdrop-blur">
          Click to look around · WASD walk · E interact · M map
        </div>
      )}

      {overview && !drawer && !reading && (
        <aside className="kd-learn-card kd-city-map" aria-label="City overview">
          <div className="kd-learn-heading"><div className="kd-learn-eyebrow"><span /> City overview</div>
            <button type="button" className="kd-learn-icon" aria-label="Close city overview" onClick={() => handleRef.current?.overview.close()}>×</button>
          </div>
          <p>Locate a building to see its connections, or select a specific connection below.</p>
          <button type="button" className="kd-learn-action" onClick={() => handleRef.current?.overview.fit()}>Fit city</button>
          {startBuilding && <button type="button" className="kd-learn-action" onClick={() => handleRef.current?.overview.focus(startBuilding.id)}>Locate {startBuilding.title}</button>}
          {payload?.layout.city.campus && space && <details className="kd-lesson-review-item">
            <summary>Buildings ({space.city.buildings.length})</summary>
            {space.city.buildings.map((building) => <button key={building.id} type="button" className="kd-learn-action"
              onClick={() => handleRef.current?.overview.focus(building.id)}>{building.title}</button>)}
          </details>}
          {overviewLinks.length > 0 && <details className="kd-lesson-review-item">
            <summary>Source-linked connections ({overviewLinks.length})</summary>
            {overviewLinks.map((link) => <button key={link.id} type="button" className="kd-learn-action" onClick={() => handleRef.current?.focusRef(link.id)}>{link.title}</button>)}
          </details>}
        </aside>
      )}

      {showEntrance && startBuilding && (
        <FocusEntrance
          title={startBuilding.title}
          flowTitle={startFlow?.title}
          startFlow={startFlow && (() => openReplay({ flow: startFlow.id }))}
          showMap={startDiagram && (() => openDiagram(startDiagram))}
          mapLabel={startDiagram?.kind === "graph" ? "Explore architecture" : undefined}
          enter={interiorsByBuilding.has(startBuilding.id) ? () => handleRef.current?.enterBuilding(startBuilding.id) : undefined}
        />
      )}

      {showDirectory && (
        <aside className="kd-learn-card kd-world-context kd-lobby-directory" aria-label="Building directory">
          <div className="kd-learn-eyebrow"><span /> Building directory</div>
          <h2>{space?.city.buildings.find(({ id }) => id === mode.buildingId)?.title ?? "Lobby"}</h2>
          <button type="button" className="kd-learn-action kd-learn-primary" onClick={() => {
            const diagram = space?.diagrams.find(({ owner, kind }) => owner === mode.buildingId && kind === "graph");
            if (diagram) openDiagram(diagram);
            else openDiagramLibrary();
          }}>Architecture <span aria-hidden="true">↗</span></button>
          <div className="kd-lesson-actions">
            <button type="button" className="kd-learn-action" onClick={() => { setTab("flows"); setDrawer(true); }}>Workflows</button>
            <button type="button" className="kd-learn-action" onClick={() => { setTab("docs"); setDrawer(true); }}>Docs</button>
            <button type="button" className="kd-learn-action" onClick={() => openLearning("tour", mode.buildingId)}>Learning</button>
          </div>
          {(interiorsByBuilding.get(mode.buildingId ?? "")?.length ?? 0) > 0 && <button type="button" className="kd-learn-action" onClick={() => {
            const floor = mode.buildingId ? interiorsByBuilding.get(mode.buildingId)?.[0] : undefined;
            if (!floor) return;
            const ref = `${mode.buildingId}:${floor.id}`;
            const isWalking = handleRef.current?.walkTo(ref, true) ?? false;
            setWorkshopWalk({ ref, state: isWalking ? "walking" : "arrived" });
          }}>Walk to workshop →</button>}
          {pinDirectory && hasNearby && (interaction || focusSource) && <button type="button" className="kd-doc-link kd-diagram-back" onClick={() => setPinDirectory(false)}>Nearby action →</button>}
          {walkStatus && <p role="status" className="kd-world-context-status">{walkStatus}</p>}
        </aside>
      )}

      {/* focus card */}
      {focus && showNearby && (
        <aside className={`kd-learn-card kd-world-context${overview ? " kd-world-context-overview" : ""}`} aria-label="Nearby item">
          <div className="kd-learn-eyebrow">{focus.kind.replaceAll("-", " ")}</div>
          <h2>{focus.title}</h2>
          {focus.summary && (
            <p>{focus.summary}</p>
          )}
          {interaction ? (
            <button type="button" className="kd-learn-action" onClick={() => handleRef.current?.activate()}>
              {interaction[0].toUpperCase() + interaction.slice(1)} <kbd aria-hidden="true">E</kbd>
            </button>
          ) : eHint && <div className="mt-2 text-xs font-semibold text-[#08766c]">{eHint}</div>}
          {overview && focus.kind === "building" && interiorsByBuilding.has(focus.ref) && (
            <button type="button" className="kd-learn-action kd-learn-primary" onClick={() => handleRef.current?.enterBuilding(focus.ref)}>Enter building →</button>
          )}
          {focusSource && (
            <button type="button" className="kd-learn-action" onClick={() => openSource(focusSource, focus.title)}>
              View source ↗
            </button>
          )}
          {hasDirectory && <button type="button" className="kd-doc-link kd-diagram-back" onClick={() => setPinDirectory(true)}>Building directory →</button>}
          {walkStatus && <p role="status" className="kd-world-context-status">{walkStatus}</p>}
        </aside>
      )}

      {replay && !drawer && !reading && <ReplayPanels
        replay={replay}
        controls={handleRef.current?.replay}
        openSource={openSource}
        traces={flowsWithTraces.find(({ flow }) => flow.id === replay.flowId)?.traces ?? []}
        backToDiagram={diagramReturn?.flow === replay.flowId ? { view: diagramReturn.view, open: restoreDiagram } : undefined}
        practice={questions.length ? () => openLearning("practice", replayBuilding) : undefined}
        ask={!offline ? () => openGuide() : undefined}
      />}

      {inspect && !replay && !drawer && !reading && explaining && activeDiagram && <DiagramExplanation
        diagram={activeDiagram}
        owner={activeDiagram.owner === "city" ? "City" : space?.city.buildings.find((building) => building.id === activeDiagram.owner.split(":")[0])?.title ?? "Building"}
        selectedRef={selectedDiagramItem?.ref}
        select={(ref) => handleRef.current?.focusRef(ref)}
        close={() => { setExplainId(undefined); handleRef.current?.inspect.close(); }}
        fit={() => handleRef.current?.inspect.fit()}
        topDown={inspect.topDown}
        toggleProjection={activeDiagram.kind !== "sequence" ? () => handleRef.current?.inspect.setTopView(!inspect.topDown) : undefined}
        openSource={openSource}
        openReplay={openReplay}
        showInspect={() => setExplainId(undefined)}
        relatedReplays={relatedExplanationReplays}
        ask={!offline ? () => openGuide() : undefined}
      />}
      {inspect && !replay && !drawer && !reading && !explaining && <DiagramPanels
        inspect={inspect} controls={handleRef.current?.inspect} openSource={openSource}
        selection={selectedDiagramItem} clearSelection={() => setFocus(null)}
        diagram={activeDiagram}
        selectItem={(ref) => handleRef.current?.focusRef(ref)}
        flowTitle={diagramFlow?.title} openFlow={diagramFlow && (() => openReplay({ flow: diagramFlow.id }))}
        showExplain={inspect.spatial && activeDiagram ? () => { handleRef.current?.inspect.pause(); setExplainId(activeDiagram.id); } : undefined}
      />}

      {/* tour bar */}
      {stop && !drawer && !reading && !trophy && (
        <aside className={`kd-learn-card kd-tour-card${replay || inspect ? " kd-tour-with-stage" : ""}`} aria-label="Guided tour">
          <div className="flex items-center gap-2">
            <span className="kd-learn-eyebrow">
              Tour {tourIdx! + 1}/{stops.length}
            </span>
            <span className="flex-1" />
            <button type="button" className="kd-learn-icon" aria-label="Pause tour" onClick={endTour}>×</button>
          </div>
          <p className="mt-2">{stop.narration}</p>
          {stop.locate && (
            <p className={`kd-tour-note ${found ? "kd-correct" : ""}`}>
              {found ? "✓ Found it — " : "🧭 "}
              {stop.locate.prompt}
            </p>
          )}
          {stop.checkpoint && !answered && (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="text-sm font-semibold">{stop.checkpoint.question}</div>
              {stop.checkpoint.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={Boolean(pick || stop.locate && !found)}
                  className="kd-question-option"
                  aria-pressed={pick === o.id}
                  onClick={() => {
                    setPick(o.id);
                    if (tourIdx !== null && !Object.hasOwn(tourAnswers, tourIdx)) {
                      const next = { ...tourAnswers, [tourIdx]: Boolean(o.correct) };
                      setTourAnswers(next);
                      if (tourKey) saveProgress(tourKey, { index: tourIdx, answers: next });
                    }
                    if (o.correct) setAnswered(true);
                  }}
                >
                  {o.label}
                </button>
              ))}
              {pick && <p className="kd-incorrect" role="status">Try another answer.</p>}
            </div>
          )}
          {answered && stop.checkpoint?.explanation && <p className="kd-tour-note" role="status">✓ {stop.checkpoint.explanation}</p>}
          <div className="kd-tour-controls">
            <button
              type="button"
              className="kd-hud-link"
              aria-pressed={auto}
              title="Autopilot: the character walks stop to stop and the tour advances by itself"
              onClick={() => {
                const next = !auto;
                setAuto(next);
                setWalkCancelled(false);
                if (next && stop && !stop.locate) {
                  const isWalking = handleRef.current?.walkTo(stop.ref) ?? false;
                  setWalking(isWalking);
                  setArrived(!isWalking);
                } else {
                  handleRef.current?.stopAuto();
                  setWalking(false);
                  setArrived(true);
                }
              }}
            >
              {auto ? "Pause auto" : "Auto walk"}
            </button>
            {walking && <span className="kd-lesson-muted" role="status">Walking…</span>}
            {walkCancelled && <span className="kd-lesson-muted" role="status">Walk cancelled</span>}
            {(stop.checkpoint?.source ?? stop.source) && (
              <button type="button" className="kd-hud-link" onClick={() => openSource((stop.checkpoint?.source ?? stop.source)!)}>Source ↗</button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              className="kd-hud-link"
              disabled={tourIdx === 0}
              onClick={() => goToStop(Math.max(0, tourIdx! - 1))}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="kd-hud-link kd-learn-primary"
              disabled={!answered}
              onClick={() => {
                if (tourIdx! + 1 >= stops.length) finishTour();
                else goToStop(tourIdx! + 1);
              }}
            >
              {tourIdx! + 1 >= stops.length ? "Finish" : "Next →"}
            </button>
          </div>
        </aside>
      )}

      {/* drawer */}
      {drawer && space && (
        <aside className="kd-city-drawer" aria-label="City menu">
          <div className="kd-drawer-tabs">
            {((offline ? ["buildings", "diagrams", "flows", "docs", "learn"] : ["buildings", "diagrams", "flows", "docs", "learn", "guide"]) as DrawerTab[]).map((t) => (
              <button
                key={t}
                type="button"
                className="kd-drawer-tab"
                aria-pressed={tab === t}
                onClick={() => { if (t === "guide") setGuideReading(null); setTab(t); }}
              >
                {t}
              </button>
            ))}
            <span className="flex-1" />
            <button type="button" className="kd-learn-icon" onClick={() => setDrawer(false)} aria-label="Close menu">
              ✕
            </button>
          </div>
          {tab !== "learn" && tab !== "guide" && <div className="p-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={tab === "diagrams" ? "Search diagrams" : "Search the city"}
              placeholder={tab === "diagrams" ? "Search diagrams…" : "Search the city…"}
              className="kd-drawer-input"
            />
            {tab !== "docs" && tab !== "diagrams" && searchHits.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {searchHits.map((h, i) => (
                  <button
                    key={`${h.ref}:${i}`}
                    type="button"
                    className="kd-drawer-item"
                    onClick={() => {
                      if (h.kind === "doc" && h.sourcePath) browseReading({ path: h.sourcePath });
                      else if (h.kind === "flow") openReplay({ flow: h.ref });
                      else {
                        handleRef.current?.focusRef(h.ref);
                        setDrawer(false);
                      }
                    }}
                  >
                    <span className="kd-drawer-meta">{h.kind}</span>
                    <span>{h.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>}
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            {tab === "buildings" &&
              districts.map(({ district, buildings }) => (
                <div key={district.id} className="mb-3">
                  <button
                    type="button"
                    className="kd-drawer-section"
                    onClick={() => handleRef.current?.focusRef(district.id)}
                  >
                    {district.title}
                  </button>
                  {buildings.map((b) => (
                    <div key={b.id} className="ml-1">
                      <button
                        type="button"
                        className="kd-drawer-item"
                        onClick={() => {
                          if (overview) handleRef.current?.overview.focus(b.id);
                          else handleRef.current?.focusRef(b.id);
                          setDrawer(false);
                        }}
                      >
                        <span className="flex-1">{b.title}</span>
                        <span className="kd-drawer-meta">{b.metrics.files} files · {b.metrics.docs} docs</span>
                      </button>
                      {interiorsByBuilding.has(b.id) && <button type="button" className="kd-drawer-floor" onClick={() => {
                        handleRef.current?.enterBuilding(b.id);
                        setDrawer(false);
                      }}>↳ Enter lobby</button>}
                      {(interiorsByBuilding.get(b.id) ?? []).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className="kd-drawer-floor"
                          onClick={() => {
                            handleRef.current?.gotoFloor(b.id, f.id);
                            setDrawer(false);
                          }}
                        >
                          ⤷ {f.title}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            {tab === "diagrams" && <>
              {!diagramDirectory.length && <p className="kd-lesson-muted">{space.diagrams.length ? "No diagrams match this search." : "No diagrams are available in this revision."}</p>}
              {diagramDirectory.map(({ title, rows }) => (
                <section key={title} className="mb-3" aria-label={title}>
                  <h2 className="kd-drawer-section">{title}</h2>
                  {rows.map(({ diagram, owner, kind }) => (
                    <button key={diagram.id} type="button" className="kd-drawer-item" onClick={() => openDiagram(diagram)}>
                      <span className="kd-drawer-symbol" aria-hidden="true">◇</span>
                      <span className="flex-1">
                        <span className="block font-semibold">{diagram.title}</span>
                        <span className="kd-drawer-meta">{owner} · {kind}</span>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </>}
            {tab === "flows" && !space.flows.length && <p className="kd-lesson-muted">No flows are available in this revision.{!offline && " Check Generation job for pending scenario work."}</p>}
            {tab === "flows" &&
              space.flows.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="kd-drawer-item"
                  onClick={() => openReplay({ flow: f.id })}
                >
                  <span className="kd-drawer-symbol">⇢</span>
                  <span className="flex-1">{f.title}</span>
                  <span className="kd-drawer-meta">{f.scenarios?.length ? `${f.scenarios.length} scenarios` : "Linear overview"}</span>
                </button>
              ))}
            {tab === "docs" && <>
              {readingLibrary.docs.map((c, i) => (
                <button
                  key={`${c.doc}:${i}`}
                  type="button"
                  className="kd-drawer-item"
                  onClick={() => browseReading({ path: c.doc }, true)}
                >
                  <span className={c.pending === 0 ? "kd-correct" : "kd-drawer-meta"}>
                    {c.pending === 0 ? "●" : "◐"}
                  </span>
                  <span className="flex-1 break-all">{c.doc}</span>
                  <span className="kd-drawer-meta">
                    {c.placed}/{c.sections} linked
                  </span>
                </button>
              ))}
              {!readingLibrary.hasDocs && <p className="kd-lesson-muted">No Markdown documents were indexed.{readingLibrary.sources.length > 0 && " Explore the source cited by this city below."}</p>}
              {readingLibrary.sources.length > 0 && <details className="kd-doc-library" open={!readingLibrary.hasDocs || undefined}>
                <summary>Cited source files <span>{readingLibrary.sources.length}</span></summary>
                {readingLibrary.sources.slice(0, 24).map(([path, entries]) => {
                  const source = entries.find(({ source }) => source.startLine !== undefined)?.source;
                  return <button className="kd-drawer-item" type="button" key={path}
                    onClick={() => browseReading({ path, from: source?.startLine, to: source?.endLine })}>
                    <span className="kd-drawer-symbol" aria-hidden="true">⌘</span>
                    <span className="flex-1 break-all">{path}</span>
                    <span className="kd-drawer-meta">{source?.startLine ? `L${source.startLine}` : "Source"}</span>
                  </button>;
                })}
                {readingLibrary.sources.length > 24 && <p className="kd-lesson-muted">Search by file name to narrow the list.</p>}
              </details>}
              {search.trim() && !readingLibrary.docs.length && !readingLibrary.sources.length &&
                <p className="kd-lesson-muted">No documents or cited source files match this search.</p>}
            </>}
            {tab === "guide" && (
              <div className="kd-guide">
                <h2>Ask the guide</h2>
                <p className="kd-lesson-muted">Answers use evidence from this workspace.</p>
                {(guideReading || replay || inspect || focus) && <p className="kd-tour-note">Context · {guideReading?.title ?? replay?.caption ?? replay?.title ?? selectedDiagramItem?.title ?? inspect?.caption ?? inspect?.title ?? focus?.title}</p>}
                {guideReading && readingResume && <button type="button" className="kd-learn-action" onClick={resumeReading}>← Resume reading</button>}
                <textarea
                  value={guideQ}
                  onChange={(e) => setGuideQ(e.target.value)}
                  rows={3}
                  aria-label="Question for the guide"
                  placeholder={replay ? "What makes this branch run?" : "Where does this workflow start?"}
                  className="kd-drawer-input resize-y"
                />
                <button
                  type="button"
                  className="kd-learn-action kd-learn-primary"
                  disabled={guideBusy || !guideQ.trim()}
                  onClick={() => {
                    if (!id) return;
                    setGuideBusy(true);
                    setGuideA(null);
                    const target = replay && !guideReading ? {
                      flow: replay.flowId, scenario: replay.scenarioId, step: replay.stepId,
                      stepIndex: replay.stepId ? replay.step : undefined
                    } : undefined;
                    const source = guideReading?.source ?? activeSource;
                    setGuideReplay(target);
                    api
                      .ask(id, {
                        question: guideQ.trim(),
                        language: space.meta.language,
                        agent: guideAgent,
                        model: guideModel,
                        draftJobId,
                        focusTitle: guideReading?.title ?? replay?.caption ?? selectedDiagramItem?.title ?? inspect?.caption ?? inspect?.title ?? focus?.title,
                        focusSourcePath: source?.path,
                        focusRef: target?.flow ?? inspect?.diagramId ?? (guideReading ? undefined : focus?.ref),
                        scenarioId: target?.scenario,
                        stepId: target?.step,
                        stepIndex: target?.stepIndex,
                        sourceStartLine: source?.startLine,
                        sourceEndLine: source?.endLine
                      })
                      .then(setGuideA)
                      .catch((e: Error) => setGuideA({ answer: e.message, sources: [] }))
                      .finally(() => setGuideBusy(false));
                  }}
                >
                  {guideBusy ? "Asking…" : "Ask the guide"}
                </button>
                {guideA && (
                  <div className="kd-question-review" aria-live="polite">
                    <div className="kd-guide-answer">{guideA.answer}</div>
                    {guideA.focusRef && (
                      <button type="button" className="kd-learn-action" onClick={() => {
                        if (guideReplay && guideA.focusRef === guideReplay.flow) {
                          openReplay(guideReplay);
                          return;
                        }
                        handleRef.current?.focusRef(guideA.focusRef!);
                        setDrawer(false);
                      }}>Show in city →</button>
                    )}
                    {guideCitations.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {guideCitations.map((citation, index) => {
                          const ref = citation.focusRef ?? space.navigation.searchIndex.find((entry) => entry.sourcePath === citation.path)?.ref;
                          return (
                            <div key={`${citation.path}:${citation.startLine ?? 0}:${index}`} className="kd-guide-citation">
                              <button
                                type="button"
                                className="kd-source-path text-left hover:underline"
                                onClick={() => openSource(citation)}
                              >
                                {citation.path}{citation.startLine ? `:${citation.startLine}${citation.endLine && citation.endLine !== citation.startLine ? `–${citation.endLine}` : ""}` : ""}
                              </button>
                              {ref && (
                                <button
                                  type="button"
                                  className="kd-hud-link"
                                  onClick={() => {
                                    if (guideReplay && ref === guideReplay.flow) {
                                      openReplay(guideReplay);
                                      return;
                                    }
                                    handleRef.current?.focusRef(ref);
                                    setDrawer(false);
                                  }}
                                >
                                  Show →
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {tab === "learn" && (
              <section className="kd-learning-desk" aria-label="Learning desk">
                <div className="kd-learn-eyebrow"><span /> Learning desk</div>
                <h2>{lesson === "tour" ? "Guided tour" : lesson === "practice" ? "Practice" : "Exam"}</h2>
                <div className="kd-lesson-actions" role="group" aria-label="Learning activity">
                  {(["tour", "practice", "exam"] as const).map((item) => (
                    <button key={item} type="button" className="kd-drawer-tab" aria-pressed={lesson === item} onClick={() => setLesson(item)}>{item}</button>
                  ))}
                </div>
                {lesson === "tour" ? (
                  stops.length ? <>
                    <button type="button" className="kd-learn-action kd-learn-primary" onClick={() => startTour(tourResume ?? 0, tourResume === null)}>
                      {tourResume === null ? "▷ Start tour" : `▷ Resume at stop ${tourResume + 1}`}
                    </button>
                    {tourResume !== null && <button type="button" className="kd-learn-action" onClick={() => startTour(0, true)}>Restart tour</button>}
                    <ol className="kd-tour-stops" aria-label="Tour stops">
                      {stops.map((item, index) => {
                        const title = space.diagrams.find(({ id }) => id === item.ref)?.title ??
                          space.flows.find(({ id }) => id === item.ref)?.title ??
                          space.city.buildings.find(({ id }) => id === item.ref)?.title ?? item.narration;
                        return <li key={`${item.ref}:${index}`}>
                          <button type="button" className="kd-drawer-item" onClick={() => startTour(index)}>
                            <span className="kd-drawer-meta">{index + 1}</span><span>{title}</span>
                          </button>
                        </li>;
                      })}
                    </ol>
                  </> : <>
                    <p className="kd-lesson-muted">No guided stops are available in this revision. You can explore the buildings and flows in the city menu.</p>
                    <button type="button" className="kd-learn-action" onClick={() => setTab("flows")}>Browse flows →</button>
                  </>
                ) : <>
                  {questions.some((question) => question.building) && (
                    <label className="kd-scenario-picker mt-3">
                      Question scope
                      <select value={lessonScope} onChange={(event) => setLessonScope(event.target.value)}>
                        <option value="">Entire city</option>
                        {space.city.buildings.filter((building) => questions.some((question) => question.building === building.id)).map((building) => (
                          <option key={building.id} value={building.id}>{building.title}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <LearningActivities mode={lesson} questions={scopedQuestions}
                    progressKey={`kodyurd:exam:${draftJobId ?? id ?? `${window.location.pathname}:${space.meta.name}`}:${lessonScope || "city"}`}
                    legacyProgressKey={`${progressKey}:exam:${lessonScope || "city"}`} openSource={openSource} openReplay={openReplay} />
                </>}
              </section>
            )}
          </div>
        </aside>
      )}

      {/* tour trophy */}
      {trophy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
          <div className="kd-learn-card w-96 max-w-[92vw] text-center" role="dialog" aria-label="Tour complete">
            <div className="text-4xl">
              {trophy.asked === 0
                ? "🎓"
                : trophy.correct / trophy.asked >= 0.9
                  ? "🏆"
                  : trophy.correct / trophy.asked >= 0.6
                    ? "🥈"
                    : "🥉"}
            </div>
            <div className="mt-2 text-lg font-bold">Tour complete</div>
            <p className="mt-1">
              {trophy.stops} stops{trophy.asked > 0 ? ` · checkpoints ${trophy.correct}/${trophy.asked}` : ""}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                className="kd-hud-link kd-learn-primary"
                onClick={() => setTrophy(null)}
              >
                Walk the city
              </button>
              <button
                type="button"
                className="kd-hud-link"
                onClick={() => {
                  setTrophy(null);
                  startTour(0, true);
                }}
              >
                ↻ restart tour
              </button>
            </div>
          </div>
        </div>
      )}

      {/* elevator modal */}
      {elevator && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <div className="kd-learn-card w-80 max-w-[92vw]" role="dialog" aria-label="Choose a floor">
            <div className="text-sm font-bold">Floors</div>
            <div className="mt-3 flex flex-col gap-1.5">
              {elevator.floors.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  className="kd-drawer-item"
                  onClick={() => {
                    handleRef.current?.gotoFloor(elevator.buildingId, f.id);
                    setElevator(null);
                  }}
                >
                  <span className="kd-drawer-meta">{i + 1}</span>
                  {f.title}
                </button>
              ))}
              {elevator.floors.length === 0 && (
                <p>No floors are available in this revision.</p>
              )}
            </div>
            <button type="button" className="kd-learn-action" onClick={() => setElevator(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* reading mode */}
      {reading && (
        <SourceInspector
          reading={reading}
          close={closeReading}
          back={readingTrail.length > 0 ? () => {
            const previous = readingTrail.at(-1);
            if (previous) restoreReading(previous);
            setReadingTrail(readingTrail.slice(0, -1));
          } : undefined}
          openEditor={!offline && id ? () => { void editorAction("open"); } : undefined}
          copyPath={() => { void editorAction("copy"); }}
          evidence={readingEvidence}
          evidenceForLinks={(targets) => evidenceViaSourceLinks(readingIndex, targets, readingEvidence)}
          openEvidence={openReadingEvidence}
          onScroll={(top) => { readingScroll.current = top; }}
          ask={!offline && reading.excerpt ? () => {
            const excerpt = reading.excerpt;
            if (!excerpt) return;
            const section = excerpt.sections?.find(({ startLine, endLine }) => startLine <= excerpt.from && endLine >= excerpt.from);
            setReadingResume({ selection: captureReading(reading), trail: readingTrail });
            closeReading();
            openGuide({ source: { path: reading.path, startLine: excerpt.from, endLine: excerpt.to }, title: section?.title ?? reading.title ?? reading.path });
          } : undefined}
          documentActions={reading.document ? {
            diagrams: space?.diagrams ?? [],
            openRange: (from, to) => openReading({ path: reading.path, from, to }, reading.title, true),
            openPath: (target) => {
              const previous = captureReading(reading);
              setReadingTrail((trail) => [...trail.slice(-7), previous]);
              const section = target.anchor && target.path === reading.path ? documentSection(reading.excerpt?.sections, target.anchor) : undefined;
              openReading(section ? { path: target.path, from: section.startLine, to: section.endLine } : target, undefined, /\.md$/i.test(target.path));
            },
            openDiagram: (ref) => {
              const item = readingIndex.get(reading.path.replaceAll("\\", "/"))?.find((entry) => entry.kind === "diagram" && entry.id === ref && !entry.itemRef);
              if (item) openReadingEvidence(item);
            }
          } : undefined}
        />
      )}
      </div>
      {(!cityReady || error) && (
        <div className="kd-city-loading">
          <div className="kd-city-loading-content">
            {error ? <>
              <h2 role="alert">{error}</h2>
              <div className="kd-city-loading-actions">
                <button type="button" className="kd-space-top" autoFocus onClick={retry}>Retry</button>
                {onExit && <button type="button" className="kd-space-top" onClick={onExit}>Back to workspace</button>}
              </div>
            </> : <>
              <div role="status">
                <h2>Opening city…</h2>
                <p>Preparing the first view</p>
              </div>
              {onExit && <button type="button" className="kd-space-top" onClick={onExit}>Back to workspace</button>}
            </>}
          </div>
        </div>
      )}
    </div>
  );
}
