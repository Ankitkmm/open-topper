import { join } from "path";

export const APP_DATA_DIR = join(process.cwd(), "data", "app");
export const APP_ENTITY_DIR = join(APP_DATA_DIR, "entities");
export const APP_VAULT_DIR = join(APP_DATA_DIR, "vault");
