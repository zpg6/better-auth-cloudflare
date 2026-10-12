import type { AuthContext, Where } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx, sessionMiddleware } from "better-auth/api";
import type { DBFieldAttribute } from "better-auth/db";
import { z, type ZodType } from "zod";
import type { FileMetadata, R2Config } from "./types";

export const R2_ERROR_CODES = {
    FILE_TOO_LARGE: "File is too large. Please choose a smaller file",
    INVALID_FILE_TYPE: "File type not supported. Please choose a different file",
    NO_FILE_PROVIDED: "Please select a file to upload",
    INVALID_REQUEST: "Invalid request. Please try again",
    R2_STORAGE_NOT_CONFIGURED: "File storage is temporarily unavailable. Please try again later",
    UPLOAD_FAILED: "Upload failed. Please check your connection and try again",
    FILE_ID_REQUIRED: "File not found",
    LIST_FILES_FAILED: "Unable to load your files. Please refresh the page",
    INVALID_METADATA: "Invalid file information. Please try uploading again",
    UPLOAD_ROLLBACK_FAILED: "Upload failed. Please try again",
    INVALID_FILE_RECORD: "File information is corrupted. Please contact support",
    DB_OPERATION_FAILED: "Service temporarily unavailable. Please try again later",
} as const;

/**
 * Result type for validation operations
 */
export type ValidationResult<T> = { success: true; data: T } | { success: false; error: string; code?: string };

/**
 * Helper to create success result
 */
export const success = <T>(data: T): ValidationResult<T> => ({ success: true, data });

/**
 * Helper to create error result
 */
export const error = (message: string, code?: string): ValidationResult<never> => ({
    success: false,
    error: message,
    code,
});

/**
 * Type guard to validate FileMetadata from database records
 */
function validateFileMetadata(record: any): record is FileMetadata {
    if (!record || typeof record !== "object") {
        return false;
    }

    // Check required string fields
    if (
        typeof record.id !== "string" ||
        typeof record.userId !== "string" ||
        typeof record.filename !== "string" ||
        typeof record.originalName !== "string" ||
        typeof record.contentType !== "string" ||
        typeof record.r2Key !== "string"
    ) {
        return false;
    }

    // Check size is a number
    if (typeof record.size !== "number") {
        return false;
    }

    // Check uploadedAt is a valid date (can be Date object or valid date string)
    if (record.uploadedAt) {
        const date = record.uploadedAt instanceof Date ? record.uploadedAt : new Date(record.uploadedAt);

        if (isNaN(date.getTime())) {
            return false;
        }

        // Convert string dates to Date objects for consistency
        if (!(record.uploadedAt instanceof Date)) {
            record.uploadedAt = date;
        }
    } else {
        return false;
    }

    return true;
}

/**
 * Converts Better Auth FieldAttribute to Zod schema (same pattern as feedback plugin)
 */
function convertFieldAttributesToZodSchema(additionalFields: Record<string, DBFieldAttribute>) {
    const zodSchema: Record<string, ZodType> = {};

    for (const [key, value] of Object.entries(additionalFields)) {
        let fieldSchema: ZodType;

        if (value.type === "string") {
            fieldSchema = z.string();
        } else if (value.type === "number") {
            fieldSchema = z.number();
        } else if (value.type === "boolean") {
            fieldSchema = z.boolean();
        } else if (value.type === "date") {
            fieldSchema = z.date();
        } else if (value.type === "string[]") {
            fieldSchema = z.array(z.string());
        } else if (value.type === "number[]") {
            fieldSchema = z.array(z.number());
        } else {
            throw new Error(`Unsupported field type: ${value.type} for field ${key}`);
        }

        if (!value.required) {
            fieldSchema = fieldSchema.optional();
        }

        zodSchema[key] = fieldSchema;
    }

    return z.object(zodSchema);
}

// Zod schemas for validation
export const createFileMetadataSchema = (additionalFields?: Record<string, DBFieldAttribute>) => {
    if (!additionalFields || Object.keys(additionalFields).length === 0) {
        return z.object({}).optional();
    }
    return convertFieldAttributesToZodSchema(additionalFields).optional();
};

export const fileIdSchema = z.object({
    fileId: z.string().min(1, "File ID is required"),
});

