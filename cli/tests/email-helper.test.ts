import { describe, expect, test } from "bun:test";
import { createEmailOptions, createEmailSender } from "../../src/email";
import type { EmailAddress, EmailMessage, EmailSendResult, SendEmail } from "@cloudflare/workers-types";
import type { CloudflareEmailMessage } from "../../src/types";

type StructuredEmailMessage = {
    from: string | EmailAddress;
    to: string | string[];
    subject: string;
    replyTo?: string | EmailAddress;
    cc?: string | string[];
    bcc?: string | string[];
    headers?: Record<string, string>;
    text?: string;
    html?: string;
};

class RecordingEmailBinding implements SendEmail {
    readonly sent: StructuredEmailMessage[] = [];

    async send(message: EmailMessage): Promise<EmailSendResult>;
    async send(builder: StructuredEmailMessage): Promise<EmailSendResult>;
    async send(message: EmailMessage | StructuredEmailMessage): Promise<EmailSendResult> {
        if ("subject" in message) {
            this.sent.push(message);
        } else {
            this.sent.push({
                from: message.from,
                to: message.to,
                subject: "",
            });
        }

        return { messageId: `message-${this.sent.length}` };
    }
}

const user = {
    id: "user_1",
    email: "user@example.com",
    name: "User",
    image: null,
    emailVerified: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("createEmailSender", () => {
    test("sends structured email through the Cloudflare binding", async () => {
        const binding = new RecordingEmailBinding();
        const sendEmail = createEmailSender({
            binding,
            from: { email: "auth@example.com", name: "Auth" },
            replyTo: "support@example.com",
        });

        const result = await sendEmail({
            to: "user@example.com",
            subject: "Verify your email",
            text: "Open the verification link.",
            html: "<p>Open the verification link.</p>",
            headers: { "X-Auth-Flow": "verification" },
        });

        expect(result).toEqual({ messageId: "message-1" });
        expect(binding.sent).toEqual([
            {
                from: { email: "auth@example.com", name: "Auth" },
                to: "user@example.com",
                subject: "Verify your email",
                replyTo: "support@example.com",
                text: "Open the verification link.",
                html: "<p>Open the verification link.</p>",
                headers: { "X-Auth-Flow": "verification" },
            },
        ]);
    });

    test("requires text or html content", async () => {
        const binding = new RecordingEmailBinding();
        const sendEmail = createEmailSender({ binding, from: "auth@example.com" });

        await expect(
            sendEmail({
                to: "user@example.com",
                subject: "Missing body",
            })
        ).rejects.toThrow("Cloudflare Email requires at least one of `text` or `html` content.");
        expect(binding.sent).toEqual([]);
    });
});

describe("createEmailOptions", () => {
    test("adds default verification and reset callbacks when Email is configured", async () => {
        const binding = new RecordingEmailBinding();
        const options = createEmailOptions(
            {
                binding,
                from: "auth@example.com",
            },
            {}
        );

        await options.emailVerification?.sendVerificationEmail?.({
            user,
            url: "https://app.example.com/verify?token=abc&next=<home>",
            token: "abc",
        });
        await options.emailAndPassword?.sendResetPassword?.({
            user,
            url: "https://app.example.com/reset?token=def",
            token: "def",
        });

        expect(options.emailAndPassword?.enabled).toBe(true);
        expect(binding.sent).toHaveLength(2);
        expect(binding.sent[0]).toMatchObject({
            from: "auth@example.com",
            to: "user@example.com",
            subject: "Verify your email address",
        });
        expect(binding.sent[0]?.text).toContain("https://app.example.com/verify?token=abc&next=<home>");
        expect(binding.sent[0]?.html).toContain("next=&lt;home&gt;");
        expect(binding.sent[1]).toMatchObject({
            from: "auth@example.com",
            to: "user@example.com",
            subject: "Reset your password",
        });
    });

    test("preserves user callbacks and disabled email/password auth", async () => {
        const binding = new RecordingEmailBinding();
        const customMessage: CloudflareEmailMessage = {
            to: "owner@example.com",
            subject: "Custom",
            text: "Custom callback",
        };
        const options = createEmailOptions(
            {
                binding,
                from: "auth@example.com",
            },
            {
                emailVerification: {
                    sendVerificationEmail: async () => {
                        await createEmailSender({ binding, from: "custom@example.com" })(customMessage);
                    },
                },
                emailAndPassword: {
                    enabled: false,
                },
            }
        );

        await options.emailVerification?.sendVerificationEmail?.({
            user,
            url: "https://app.example.com/verify",
            token: "abc",
        });

        expect(options.emailAndPassword?.enabled).toBe(false);
        expect(binding.sent).toEqual([
            {
                from: "custom@example.com",
                to: "owner@example.com",
                subject: "Custom",
                text: "Custom callback",
            },
        ]);
    });
});
