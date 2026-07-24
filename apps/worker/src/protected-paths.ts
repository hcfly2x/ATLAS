import { minimatch } from "minimatch";

export function findProtectedPathMatches(
  changedPaths: readonly string[],
  globs: readonly string[],
): readonly string[] {
  return changedPaths.filter((path) =>
    globs.some((glob) => minimatch(path, glob, { dot: true, matchBase: false })),
  );
}