export const listFilesSchema = z
    .object({
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .transform(n => Math.min(n, 100))
            .optional(),
        // `${uploadedAt ms}:${id}` of the previous page's last file
        cursor: z
            .string()
            .regex(/^\d{1,15}:./)
            .transform(c => ({ at: new Date(+c.slice(0, c.indexOf(":"))), id: c.slice(c.indexOf(":") + 1) }))
            .optional(),
    })
    .optional();

// Standard upload schema - everything in the body
/**
 * Creates upload schema dynamically based on additionalFields configuration
 */
export const createUploadFileSchema = (additionalFields?: Record<string, DBFieldAttribute>) => {
    const baseShape: Record<string, ZodType> = {
        file: z.instanceof(File),
    };

    if (!additionalFields || Object.keys(additionalFields).length === 0) {
        return z.object(baseShape);
    }

    // Add additionalFields to the schema
    for (const [key, value] of Object.entries(additionalFields)) {
        let fieldSchema: ZodType;

        if (value.type === "string") {
            fieldSchema = z.string();
        } else if (value.type === "number") {
            fieldSchema = z.number();
        } else if (value.type === "boolean") {
            fieldSchema = z.boolean();
        } else if (value.type === "date") {
            fieldSchema = z.date();
        } else if (value.type === "string[]") {
            fieldSchema = z.array(z.string());
        } else if (value.type === "number[]") {
            fieldSchema = z.array(z.number());
        } else {
            throw new Error(`Unsupported field type: ${value.type} for field ${key}`);
        }

        if (!value.required) {
            fieldSchema = fieldSchema.optional();
        }

        baseShape[key] = fieldSchema;
    }

    return z.object(baseShape);
};

/**
 * Sanitizes a filename to prevent path traversal and ensure safe storage
 */
const sanitizeFilename = (filename: string): string => {
    // Remove path separators and other dangerous characters
    // Keep only alphanumeric, dots, dashes, and underscores
    return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255); // Also limit length
};

/**
 * Validates file constraints using Result pattern
 */
export const createFileValidator = (config: R2Config) => {
    const {
        maxFileSize = 10485760, // 10MB default
        allowedTypes,
    } = config;

    return {
        validateFile: (file: File, ctx?: AuthContext): ValidationResult<true> => {
            // Validate file size
            if (file.size > maxFileSize) {
                const maxSizeMB = Math.round(maxFileSize / (1024 * 1024));
                const errorMsg = `${R2_ERROR_CODES.FILE_TOO_LARGE} (max ${maxSizeMB}MB)`;
                ctx?.logger?.error(`[R2]: File size validation failed:`, errorMsg);
                return error(errorMsg, "FILE_TOO_LARGE");
            }

            // Validate file type if restrictions are set
            if (allowedTypes && allowedTypes.length > 0) {
                if (!file.name) {
                    const errorMsg = "File must have a name when file type restrictions are enabled";
                    ctx?.logger?.error(`[R2]: File name validation failed:`, errorMsg);
                    return error(errorMsg, "INVALID_FILE_NAME");
                }

                const getFileExtension = (filename: string): string => {
                    const lastDotIndex = filename.lastIndexOf(".");
                    return lastDotIndex === -1 ? "" : filename.slice(lastDotIndex + 1).toLowerCase();
                };

                const extension = getFileExtension(file.name);

                if (!extension) {
                    const errorMsg = "File must have an extension when file type restrictions are enabled";
                    ctx?.logger?.error(`[R2]: File extension validation failed:`, errorMsg);
                    return error(errorMsg, "INVALID_FILE_EXTENSION");
                }

                // Normalize allowed types and check
                const normalizedAllowedTypes = allowedTypes.map(type =>
                    type.startsWith(".") ? type.slice(1).toLowerCase() : type.toLowerCase()
                );

                const isAllowed = normalizedAllowedTypes.includes(extension);

                if (!isAllowed) {
                    const allowedTypesFormatted = allowedTypes
                        .map(type => (type.startsWith(".") ? type : `.${type}`))
                        .join(", ");
                    const errorMsg = `${R2_ERROR_CODES.INVALID_FILE_TYPE}. Supported formats: ${allowedTypesFormatted}`;
                    ctx?.logger?.error(`[R2]: File type validation failed:`, errorMsg);
                    return error(errorMsg, "INVALID_FILE_TYPE");
                }
            }

            return success(true);
        },

        validateMetadata: (
            metadata: Record<string, any>,
            ctx?: AuthContext
        ): ValidationResult<Record<string, any> | undefined> => {
            const metadataSchema = createFileMetadataSchema(config.additionalFields);
            const result = metadataSchema.safeParse(metadata);

            if (!result.success) {
                // Extract detailed error information from Zod
                const errorMessages = result.error.issues
                    .map(err => {
                        const path = err.path.length > 0 ? `${err.path.join(".")}: ` : "";
                        return `${path}${err.message}`;
                    })
                    .join(", ");

                const detailedError = `Invalid metadata: ${errorMessages}`;
                ctx?.logger?.error(`[R2]: Metadata validation failed:`, {
                    error: detailedError,
                    metadata,
                    zodErrors: result.error.issues,
                });

                return error(detailedError, "INVALID_METADATA");
            }

            return success(result.data);
        },
    };
};

