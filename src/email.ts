import { type BetterAuthOptions } from "better-auth";
import type { EmailSendResult } from "@cloudflare/workers-types";
import type {
    CloudflareEmailConfig,
    CloudflareEmailContent,
    CloudflareEmailMessage,
    CloudflareEmailSender,
    CloudflareEmailTemplateContext,
} from "./types";
export const createEmailSender = (config: CloudflareEmailConfig): CloudflareEmailSender => {
    return async (message: CloudflareEmailMessage): Promise<EmailSendResult> => {
        if (!message.text && !message.html) {
            throw new Error("Cloudflare Email requires at least one of `text` or `html` content.");
        }

        return config.binding.send({
            from: message.from ?? config.from,
            to: message.to,
            subject: message.subject,
            ...((message.replyTo ?? config.replyTo) ? { replyTo: message.replyTo ?? config.replyTo } : {}),
            ...(message.text ? { text: message.text } : {}),
            ...(message.html ? { html: message.html } : {}),
            ...(message.cc ? { cc: message.cc } : {}),
            ...(message.bcc ? { bcc: message.bcc } : {}),
            ...(message.headers ? { headers: message.headers } : {}),
        });
    };
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function defaultVerificationTemplate({ url }: CloudflareEmailTemplateContext): CloudflareEmailContent {
    const escapedUrl = escapeHtml(url);
    return {
        subject: "Verify your email address",
        text: `Verify your email address by opening this link: ${url}`,
        html: `<p>Verify your email address by opening this link:</p><p><a href="${escapedUrl}">${escapedUrl}</a></p>`,
    };
}

function defaultPasswordResetTemplate({ url }: CloudflareEmailTemplateContext): CloudflareEmailContent {
    const escapedUrl = escapeHtml(url);
    return {
        subject: "Reset your password",
        text: `Reset your password by opening this link: ${url}`,
        html: `<p>Reset your password by opening this link:</p><p><a href="${escapedUrl}">${escapedUrl}</a></p>`,
    };
}

type EmailVerificationOptions = NonNullable<BetterAuthOptions["emailVerification"]>;
type EmailAndPasswordOptions = NonNullable<BetterAuthOptions["emailAndPassword"]>;

export function createEmailOptions<T extends BetterAuthOptions>(
    email: CloudflareEmailConfig | undefined,
    options: T
): Pick<BetterAuthOptions, "emailVerification" | "emailAndPassword"> {
    if (!email) {
        return {
            emailVerification: options.emailVerification,
            emailAndPassword: options.emailAndPassword,
        };
    }

    const sender = createEmailSender(email);
    const emailVerification: EmailVerificationOptions = { ...(options.emailVerification ?? {}) };
    const emailAndPassword: EmailAndPasswordOptions | undefined = options.emailAndPassword
        ? { ...options.emailAndPassword }
        : undefined;

    if (email.sendVerificationEmail !== false && !emailVerification.sendVerificationEmail) {
        emailVerification.sendVerificationEmail = async ({ user, url, token }, request) => {
            const content = await (email.templates?.verification ?? defaultVerificationTemplate)({
                user,
                url,
                token,
                request,
            });
            await sender({
                to: user.email,
                ...content,
            });
        };
    }

    if (emailAndPassword && email.sendResetPassword !== false && !emailAndPassword.sendResetPassword) {
        emailAndPassword.sendResetPassword = async ({ user, url, token }, request) => {
            const content = await (email.templates?.passwordReset ?? defaultPasswordResetTemplate)({
                user,
                url,
                token,
                request,
            });
            await sender({
                to: user.email,
                ...content,
            });
        };
    }

    return {
        emailVerification,
        emailAndPassword,
    };
}
