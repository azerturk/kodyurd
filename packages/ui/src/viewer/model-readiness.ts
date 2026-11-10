export type OpeningModelsState = {
  status: "loading" | "ready" | "failed";
  pending: number;
};

export function openingModelsState(pending: number, failed: boolean, timedOut: boolean): OpeningModelsState {
  if (failed || (pending > 0 && timedOut)) return { status: "failed", pending };
  return { status: pending === 0 ? "ready" : "loading", pending };
}

export function hasGlbDocument(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 20) return false;
  const header = new DataView(bytes);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== bytes.byteLength) return false;
  const jsonLength = header.getUint32(12, true);
  if (header.getUint32(16, true) !== 0x4e4f534a || jsonLength < 2 || jsonLength > bytes.byteLength - 20) return false;
  // The PlayCanvas in-memory path calls the parser asynchronously. Verify the
  // JSON chunk here so malformed input reaches a terminal result.
  try {
    const document: { asset?: { version?: string } } | null = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, 20, jsonLength))
    );
    return typeof document?.asset?.version === "string" && /^2\./.test(document.asset.version);
  } catch {
    return false;
  }
}

export function isUnavailableModel(error: unknown): boolean {
  if (error === 404 || error === 410 || error instanceof SyntaxError) return true;
  return typeof error === "string" && /^Invalid (?:gltf version|magic number|version number|length|chunk|number of chunks)\b/i.test(error);
}
