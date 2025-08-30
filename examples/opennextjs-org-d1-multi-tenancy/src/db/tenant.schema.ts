import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { users } from "./auth.schema";

// Tenant-specific Better Auth tables for tenant databases
// These tables contain tenant-scoped data like sessions, files, and organization data

export const userFiles = sqliteTable("user_files", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    r2Key: text("r2_key").notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
    category: text("category"),
    isPublic: integer("is_public", { mode: "boolean" }),
    description: text("description"),
});
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
export const birthdayWishs = sqliteTable("birthday_wishs", {
    id: text("id").primaryKey(),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    message: text("message").notNull(),
    isPublic: integer("is_public", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
