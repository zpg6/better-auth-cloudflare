import { type BetterAuthPlugin } from "better-auth";
import { z } from "zod";
import { createAuthEndpoint, sessionMiddleware, APIError } from "better-auth/api";

export interface BirthdayPluginOptions {
    /**
     * Whether to enable birthday reminders
     * @default true
     */
    enableReminders?: boolean;

    /**
     * How many days before birthday to send reminder
     * @default 7
     */
    reminderDaysBefore?: number;
}

/**
 * Birthday plugin for Better Auth
 *
 * This plugin adds birthday tracking functionality with tenant-scoped data.
 * It creates tables that should be stored in tenant databases rather than
 * the main auth database.
 */
export const birthdayPlugin = (options: BirthdayPluginOptions = {}) => {
    const { enableReminders = true, reminderDaysBefore = 7 } = options;

    return {
        id: "birthday",
        schema: {
            // User birthdays - tenant-scoped data
            userBirthday: {
                fields: {
                    userId: {
                        type: "string",
                        required: true,
                        // No references - users table is in main DB, this is in tenant DB
                    },
                    birthday: {
                        type: "date",
                        required: true,
                    },
                    isPublic: {
                        type: "boolean",
                        required: false,
                        defaultValue: false,
                    },
                    timezone: {
                        type: "string",
                        required: false,
                    },
                    createdAt: {
                        type: "date",
                        required: true,
                    },
                    updatedAt: {
                        type: "date",
                        required: true,
                    },
                },
            },

            // Birthday reminders - tenant-scoped data
            ...(enableReminders && {
                birthdayReminder: {
                    fields: {
                        userId: {
                            type: "string",
                            required: true,
                            // No references - users table is in main DB, this is in tenant DB
                        },
                        reminderDate: {
                            type: "date",
                            required: true,
                        },
                        reminderType: {
                            type: "string",
                            required: true, // "email", "push", "sms"
                        },
                        sent: {
                            type: "boolean",
                            required: false,
                            defaultValue: false,
                        },
                        sentAt: {
                            type: "date",
                            required: false,
                        },
                        createdAt: {
                            type: "date",
                            required: true,
                        },
                    },
                },
            }),

            // Birthday wishes - tenant-scoped social data
            birthdayWish: {
                fields: {
                    fromUserId: {
                        type: "string",
                        required: true,
                        // No references - users table is in main DB, this is in tenant DB
                    },
                    toUserId: {
                        type: "string",
                        required: true,
                        // No references - users table is in main DB, this is in tenant DB
                    },
                    message: {
                        type: "string",
                        required: true,
                    },
                    isPublic: {
                        type: "boolean",
                        required: false,
                        defaultValue: true,
                    },
                    createdAt: {
                        type: "date",
                        required: true,
                    },
                },
            },
        },

        // Plugin endpoints for birthday management
        endpoints: {
            update: createAuthEndpoint(
                "/birthday/update",
                {
                    method: "POST",
                    use: [sessionMiddleware], // Require authentication
                    body: z.object({
                        birthday: z.date(),
                        isPublic: z.boolean(),
                        timezone: z.string(),
                    }),
                },
                async ctx => {
                    const { birthday, isPublic = false, timezone } = ctx.body;
                    const session = ctx.context.session;

                    if (!session) {
                        throw new APIError("UNAUTHORIZED", { message: "Session required" });
                    }

                    // TODO: Implement database logic to save birthday
                    // This would interact with the tenant database

                    return ctx.json({
                        success: true,
                        message: "Birthday saved successfully",
                    });
                }
            ),

            read: createAuthEndpoint(
                "/birthday/read",
                {
                    method: "POST",
                    use: [sessionMiddleware], // Require authentication
                    body: z.object({
                        userId: z.string(),
                    }),
                },
                async ctx => {
                    const session = ctx.context.session;

                    if (!session) {
                        throw new APIError("UNAUTHORIZED", { message: "Session required" });
                    }

                    // TODO: Implement database logic to get birthday
                    // This would query the tenant database

                    return ctx.json({
                        birthday: null,
                        isPublic: false,
                        timezone: null,
                    });
                }
            ),

            upcoming: createAuthEndpoint(
                "/birthday/upcoming",
                {
                    method: "POST",
                    use: [sessionMiddleware], // Require authentication
                },
                async ctx => {
                    return ctx.json({
                        birthdays: [],
                    });
                }
            ),

            wish: createAuthEndpoint(
                "/birthday/wish",
                {
                    method: "POST",
                    use: [sessionMiddleware], // Require authentication
                    body: z.object({
                        toUserId: z.string(),
                        message: z.string(),
                        isPublic: z.boolean(),
                    }),
                },
                async ctx => {
                    const { toUserId, message, isPublic = true } = ctx.body;
                    const session = ctx.context.session;

                    if (!session) {
                        throw new APIError("UNAUTHORIZED", { message: "Session required" });
                    }

                    if (!toUserId || !message) {
                        throw new APIError("BAD_REQUEST", { message: "toUserId and message are required" });
                    }

                    ctx.context.logger.success("Wishing birthday to " + toUserId);

                    return ctx.json({
                        success: true,
                        message: "Birthday wish sent successfully",
                    });
                }
            ),
        },
    } satisfies BetterAuthPlugin;
};
