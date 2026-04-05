import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /* config options here */
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
};

export default nextConfig;

// Enable `getCloudflareContext()` during local dev only — running this during
// `next build` (invoked by `opennextjs-cloudflare build`) starts a second
// workerd/Miniflare instance that causes SQLITE_BUSY crashes.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NODE_ENV === "development") {
    initOpenNextCloudflareForDev();
}
