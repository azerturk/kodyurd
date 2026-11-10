import { promises as fs } from "node:fs";

export interface OverlayRecord {
  building: string;
  moduleRef?: string;
  class: string;
  prompt: string;
  id: string;
  hidden?: boolean;
}

interface BuildingIdentity {
  id: string;
  moduleRef?: string;
}

export async function savedBuildingIdentities(file: string): Promise<BuildingIdentity[] | undefined> {
  const value: unknown = await fs.readFile(file, "utf8").then((text): unknown => JSON.parse(text)).catch(() => null);
  if (!value || typeof value !== "object") return undefined;
  const document = "space" in value ? value.space : value;
  if (!document || typeof document !== "object" || !("city" in document) || !document.city ||
      typeof document.city !== "object" || !("buildings" in document.city) || !Array.isArray(document.city.buildings)) return undefined;
  return document.city.buildings.filter((building): building is BuildingIdentity =>
    Boolean(building && typeof building.id === "string" && (building.moduleRef === undefined || typeof building.moduleRef === "string")));
}

export function overlayBuilding(item: OverlayRecord, buildings?: BuildingIdentity[]): string | undefined {
  if (!buildings) return item.building;
  if (!item.moduleRef) return buildings.find(({ id }) => id === item.building)?.id;
  const candidates = buildings.filter(({ moduleRef }) => moduleRef === item.moduleRef);
  return candidates.length === 1 ? candidates[0].id : candidates.find(({ id }) => id === item.building)?.id;
}
