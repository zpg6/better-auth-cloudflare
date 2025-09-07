import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Tenant-specific Better Auth tables for tenant databases
// These tables contain tenant-scoped data like sessions, files, and organization data

export const userBirthdays = sqliteTable("user_birthdays", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    birthday: integer("birthday", { mode: "timestamp" }).notNull(),
    isPublic: integer("is_public", { mode: "boolean" }),
    timezone: text("timezone"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
export const birthdayReminders = sqliteTable("birthday_reminders", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    reminderDate: integer("reminder_date", { mode: "timestamp" }).notNull(),
    reminderType: text("reminder_type").notNull(),
    sent: integer("sent", { mode: "boolean" }),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
