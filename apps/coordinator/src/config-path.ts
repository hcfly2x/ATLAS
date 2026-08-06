import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultAtlasConfigPath(
  fileName: string,
  moduleUrl: string,
  cwd = process.cwd(),
): string {
  const sourceRelativePath = fileURLToPath(new URL(`../../../.atlas/${fileName}`, moduleUrl));
  return existsSync(sourceRelativePath) ? sourceRelativePath : resolve(cwd, ".atlas", fileName);
}
