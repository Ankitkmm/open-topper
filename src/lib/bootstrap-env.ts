import { config } from "dotenv";

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  config({ path: ".env.local" });
  loaded = true;
}