/**
 * Creates R2 storage utilities with Better Auth context for error handling and logging
 */
export const createR2Storage = (
    config: R2Config,
    generateId: (options: { model: string; size?: number }) => string | false
) => {
    const { bucket } = config;

    const validator = createFileValidator(config);

    return {
        /**
         * Uploads a file to R2 and returns metadata
         */
        async uploadFile(
            file: File | Blob,
            originalName: string,
            userId: string,
            ctx: AuthContext, // Better Auth context for error handling and logging
            customMetadata?: Record<string, any>,
            modelName?: string // Model name for ID generation
        ): Promise<FileMetadata> {
            let r2Key: string | null = null;

            try {
                // Create a File object for validation if we have a Blob
                // Ensure the file name is properly set for validation
                const fileForValidation =
                    file instanceof File ? file : new File([file], originalName, { type: file.type });

                // Validate file using Result pattern
                const fileValidation = validator.validateFile(fileForValidation, ctx);
                if (!fileValidation.success) {
                    const status =
                        fileValidation.code === "FILE_TOO_LARGE"
                            ? "PAYLOAD_TOO_LARGE"
                            : fileValidation.code === "INVALID_FILE_TYPE"
                              ? "UNSUPPORTED_MEDIA_TYPE"
                              : "BAD_REQUEST";
                    throw new APIError(status, { message: fileValidation.error });
                }

                // Validate metadata if provided
                let validatedMetadata: Record<string, any> | undefined = undefined;
                if (customMetadata) {
                    const metadataValidation = validator.validateMetadata(customMetadata, ctx);
                    if (!metadataValidation.success) {
                        throw new APIError("BAD_REQUEST", { message: metadataValidation.error });
                    }
                    validatedMetadata = metadataValidation.data;
                }

                const fileId = generateId({ model: modelName || "userFile" });
                if (!fileId) {
                    throw new Error("Failed to generate unique file ID. Please try again.");
                }
                const filename = `${fileId}-${sanitizeFilename(originalName)}`;
                r2Key = `user-files/${userId}/${filename}`;

                // Create metadata for callbacks
                const metadata: FileMetadata = {
                    ...validatedMetadata,
                    id: fileId,
                    userId,
                    filename,
                    originalName,
                    contentType: file.type,
                    size: file.size,
                    r2Key,
                    uploadedAt: new Date(),
                };

                // Call beforeUpload hook
                if (config.hooks?.upload?.before) {
                    const result = await config.hooks.upload.before(
                        Object.assign(fileForValidation, {
                            userId,
                            r2Key,
                            metadata: metadata as FileMetadata & Record<string, unknown>,
                        }),
                        ctx
                    );
                    if (result === null) {
                        throw new APIError("FORBIDDEN", { message: "Upload prevented by beforeUpload hook" });
                    }
                }

                ctx?.logger?.info(`[R2]: Uploading file for user "${userId}": ${filename}`);

                // Upload to R2 with proper typing and improved metadata handling
                const uploadOptions = {
                    httpMetadata: {
                        contentType: file.type,
                    },
                    ...(validatedMetadata && {
                        customMetadata: Object.fromEntries(
                            Object.entries(validatedMetadata).map(([k, v]) => [
                                k,
                                v === null || v === undefined
                                    ? ""
                                    : typeof v === "object"
                                      ? JSON.stringify(v)
                                      : String(v),
                            ])
                        ),
                    }),
                };

                // DOM Blob/File and Workers Blob/File are structurally identical at runtime
                const result = await bucket.put(r2Key, file as Parameters<typeof bucket.put>[1], uploadOptions);

                // Basic result validation - R2 put typically returns an object on success
                if (!result) {
                    throw new Error(R2_ERROR_CODES.UPLOAD_FAILED);
                }

                ctx?.logger?.info(`[R2]: Successfully uploaded file for user "${userId}": ${filename}`);

                // Call afterUpload hook
                if (config.hooks?.upload?.after) {
                    await config.hooks.upload.after(metadata as FileMetadata & Record<string, unknown>, ctx);
                }

                return metadata;
            } catch (error) {
                // Rollback: delete from R2 if upload succeeded but something else failed
                if (r2Key) {
                    try {
                        await bucket.delete(r2Key);
                        ctx?.logger?.info(`[R2]: Cleaned up failed upload: ${r2Key}`);
                    } catch (cleanupError) {
                        ctx?.logger?.error(`[R2]: Failed to cleanup after upload failure:`, cleanupError);
                    }
                }

                ctx?.logger?.error(`[R2]: Upload failed for user "${userId}":`, error);
                throw error;
            }
        },

        /**
         * Downloads a file from R2
         */
        async downloadFile(fileMetadata: FileMetadata, ctx: AuthContext): Promise<ReadableStream | null> {
            const hookData = fileMetadata as FileMetadata & Record<string, unknown>;
            if (config.hooks?.download?.before) {
                const result = await config.hooks.download.before(hookData, ctx);
                if (result === null) {
                    throw new APIError("FORBIDDEN", { message: "Download prevented by beforeDownload hook" });
                }
            }

            const object = await bucket.get(fileMetadata.r2Key);
            // Workers ReadableStream and DOM ReadableStream are structurally identical at runtime
            const downloadResult = (object?.body as ReadableStream | undefined) || null;

            if (config.hooks?.download?.after) {
                await config.hooks.download.after(hookData, ctx);
            }

            return downloadResult;
        },

        /**
         * Deletes a file from R2
         */
        async deleteFile(fileMetadata: FileMetadata, ctx: AuthContext): Promise<void> {
            const hookData = fileMetadata as FileMetadata & Record<string, unknown>;
            if (config.hooks?.delete?.before) {
                const result = await config.hooks.delete.before(hookData, ctx);
                if (result === null) {
                    throw new APIError("FORBIDDEN", { message: "Delete prevented by beforeDelete hook" });
                }
            }

            await bucket.delete(fileMetadata.r2Key);

            if (config.hooks?.delete?.after) {
                await config.hooks.delete.after(hookData, ctx);
            }
        },

        /**
         * Gets file metadata from R2
         */
        async getFileInfo(r2Key: string) {
            return await bucket.head(r2Key);
        },
    };
};

