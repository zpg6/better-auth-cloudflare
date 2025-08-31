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
                    tenantId: {
                        type: "string",
                        required: true,
                        // References the organization/tenant this birthday belongs to
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
                        tenantId: {
                            type: "string",
                            required: true,
                            // References the organization/tenant this reminder belongs to
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
        },

        // Plugin endpoints for birthday management
        endpoints: {
            update: createAuthEndpoint(
                "/birthday/update",
                {
                    method: "POST",
                    use: [sessionMiddleware], // Require authentication
                    body: z.object({
                        birthday: z.string().transform(str => {
                            // Parse date string as local date to avoid timezone conversion issues
                            // Input format: "YYYY-MM-DD"
                            const [year, month, day] = str.split("-").map(Number);
                            return new Date(year, month - 1, day); // month is 0-indexed
                        }),
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

                    // Get the tenantId by getting the active organization id from the session
                    const tenantId = session.session?.activeOrganizationId;
                    if (!tenantId) {
                        throw new APIError("UNAUTHORIZED", {
                            message: "Active organization required to access tenant.",
                        });
                    }

                    // Check if birthday already exists
                    const existingBirthday = await ctx.context.adapter.findOne({
                        model: "userBirthday",
                        where: [
                            { field: "userId", value: session.user?.id, operator: "eq" },
                            { field: "tenantId", value: tenantId, operator: "eq" },
                        ],
                    });

                    const now = new Date();
                    const birthdayData = {
                        userId: session.user?.id,
                        tenantId,
                        birthday,
                        isPublic,
                        timezone,
                        updatedAt: now,
                        ...(existingBirthday ? {} : { createdAt: now }),
                    };

                    if (existingBirthday) {
                        // Update existing birthday
                        await ctx.context.adapter.update({
                            model: "userBirthday",
                            where: [
                                { field: "userId", value: session.user?.id, operator: "eq" },
                                { field: "tenantId", value: tenantId, operator: "eq" },
                            ],
                            update: birthdayData,
                        });
                    } else {
                        // Create new birthday record
                        await ctx.context.adapter.create({
                            model: "userBirthday",
                            data: birthdayData,
                        });
                    }

                    return ctx.json({
                        success: true,
                        message: "Birthday saved successfully",
                        data: {
                            birthday,
                            isPublic,
                            timezone,
                        },
                    });
                }
            ),

            getBirthday: createAuthEndpoint(
                "/birthday/get",
                {
                    method: "GET",
                    use: [sessionMiddleware], // Require authentication
                },
                async ctx => {
                    const session = ctx.context.session;

                    if (!session) {
                        throw new APIError("UNAUTHORIZED", { message: "Session required" });
                    }

                    // Get the tenantId by getting the active organization id from the session
                    const tenantId = session.session?.activeOrganizationId;
                    if (!tenantId) {
                        throw new APIError("UNAUTHORIZED", {
                            message: "Active organization required to access tenant.",
                        });
                    }

                    // Use the provided userId or default to current session user
                    const targetUserId = session.user?.id;

                    const birthday = await ctx.context.adapter.findOne<{
                        birthday: Date;
                        isPublic: boolean;
                        timezone: string;
                        userId: string;
                        tenantId: string;
                    }>({
                        model: "userBirthday",
                        where: [
                            { field: "userId", value: targetUserId, operator: "eq" },
                            { field: "tenantId", value: tenantId, operator: "eq" },
                        ],
                    });

                    if (!birthday) {
                        throw new APIError("NOT_FOUND", { message: "Birthday not found" });
                    }

                    // If requesting someone else's birthday, check if it's public
                    if (targetUserId !== session.user?.id && !birthday.isPublic) {
                        throw new APIError("FORBIDDEN", { message: "Birthday is private" });
                    }

                    return ctx.json({
                        userId: birthday.userId,
                        birthday: birthday.birthday,
                        isPublic: birthday.isPublic,
                        timezone: birthday.timezone,
                    });
                }
            ),

            upcomingBirthdays: createAuthEndpoint(
                "/birthday/upcoming",
                {
                    method: "GET",
                    use: [sessionMiddleware], // Require authentication
                },
                async ctx => {
                    const session = ctx.context.session;

                    if (!session) {
                        throw new APIError("UNAUTHORIZED", { message: "Session required" });
                    }

                    // Get the tenantId by getting the active organization id from the session
                    const tenantId = session.session?.activeOrganizationId;
                    if (!tenantId) {
                        throw new APIError("UNAUTHORIZED", {
                            message: "Active organization required to access tenant.",
                        });
                    }

                    // Get current date and calculate upcoming range (next 30 days)
                    const now = new Date();
                    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                    // Find all public birthdays in the tenant
                    const birthdays = await ctx.context.adapter.findMany<{
                        userId: string;
                        birthday: Date;
                        isPublic: boolean;
                        timezone: string;
                        tenantId: string;
                    }>({
                        model: "userBirthday",
                        where: [
                            { field: "isPublic", value: true, operator: "eq" },
                            { field: "tenantId", value: tenantId, operator: "eq" },
                        ],
                    });

                    // Filter for upcoming birthdays (simple date comparison)
                    // Note: This is a simplified implementation - in production you'd want
                    // more sophisticated date handling for timezones and recurring birthdays
                    const upcomingBirthdays = birthdays
                        .filter(birthday => {
                            const birthdayThisYear = new Date(
                                now.getFullYear(),
                                birthday.birthday.getMonth(),
                                birthday.birthday.getDate()
                            );
                            return birthdayThisYear >= now && birthdayThisYear <= thirtyDaysFromNow;
                        })
                        .map(birthday => ({
                            userId: birthday.userId,
                            birthday: birthday.birthday,
                            timezone: birthday.timezone,
                        }));

                    return ctx.json({
                        birthdays: upcomingBirthdays,
                        count: upcomingBirthdays.length,
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

                    // Get the tenantId by getting the active organization id from the session
                    const tenantId = session.session?.activeOrganizationId;
                    if (!tenantId) {
                        throw new APIError("UNAUTHORIZED", {
                            message: "Active organization required to access tenant.",
                        });
                    }

                    // Check if the target user exists and has a birthday in this tenant
                    const targetUserBirthday = await ctx.context.adapter.findOne({
                        model: "userBirthday",
                        where: [
                            { field: "userId", value: toUserId, operator: "eq" },
                            { field: "tenantId", value: tenantId, operator: "eq" },
                        ],
                    });

                    if (!targetUserBirthday) {
                        throw new APIError("NOT_FOUND", { message: "User birthday not found in this organization" });
                    }

                    // Create birthday wish record
                    const now = new Date();
                    const wishData = {
                        fromUserId: session.user?.id,
                        toUserId,
                        tenantId,
                        message,
                        isPublic,
                        createdAt: now,
                    };

                    const wish = await ctx.context.adapter.create({
                        model: "birthdayWish",
                        data: wishData,
                    });

                    ctx.context.logger.success(`Birthday wish sent from ${session.user?.id} to ${toUserId}`);

                    return ctx.json({
                        success: true,
                        message: "Birthday wish sent successfully",
                        data: {
                            wishId: wish.id,
                            fromUserId: session.user?.id,
                            toUserId,
                            message,
                            isPublic,
                            createdAt: now,
                        },
                    });
                }
            ),
        },
    } satisfies BetterAuthPlugin;
};
