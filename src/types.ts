import type { KVNamespace } from "@cloudflare/workers-types";
import type { AuthContext } from "better-auth";
import type { DrizzleAdapterConfig } from "better-auth/adapters/drizzle";
import type { FieldAttribute } from "better-auth/db";
import type { drizzle } from "drizzle-orm/d1";

export interface CloudflarePluginOptions {
    /**
     * Auto-detect IP address
     * @default true
     */
    autoDetectIpAddress?: boolean;

    /**
     * Track geolocation data in the session table
     * @default true
     */
    geolocationTracking?: boolean;

    /**
     * Cloudflare geolocation context
     */
    cf?: CloudflareGeolocation | Promise<CloudflareGeolocation | null> | null;

    /**
     * R2 configuration for user file tracking
     * If provided, enables file tracking features automatically
     */
    r2?: R2Config;
}

export interface WithCloudflareOptions extends CloudflarePluginOptions {
    /**
     * D1 database for primary storage, if that's what you're using.
     */
    d1?: {
        /**
         * D1 database for primary storage, if that's what you're using.
         */
        db: ReturnType<typeof drizzle>;
        /**
         * Drizzle adapter options for primary storage, if you're using D1.
         */
        options?: Omit<DrizzleAdapterConfig, "provider">;
    };

    /**
     * KV namespace for secondary storage, if you want to use that.
     */
    kv?: KVNamespace<string>;
}

/**
 * Cloudflare geolocation data
 */
export interface CloudflareGeolocation {
    timezone?: string | null;
    city?: string | null;
    country?: string | null;
    region?: string | null;
    regionCode?: string | null;
    colo?: string | null;
    latitude?: string | null;
    longitude?: string | null;
}

/**
 * Minimal R2Bucket interface - only what we actually need for file storage
 * Avoids complex type conflicts between DOM and Cloudflare Worker types
 */
export interface R2Bucket {
    put(key: string, value: Blob | File, options?: any): Promise<any>;
    get(key: string): Promise<{ body: ReadableStream } | null>;
    delete(key: string): Promise<void>;
    head(key: string): Promise<any>;
    list(options?: { prefix?: string }): Promise<{ objects: any[] }>;
}

/**
 * R2 configuration for file storage and tracking
 *
 * Usage with full type inference:
 * ```ts
 * const r2Config = {
 *   bucket,
 *   additionalFields: {
 *     category: { type: "string" },
 *     priority: { type: "number" }
 *   },
 *   hooks: {
 *     upload: {
 *       after: (file, ctx) => {
 *         file.category // string (fully typed!)
 *         file.priority // number (fully typed!)
 *       }
 *     }
 *   }
 * } as const satisfies R2Config;
 * ```
 */
export interface R2Config {
    /**
     * R2 bucket instance
     */
    bucket: R2Bucket;

    /**
     * Additional fields to track in the file metadata schema.
     * Uses Better Auth's standard FieldAttribute type for consistency
     */
    additionalFields?: Record<string, FieldAttribute>;

    /**
     * Maximum file size in bytes
     * @default 10485760 (10MB)
     */
    maxFileSize?: number;

    /**
     * Allowed file types/extensions
     * @default undefined (all files allowed)
     */
    allowedTypes?: string[];

    /**
     * Lifecycle hooks for file operations
     * Only define the hooks you need - much cleaner than individual callbacks
     */
    hooks?: {
        /**
         * Upload lifecycle hooks
         */
        upload?: {
            /**
             * Called before a file upload. Return null/undefined to prevent upload.
             * Throw ctx.error for structured errors.
             */
            before?: (
                file: File & {
                    userId: string;
                    r2Key: string;
                    metadata: any; // Will be properly typed when used with inferR2Config
                },
                ctx: AuthContext
            ) => void | null | Promise<void | null | undefined>;

            /**
             * Called after successful file upload
             */
            after?: (
                file: any, // Will be properly typed when used with inferR2Config
                ctx: AuthContext
            ) => void | Promise<void>;
        };

        /**
         * Download lifecycle hooks
         */
        download?: {
            /**
             * Called before a file download. Return null/undefined to prevent download.
             * Throw ctx.error for structured errors.
             */
            before?: (
                file: any, // Will be properly typed when used with inferR2Config
                ctx: AuthContext
            ) => void | null | Promise<void | null | undefined>;

            /**
             * Called after successful file download
             */
            after?: (
                file: any, // Will be properly typed when used with inferR2Config
                ctx: AuthContext
            ) => void | Promise<void>;
        };

        /**
         * Delete lifecycle hooks
         */
        delete?: {
            /**
             * Called before a file deletion. Return null/undefined to prevent deletion.
             * Throw ctx.error for structured errors.
             */
            before?: (
                file: any, // Will be properly typed when used with inferR2Config
                ctx: AuthContext
            ) => void | null | Promise<void | null | undefined>;

            /**
             * Called after successful file deletion
             */
            after?: (
                file: any, // Will be properly typed when used with inferR2Config
                ctx: AuthContext
            ) => void | Promise<void>;
        };

        /**
         * List files lifecycle hooks
         */
        list?: {
            /**
             * Called before listing files. Return null/undefined to prevent listing.
             * Throw ctx.error for structured errors.
             */
            before?: (userId: string, ctx: AuthContext) => void | null | Promise<void | null | undefined>;

            /**
             * Called after successful file listing
             */
            after?: (userId: string, files: any, ctx: AuthContext) => void | Promise<void>;
        };
    };
}

