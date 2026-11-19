import type { AnalyzerReport } from "./analyzer.js";
import type { TCityPlan } from "./space-pipeline.js";

/** Inventory facts belong to the scanner, never to the provider's estimates. */
export function moduleScanMetrics(report: AnalyzerReport, moduleRef: string): TCityPlan["city"]["buildings"][number]["metrics"] | undefined {
  const module = report.modules.find(({ name }) => name === moduleRef);
  if (!module) return undefined;
  return {
    files: module.files,
    loc: module.loc,
    docs: report.docs.filter((doc) => doc.module === moduleRef || doc.matches.includes(moduleRef)).length
  };
}

/** Call after removing buildings whose moduleRef is absent from the scan. */
export function applyScanFacts(plan: TCityPlan, report: AnalyzerReport): TCityPlan {
  return {
    ...plan,
    city: {
      ...plan.city,
      buildings: plan.city.buildings.map((building) => ({
        ...building, metrics: moduleScanMetrics(report, building.moduleRef) ?? building.metrics
      }))
    }
  };
}
