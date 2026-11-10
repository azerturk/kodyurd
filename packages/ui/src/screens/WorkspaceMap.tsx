import { useId } from "react";
import type { CityLayout, LBuilding, LPoint, LRect } from "../space-types";

const project = ({ x, z }: LPoint, elevation = 0): [number, number] =>
  [0.85 * x - 0.7 * z, 0.37 * x + 0.42 * z - 0.9 * elevation];

function polygon(points: readonly LPoint[], elevation = 0): string {
  return points.map((point) => project(point, elevation).join(",")).join(" ");
}

function corners({ x, z, w, d }: LRect): [LPoint, LPoint, LPoint, LPoint] {
  return [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }];
}

function footprint({ pos, size, rot }: LBuilding): [LPoint, LPoint, LPoint, LPoint] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return corners({ x: -size.w / 2, z: -size.d / 2, w: size.w, d: size.d }).map(({ x, z }) =>
    ({ x: pos.x + x * cos + z * sin, z: pos.z - x * sin + z * cos })
  ) as [LPoint, LPoint, LPoint, LPoint];
}

function edge(a: LPoint, b: LPoint, height: number): string {
  return [project(a), project(b), project(b, height), project(a, height)].map((point) => point.join(",")).join(" ");
}

function inset(a: LPoint, b: LPoint): LPoint {
  return { x: a.x * 0.86 + b.x * 0.14, z: a.z * 0.86 + b.z * 0.14 };
}

function Building({ building, focused }: { building: LBuilding; focused: boolean }) {
  const points = footprint(building);
  const height = building.size.h;
  const [x, y] = project(building.pos, height);
  const [back, east, front, west] = points;
  const floors = Math.max(1, Math.min(5, Math.round(height / 3.5) - 1));
  // Paint the two faces toward the dimetric camera, also for rotated saved buildings.
  const visible = ([a, b]: readonly [LPoint, LPoint]): boolean => project(a)[0] > project(b)[0];
  const allFaces = [[back, east], [east, front], [front, west], [west, back]] as const;
  return (
    <g>
      <polygon points={polygon(points)} transform="translate(2.5 2.5)" fill="#566453" opacity=".23" />
      {allFaces.filter(visible).map(([a, b], index) => (
        <g key={index}>
          <polygon points={edge(a, b, height)} fill={focused ? (index ? "#439784" : "#246759") : (index ? "#b6c3b5" : "#8a9c94")} />
          {Array.from({ length: floors }, (_, floor) => {
            const level = height * (floor + 1) / (floors + 1);
            return <polyline key={floor} points={polygon([inset(a, b), inset(b, a)], level)}
              stroke={focused ? "#c4ece0" : "#587e81"} strokeWidth={Math.min(1.2, height / 8)} opacity=".82" />;
          })}
        </g>
      ))}
      <polygon points={polygon(points, height)} fill={focused ? "#b8e0cb" : "#f3ecd6"}
        stroke={focused ? "#347e70" : "#9caa9e"} strokeWidth=".46" strokeLinejoin="round" />
      {focused && (
        <g transform={`translate(${x} ${y})`}>
          <circle r="3.25" fill="#f9f4df" stroke="#1d6356" strokeWidth=".66" />
          <circle r="1.55" fill="#1d6356" />
        </g>
      )}
    </g>
  );
}

export default function WorkspaceMap({ city, focusId }: { city: CityLayout; focusId?: string }) {
  const id = useId().replaceAll(":", "");
  const focus = city.buildings.find((building) => building.id === focusId);
  const anchor = focus?.pos ?? city.plaza.pos;
  const distance = ({ pos }: LBuilding): number => Math.hypot(pos.x - anchor.x, pos.z - anchor.z);
  const buildings = city.buildings.length > 12
    ? [...city.buildings].sort((a, b) => distance(a) - distance(b)).slice(0, 12)
    : city.buildings;
  const edges = buildings.length ? buildings.flatMap(footprint) : corners(city.bounds);
  const minX = Math.min(...edges.map(({ x }) => x)) - 7;
  const minZ = Math.min(...edges.map(({ z }) => z)) - 7;
  const area = { x: minX, z: minZ, w: Math.max(...edges.map(({ x }) => x)) - minX + 7, d: Math.max(...edges.map(({ z }) => z)) - minZ + 7 };
  const ground = corners(area);
  const outline = polygon(ground);
  const frame = [
    ...ground.map((point) => project(point)),
    ...buildings.flatMap((building) => footprint(building).map((point) => project(point, building.size.h)))
  ];
  const left = Math.min(...frame.map(([x]) => x));
  const right = Math.max(...frame.map(([x]) => x));
  const top = Math.min(...frame.map(([, y]) => y));
  const bottom = Math.max(...frame.map(([, y]) => y));
  const width = Math.max(right - left + 12, (bottom - top + 12) * 1.8);
  const height = width / 1.8;
  const viewBox = [(left + right - width) / 2, (top + bottom - height) / 2, width, height].join(" ");
  const isInArea = ({ x, z }: LPoint): boolean => x >= area.x && x <= area.x + area.w && z >= area.z && z <= area.z + area.d;
  const trees = (city.props ?? []).filter(({ role, pos }) => role.startsWith("tree") && isInArea(pos)).slice(0, 60);
  const districtFills = ["#dbe6d4", "#e8e0c4", "#d6e4d9"];

  return (
    <svg className="workspace-map-art" viewBox={viewBox} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id}><polygon points={outline} /></clipPath>
      </defs>
      <polygon points={outline} transform="translate(0 3)" fill="#9fab98" opacity=".68" />
      <polygon points={outline} fill="#ebe8d2" stroke="#aeb7a3" strokeWidth=".45" />
      <g clipPath={`url(#${id})`}>
        {(city.districts ?? []).map(({ id: district, rect }, index) =>
          <polygon key={district} points={polygon(corners(rect))} fill={districtFills[index % districtFills.length]}
            stroke="#aebfa7" strokeWidth=".5" />)}
        {(city.roads ?? []).map(({ points, width: roadWidth }, index) =>
          <polyline key={index} points={polygon(points)} fill="none" stroke="#c1cbbf" strokeWidth={roadWidth * 0.45}
            strokeLinecap="round" strokeLinejoin="round" />)}
        {trees.map(({ pos }, index) => {
          const [x, y] = project(pos);
          return <g key={index} transform={`translate(${x} ${y})`}>
            <ellipse rx="1.25" ry=".65" cx=".68" cy=".22" fill="#5d7761" opacity=".32" />
            <path d="M0 0v-2" stroke="#896b4b" strokeWidth=".48" />
            <circle cy="-2.05" r="1.35" fill="#678e63" />
            <circle cx="-.42" cy="-2.5" r=".78" fill="#a5ba84" />
          </g>;
        })}
      </g>
      {[...buildings].sort((a, b) => project(a.pos)[1] - project(b.pos)[1]).map((building) =>
        <Building key={building.id} building={building} focused={building.id === focusId} />)}
    </svg>
  );
}