/**
 * Creates R2 endpoints for Better Auth plugin
 */
export const createR2Endpoints = (
    getR2Storage: () => ReturnType<typeof createR2Storage> | null,
    r2Config?: R2Config
) => {
    return {
        upload: createAuthEndpoint(
            "/files/upload-raw",
            {
                method: "POST",
                // better-call would decode or stringify the body; the handler reads the raw bytes instead.
                disableBody: true,
            },
            async ctx => {
                // Manually get session instead of using middleware
                const session = await getSessionFromCtx(ctx);
                if (!session) {
                    throw ctx.error("UNAUTHORIZED", { message: "Please sign in to upload files" });
                }

                try {
                    ctx.context.logger?.info("[R2]: Starting blob file upload");

                    const r2Storage = getR2Storage();

                    if (!r2Storage) {
                        ctx.context.logger?.error("[R2]: R2 storage not configured");
                        throw ctx.error("INTERNAL_SERVER_ERROR", {
                            message: R2_ERROR_CODES.R2_STORAGE_NOT_CONFIGURED,
                        });
                    }

                    // Get configured max file size (preemptively checking for DoS attacks)
                    const maxFileSize = r2Config?.maxFileSize || 10485760; // 10MB default

                    const tooLarge = () =>
                        new APIError("PAYLOAD_TOO_LARGE", {
                            message: `${R2_ERROR_CODES.FILE_TOO_LARGE} (max ${Math.round(maxFileSize / (1024 * 1024))}MB)`,
                        });
                    if (+(ctx.request?.headers.get("content-length") ?? 0) > maxFileSize) {
                        throw tooLarge();
                    }

                    // Get filename and metadata from headers
                    const rawFilename = ctx.request?.headers?.get("x-filename");
                    const rawMetadataHeader = ctx.request?.headers?.get("x-file-metadata");

                    if (!rawFilename) {
                        throw new APIError("BAD_REQUEST", { message: "x-filename header is required" });
                    }

                    let filename = rawFilename;
                    try {
                        filename = decodeURIComponent(rawFilename);
                    } catch {} // older clients send the name unencoded
                    if (/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(filename)) {
                        throw new APIError("BAD_REQUEST", {
                            message: "x-filename must not contain control characters",
                        });
                    }

                    const metadataHeader = rawMetadataHeader
                        ? rawMetadataHeader
                              .split("")
                              .map(char => {
                                  const code = char.charCodeAt(0);
                                  return code <= 127 ? char : "?";
                              })
                              .join("")
                        : undefined;

                    // Parse metadata from headers
                    let additionalFields: Record<string, any> = {};
                    if (metadataHeader) {
                        try {
                            additionalFields = JSON.parse(metadataHeader);
                        } catch (error) {
                            ctx.context.logger?.warn("[R2]: Failed to parse metadata header:", error);
                            throw new APIError("BAD_REQUEST", { message: "Invalid JSON in x-file-metadata header" });
                        }
                    }

                    if (!ctx.request) {
                        throw new APIError("BAD_REQUEST", { message: R2_ERROR_CODES.NO_FILE_PROVIDED });
                    }
                    // Counted as it streams so a body without Content-Length cannot be buffered past maxFileSize.
                    const chunks: Uint8Array<ArrayBuffer>[] = [];
                    const reader = ctx.request.body?.getReader();
                    for (let size = 0; reader; ) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if ((size += value.byteLength) > maxFileSize) {
                            await reader.cancel();
                            throw tooLarge();
                        }
                        chunks.push(value);
                    }
                    const fileToUpload = new File(chunks, filename, {
                        type: ctx.request.headers.get("content-type") || "application/octet-stream",
                    });

                    // Use userFile - adapter handles plural/singular internally
                    const modelName = "userFile";

                    // Upload the file using existing R2 storage utility
                    const fileMetadata = await r2Storage.uploadFile(
                        fileToUpload,
                        filename,
                        session.session.userId,
                        ctx.context,
                        additionalFields,
                        modelName
                    );

                    // Store file metadata in database
                    try {
                        await ctx.context.adapter.create({ model: modelName, forceAllowId: true, data: fileMetadata });

                        ctx.context.logger?.info("[R2]: File metadata saved to database:", fileMetadata.id);
                    } catch (dbError) {
                        ctx.context.logger?.error("[R2]: Failed to save to database:", dbError);

                        // Clean up R2 file if database save failed
                        try {
                            await r2Storage.deleteFile(fileMetadata, ctx.context);
                        } catch (cleanupError) {
                            ctx.context.logger?.error("[R2]: Failed to cleanup R2 file after DB error:", cleanupError);
                        }

                        throw ctx.error("INTERNAL_SERVER_ERROR", {
                            message: R2_ERROR_CODES.DB_OPERATION_FAILED,
                        });
                    }

                    return ctx.json({
                        success: true,
                        data: fileMetadata,
                    });
                } catch (error) {
                    ctx.context.logger?.error("[R2]: Upload failed:", error);

                    if (error instanceof APIError) {
                        throw error;
                    }
                    throw ctx.error("INTERNAL_SERVER_ERROR", {
                        message: R2_ERROR_CODES.UPLOAD_FAILED,
                    });
                }
            }
        ),

        download: createAuthEndpoint(
            "/files/download",
            {
                method: "POST",
                use: [sessionMiddleware],
                body: fileIdSchema,
            },
            async ctx => {
                const session = ctx.context.session;
                const r2Storage = getR2Storage();

                if (!r2Storage) {
                    ctx.context.logger?.error("[R2]: R2 storage not configured");
                    throw ctx.error("INTERNAL_SERVER_ERROR", {
                        message: R2_ERROR_CODES.R2_STORAGE_NOT_CONFIGURED,
                    });
                }

                const { fileId } = ctx.body;

                // Query the database to get file metadata and verify ownership
                const fileRecord = await ctx.context.adapter.findOne({
                    model: "userFile",
                    where: [
                        { field: "id", value: fileId },
                        { field: "userId", value: session.session.userId },
                    ],
                });

                if (!fileRecord) {
                    ctx.context.logger?.warn(
                        `[R2]: File not found or access denied for user "${session.session.userId}": ${fileId}`
                    );
                    throw ctx.error("NOT_FOUND", {
                        message: "File not found. It may have been deleted or you don't have permission to access it",
                    });
                }

                // Validate the file record structure
                if (!validateFileMetadata(fileRecord)) {
                    ctx.context.logger?.error(`[R2]: Invalid file record structure for file: ${fileId}`);
                    throw ctx.error("INTERNAL_SERVER_ERROR", {
                        message: R2_ERROR_CODES.INVALID_FILE_RECORD,
                    });
                }

                // Download the file from R2
                const fileData = await r2Storage.downloadFile(fileRecord, ctx.context);

                if (!fileData) {
                    ctx.context.logger?.error(`[R2]: File data not found in R2 for file: ${fileId}`);
                    throw ctx.error("NOT_FOUND", {
                        message: "File content is temporarily unavailable. Please try again later",
                    });
                }

                ctx.context.logger?.info(
                    `[R2]: File downloaded successfully for user "${session.session.userId}": ${fileId}`
                );

                // Return the file with appropriate headers
                return new Response(fileData, {
                    headers: {
                        "Content-Type": fileRecord.contentType || "application/octet-stream",
                        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileRecord.originalName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`,
                        "Content-Length": fileRecord.size?.toString() || "0",
                        "X-Content-Type-Options": "nosniff",
                        "Content-Security-Policy": "sandbox",
                    },
                });
            }
        ),

        delete: createAuthEndpoint(
            "/files/delete",
            {
                method: "POST",
                use: [sessionMiddleware],
                body: fileIdSchema,
            },
            async ctx => {
                const session = ctx.context.session;
                const r2Storage = getR2Storage();

                if (!r2Storage) {
                    ctx.context.logger?.error("[R2]: R2 storage not configured");
                    throw ctx.error("INTERNAL_SERVER_ERROR", {
                        message: R2_ERROR_CODES.R2_STORAGE_NOT_CONFIGURED,
                    });
                }

                const { fileId } = ctx.body;

                // Query the database to get file metadata and verify ownership
                const fileRecord = await ctx.context.adapter.findOne({
                    model: "userFile",
                    where: [
                        { field: "id", value: fileId },
                        { field: "userId", value: session.session.userId },
                    ],
                });

                if (!fileRecord) {
                    ctx.context.logger?.warn(
                        `[R2]: File not found or access denied for user "${session.session.userId}": ${fileId}`
                    );
                    throw ctx.error("NOT_FOUND", {
                        message: "File not found. It may have been deleted or you don't have permission to delete it",
                    });
                }

                // Validate the file record structure
                if (!validateFileMetadata(fileRecord)) {
                    ctx.context.logger?.error(`[R2]: Invalid file record structure for file: ${fileId}`);
                    throw ctx.error("INTERNAL_SERVER_ERROR", {
                        message: R2_ERROR_CODES.INVALID_FILE_RECORD,
                    });
                }

                // Delete from R2 first
                await r2Storage.deleteFile(fileRecord, ctx.context);

                // Delete from database
                await ctx.context.adapter.delete({
                    model: "userFile",
                    where: [{ field: "id", value: fileId }],
                });

                ctx.context.logger?.info(
                    `[R2]: File deleted successfully for user "${session.session.userId}": ${fileId}`
                );

                return ctx.json({
                    message: "File deleted successfully",
                    fileId: fileId,
                });
            }
        ),

        list: createAuthEndpoint(
            "/files/list",
            {
                method: "GET",
                use: [sessionMiddleware],
                query: listFilesSchema,
            },
            async ctx => {
                const session = ctx.context.session;

                const r2Storage = getR2Storage();

                if (!r2Storage) {
                    ctx.context.logger?.error("[R2]: R2 storage not configured");
                    throw ctx.error("INTERNAL_SERVER_ERROR", {
                        message: R2_ERROR_CODES.R2_STORAGE_NOT_CONFIGURED,
                    });
                }

                const userId = session.session.userId;
                if ((await r2Config?.hooks?.list?.before?.(userId, ctx.context)) === null) {
                    throw ctx.error("FORBIDDEN", { message: "List prevented by beforeList hook" });
                }

                const { limit = 50, cursor } = ctx.query ?? {};
                const find = (where: Where[], n: number, field = "uploadedAt") =>
                    ctx.context.adapter.findMany<FileMetadata>({
                        model: "userFile",
                        where: [{ field: "userId", value: userId }, ...where],
                        limit: n,
                        sortBy: { field, direction: "desc" },
                    });
                // Uploads sharing a millisecond are ordered by id, so a page edge inside one resumes exactly.
                // gte+lte because the memory adapter compares Date equality by reference.
                const sameMs = (at: Date, n: number, below?: string) =>
                    find(
                        [
                            { field: "uploadedAt", operator: "gte", value: at },
                            { field: "uploadedAt", operator: "lte", value: at },
                            ...(below ? [{ field: "id", operator: "lt", value: below } as const] : []),
                        ],
                        n,
                        "id"
                    );

                let records: FileMetadata[];
                try {
                    records = cursor ? await sameMs(cursor.at, limit + 1, cursor.id) : [];
                    if (records.length <= limit) {
                        const need = limit + 1 - records.length;
                        let older = await find(
                            cursor ? [{ field: "uploadedAt", operator: "lt", value: cursor.at }] : [],
                            need
                        );
                        // The page's last row becomes the cursor, so its millisecond group must be in database id order.
                        const end = older.length === need ? older[need - 2] : undefined;
                        const rest = end ? older.filter(file => +file.uploadedAt !== +end.uploadedAt) : older;
                        if (end && older.length - rest.length > 1) {
                            older = [...rest, ...(await sameMs(end.uploadedAt, older.length - rest.length))];
                        }
                        records.push(...older);
                    }
                } catch (error) {
                    ctx.context.logger?.error("[R2]: Failed to list files:", error);
                    throw ctx.error("INTERNAL_SERVER_ERROR", {
                        message: R2_ERROR_CODES.LIST_FILES_FAILED,
                    });
                }
                // Stable, and never compares ids: tied rows keep the database's collation order that cursors rely on.
                records.sort((a, b) => +b.uploadedAt - +a.uploadedAt);
                const last = records.length > limit ? records[limit - 1] : undefined;
                const files = records.slice(0, limit).filter(validateFileMetadata);

                await r2Config?.hooks?.list?.after?.(
                    userId,
                    { objects: files.map(file => ({ key: file.r2Key })) },
                    ctx.context
                );

                return ctx.json({
                    files,
                    nextCursor: last ? `${+last.uploadedAt}:${last.id}` : null,
                    hasMore: !!last,
                });
            }
        ),

        get: createAuthEndpoint(
            "/files/get",
            {
                method: "POST",
                use: [sessionMiddleware],
                body: fileIdSchema,
            },
            async ctx => {
                const session = ctx.context.session;
                const { fileId } = ctx.body;

                // Query the database to get file metadata and verify ownership
                const fileRecord = await ctx.context.adapter.findOne({
                    model: "userFile",
                    where: [
                        { field: "id", value: fileId },
                        { field: "userId", value: session.session.userId },
                    ],
                });

                if (!fileRecord) {
                    ctx.context.logger?.warn(
                        `[R2]: File not found or access denied for user "${session.session.userId}": ${fileId}`
                    );
                    throw ctx.error("NOT_FOUND", {
                        message: "File not found. It may have been deleted or you don't have permission to access it",
                    });
                }

                return ctx.json({ data: fileRecord });
            }
        ),
    };
};
