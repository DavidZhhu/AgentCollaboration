type Project = { id: string };
type StorageReader = Pick<Storage, "getItem">;

export function resolveProjectSelection(
  projects: Project[],
  current: string,
  accountId: string,
  storage: StorageReader,
): string {
  let remembered = "";
  try {
    remembered = storage.getItem(`agentcollab:project:${accountId}`) || "";
  } catch {
    // Selection still works when browser storage is unavailable.
  }
  return [current, remembered].find((candidate) =>
    projects.some((project) => project.id === candidate),
  ) || projects[0]?.id || "";
}
