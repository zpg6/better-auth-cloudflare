import type { BetterAuthClientPlugin } from "better-auth/client";
import type { cloudflare } from ".";

/**
 * Cloudflare client plugin for Better Auth
 */
export const cloudflareClient = () => {
    return {
        id: "cloudflare",
        $InferServerPlugin: {} as ReturnType<typeof cloudflare>,
        getActions: $fetch => {
            return {
                /**
                 * Upload a file by sending it directly as the request body with metadata in headers.
                 */
                uploadFile: async (file: File, metadata?: Record<string, any>) => {
                    const headers: Record<string, string> = {
                        "x-filename": file.name,
                    };

                    if (metadata && Object.keys(metadata).length > 0) {
                        headers["x-file-metadata"] = JSON.stringify(metadata);
                    }

                    return $fetch("/files/upload-raw", {
                        method: "POST",
                        headers,
                        body: file,
                    });
                },
            };
        },
    } satisfies BetterAuthClientPlugin;
};
