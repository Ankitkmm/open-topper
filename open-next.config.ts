import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

const config = defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});

// The app disables direct Postgres access in Cloudflare runtime and uses Supabase
// HTTP/RLS for live writes. Avoid the `pg` package's optional workerd socket path
// during bundling; it can otherwise resolve `pg-cloudflare`'s TCP implementation
// even though that code path is unused by the Worker.
config.cloudflare = {
  ...config.cloudflare,
  useWorkerdCondition: false,
};

export default config;
