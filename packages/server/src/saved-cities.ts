import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicJson, generationDir, generationDraftPath, offersPath, projectDir, spacePath } from "./project-files.js";

/**
 * The cities a workspace has generated, one per brief. A new generation of the same
 * brief replaces its earlier city; opening an entry makes it the workspace's city again.
 * The list is bounded, and a generation that is neither listed nor recent is removed.
 */

export interface SavedCity {
  jobId: string;
  brief: string;
  language: string;
  title: string;
  savedAt: string;
  buildings: number;
  lessons: number;
  diagrams: number;
  flows: number;
}

export interface SavedCities {
  current?: string;
  cities: SavedCity[];
}

export const SAVED_CITY_LIMIT = 12;
const RECENT_GENERATIONS = 4;
const jobIdPattern = /^[0-9a-f-]{36}$/i;

const indexPath = (dataDir: string, projectId: string): string => path.join(projectDir(dataDir, projectId), "cities.json");
const briefKey = ({ brief, language }: Pick<SavedCity, "brief" | "language">): string =>
  `${language}\n${brief.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`;
const readJson = <T>(file: string): Promise<T | undefined> =>
  fs.readFile(file, "utf8").then((text) => JSON.parse(text) as T).catch(() => undefined);
const count = (value: unknown): number => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

function readCity(value: unknown): SavedCity[] {
  if (!value || typeof value !== "object") return [];
  const city = value as Record<string, unknown>;
  if (typeof city.jobId !== "string" || !jobIdPattern.test(city.jobId) || typeof city.brief !== "string" ||
    typeof city.language !== "string" || typeof city.title !== "string" || typeof city.savedAt !== "string") return [];
  return [{ jobId: city.jobId, brief: city.brief.slice(0, 2000), language: city.language.slice(0, 24), title: city.title.slice(0, 120),
    savedAt: city.savedAt.slice(0, 40), buildings: count(city.buildings), lessons: count(city.lessons),
    diagrams: count(city.diagrams), flows: count(city.flows) }];
}

export async function readSavedCities(dataDir: string, projectId: string): Promise<SavedCities> {
  // A missing or damaged index reads as an empty list.
  const raw = await readJson<Record<string, unknown>>(indexPath(dataDir, projectId));
  const cities = Array.isArray(raw?.cities) ? raw.cities.flatMap(readCity).slice(0, SAVED_CITY_LIMIT) : [];
  const current = typeof raw?.current === "string" && cities.some(({ jobId }) => jobId === raw.current) ? raw.current : undefined;
  return { current, cities };
}

/** Removes generations that no saved city uses, keeping the most recent ones for retries. */
async function pruneGenerations(dataDir: string, projectId: string, keep: Set<string>): Promise<void> {
  const root = path.join(projectDir(dataDir, projectId), "generation");
  const names = (await fs.readdir(root).catch(() => [] as string[])).filter((name) => jobIdPattern.test(name) && !keep.has(name));
  const dated = await Promise.all(names.map(async (name) => ({
    name, at: await fs.stat(path.join(root, name)).then((stat) => stat.mtimeMs, () => 0)
  })));
  for (const { name } of dated.sort((a, b) => b.at - a.at).slice(RECENT_GENERATIONS)) {
    await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Lists a published generation as the workspace's current city, in place of an earlier city of the same brief. */
export async function recordSavedCity(dataDir: string, projectId: string, city: SavedCity): Promise<void> {
  const saved = await readSavedCities(dataDir, projectId);
  const key = briefKey(city);
  const cities = [city, ...saved.cities.filter((item) => item.jobId !== city.jobId && briefKey(item) !== key)].slice(0, SAVED_CITY_LIMIT);
  await atomicJson(indexPath(dataDir, projectId), { current: city.jobId, cities });
  await pruneGenerations(dataDir, projectId, new Set(cities.map(({ jobId }) => jobId)));
}

/** Makes a saved city the workspace's city again, with the model offers of its own plan. */
export async function openSavedCity(dataDir: string, projectId: string, jobId: string): Promise<SavedCity | undefined> {
  const saved = await readSavedCities(dataDir, projectId);
  const city = saved.cities.find((item) => item.jobId === jobId);
  if (!city) return undefined;
  const payload = await readJson<{ space?: { city?: { buildings?: { id?: unknown }[] } }; layout?: unknown }>(
    generationDraftPath(dataDir, projectId, jobId));
  const buildings = payload?.space?.city?.buildings;
  if (!payload?.layout || !Array.isArray(buildings)) return undefined;
  const ids = new Set(buildings.map(({ id }) => id));
  const checkpoint = await readJson<{ plan?: { offers?: { building?: unknown }[] } }>(
    path.join(generationDir(dataDir, projectId, jobId), "checkpoint.json"));
  const planned = checkpoint?.plan?.offers;
  const offers = Array.isArray(planned) ? planned.filter((offer) => ids.has(offer?.building)) : [];
  await atomicJson(offersPath(dataDir, projectId), { offers });
  await atomicJson(spacePath(dataDir, projectId), payload);
  await atomicJson(indexPath(dataDir, projectId), { current: jobId, cities: saved.cities });
  return city;
}

/** Forgets a saved city that is not the open one, with its generation files. */
export async function removeSavedCity(dataDir: string, projectId: string, jobId: string): Promise<boolean> {
  const saved = await readSavedCities(dataDir, projectId);
  if (saved.current === jobId || !saved.cities.some((item) => item.jobId === jobId)) return false;
  await atomicJson(indexPath(dataDir, projectId), { current: saved.current, cities: saved.cities.filter((item) => item.jobId !== jobId) });
  await fs.rm(generationDir(dataDir, projectId, jobId), { recursive: true, force: true }).catch(() => undefined);
  return true;
}
