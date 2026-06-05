import { writeFileSync } from "fs";
import { join } from "path";
import { buildWorkspaceSnapshot } from "../src/lib/build-workspace-index";

const OUT_FILE = join(process.cwd(), "data", "app", "workspace-index.json");

async function main() {
  const snapshot = buildWorkspaceSnapshot();
  writeFileSync(OUT_FILE, JSON.stringify(snapshot));
  console.log(`Built workspace index: ${snapshot.questions.length.toLocaleString()} questions`);
  console.log(`Output: ${OUT_FILE}`);
}

void main();
