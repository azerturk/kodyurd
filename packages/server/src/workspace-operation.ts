interface WorkspaceOperation {
  maintenance: boolean;
}

const operations = new Map<string, WorkspaceOperation>();

/** Keep cache maintenance, export, and content writes from racing in one workspace. */
export function tryAcquireWorkspaceOperation(
  projectId: string,
  options?: { maintenance?: boolean }
): (() => void) | null {
  if (operations.has(projectId)) return null;
  const operation = { maintenance: options?.maintenance === true };
  operations.set(projectId, operation);
  return () => {
    if (operations.get(projectId) === operation) operations.delete(projectId);
  };
}

export function isWorkspaceUnderMaintenance(projectId: string): boolean {
  return operations.get(projectId)?.maintenance === true;
}
