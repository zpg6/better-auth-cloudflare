import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
        .$defaultFn(() => false)
        .notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp" })
        .$defaultFn(() => /* @__PURE__ */ new Date())
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
        .$defaultFn(() => /* @__PURE__ */ new Date())
        .notNull(),
    isAnonymous: integer("is_anonymous", { mode: "boolean" }),
});

export const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    timezone: text("timezone"),
    city: text("city"),
    country: text("country"),
    region: text("region"),
    regionCode: text("region_code"),
    colo: text("colo"),
    latitude: text("latitude"),
    longitude: text("longitude"),
    activeOrganizationId: text("active_organization_id"),
});

export const accounts = sqliteTable("accounts", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
        mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
        mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verifications = sqliteTable("verifications", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => /* @__PURE__ */ new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => /* @__PURE__ */ new Date()),
});

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

export const tenants = sqliteTable("tenants", {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    tenantType: text("tenant_type").notNull(),
    databaseName: text("database_name").notNull(),
    databaseId: text("database_id").notNull(),
    status: text("status").default("creating").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
        .$defaultFn(() => new Date())
        .notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
});

export const organizations = sqliteTable("organizations", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").unique(),
    logo: text("logo"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    metadata: text("metadata"),
});

export const members = sqliteTable("members", {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const invitations = sqliteTable("invitations", {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    inviterId: text("inviter_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
});

export const userBirthdays = sqliteTable("user_birthdays", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    birthday: integer("birthday", { mode: "timestamp" }).notNull(),
    isPublic: integer("is_public", { mode: "boolean" }),
    timezone: text("timezone"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const birthdayReminders = sqliteTable("birthday_reminders", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
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
    message: text("message").notNull(),
    isPublic: integer("is_public", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
