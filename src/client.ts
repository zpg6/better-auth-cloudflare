import type { BetterAuthClientPlugin } from "better-auth";
import type { cloudflare } from ".";

/**
 * Cloudflare client plugin for Better Auth
 *
 * @returns Client plugin for Cloudflare integration
 */
export const cloudflareClient = () => {
    return {
        id: "cloudflare",
        $InferServerPlugin: {} as ReturnType<typeof cloudflare>,
    } satisfies BetterAuthClientPlugin;
};