// Helper type to convert FieldAttribute to actual TypeScript types
type InferFieldType<T extends FieldAttribute> = T["type"] extends "string"
    ? string
    : T["type"] extends "number"
      ? number
      : T["type"] extends "boolean"
        ? boolean
        : T["type"] extends "date"
          ? Date
          : any;

// Convert Record<string, FieldAttribute> to actual typed object
type InferAdditionalFields<T extends Record<string, FieldAttribute>> = {
    [K in keyof T]: InferFieldType<T[K]>;
};

/**
 * File metadata stored in database with typed additional fields
 */
export interface FileMetadata {
    id: string;
    userId: string;
    filename: string;
    originalName: string;
    contentType: string;
    size: number;
    r2Key: string;
    uploadedAt: Date;
}

/**
 * File metadata with additional fields merged
 */
export type FileMetadataWithAdditionalFields<T extends Record<string, FieldAttribute>> = FileMetadata &
    InferAdditionalFields<T>;

// Infer R2Config types from runtime definition (eliminates double definition!)
export type InferR2Config<T extends R2Config> =
    T["additionalFields"] extends Record<string, FieldAttribute>
        ? Omit<T, "hooks"> & {
              hooks?: {
                  upload?: {
                      before?: (
                          file: File & {
                              userId: string;
                              r2Key: string;
                              metadata: FileMetadataWithAdditionalFields<T["additionalFields"]>;
                          },
                          ctx: AuthContext
                      ) => Promise<void | null | undefined>;

                      after?: (
                          file: FileMetadataWithAdditionalFields<T["additionalFields"]>,
                          ctx: AuthContext
                      ) => Promise<void>;
                  };

                  download?: {
                      before?: (
                          file: FileMetadataWithAdditionalFields<T["additionalFields"]>,
                          ctx: AuthContext
                      ) => Promise<void | null | undefined>;

                      after?: (
                          file: FileMetadataWithAdditionalFields<T["additionalFields"]>,
                          ctx: AuthContext
                      ) => Promise<void>;
                  };

                  delete?: {
                      before?: (
                          file: FileMetadataWithAdditionalFields<T["additionalFields"]>,
                          ctx: AuthContext
                      ) => Promise<void | null | undefined>;

                      after?: (
                          file: FileMetadataWithAdditionalFields<T["additionalFields"]>,
                          ctx: AuthContext
                      ) => Promise<void>;
                  };

                  list?: {
                      before?: (userId: string, ctx: AuthContext) => Promise<void | null | undefined>;

                      after?: (userId: string, files: any, ctx: AuthContext) => Promise<void>;
                  };
              };
          }
        : T;

/**
 * Helper to create a fully typed R2 config with automatic type inference
 *
 * Usage:
 * ```ts
 * const r2Config = createR2Config({
 *   bucket,
 *   maxFileSize: 10 * 1024 * 1024, // 10MB built-in validation
 *   allowedTypes: ['.jpg', '.png', '.pdf'], // Built-in file type validation
 *   additionalFields: {
 *     category: { type: "string" },
 *     isPublic: { type: "boolean" },
 *     priority: { type: "number" }
 *   },
 *   hooks: {
 *     upload: {
 *       before: (file, ctx) => {
 *         if (file.metadata.category === "restricted") return null; // business logic
 *       },
 *       after: (file, ctx) => {
 *         file.category // string (fully typed!)
 *         file.priority // number (fully typed!)
 *         sendNotification(file.userId, `Uploaded ${file.filename}`);
 *       }
 *     },
 *     download: {
 *       before: (file, ctx) => {
 *         if (!file.isPublic && file.userId !== ctx.session?.userId) return null;
 *       }
 *     },
 *     list: {
 *       before: (userId, ctx) => {
 *         if (!userHasPermission(userId, "list_files")) return null;
 *       }
 *     }
 *   }
 * });
 * ```
 */
export function createR2Config<T extends R2Config>(config: T): InferR2Config<T> {
    return config as InferR2Config<T>;
}
