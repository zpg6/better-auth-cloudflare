import type { BetterAuthClientPlugin } from "better-auth/client";
import type { cloudflare } from ".";

/**
 * Sanitizes a string to ensure it only contains ASCII characters
 * This prevents ByteString conversion errors in Cloudflare Workers
 * if unicode or other non-ASCII characters are present
 */
function sanitizeHeaderValue(value: string): string {
    return value
        .split("")
        .map(char => {
            const code = char.charCodeAt(0);
            // Only allow ASCII characters (0-127)
            return code <= 127 ? char : "?";
        })
        .join("");
}

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
                        "x-filename": sanitizeHeaderValue(file.name),
                    };

                    if (metadata && Object.keys(metadata).length > 0) {
                        headers["x-file-metadata"] = sanitizeHeaderValue(JSON.stringify(metadata));
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
