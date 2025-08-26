import type { BetterAuthClientPlugin } from "better-auth/client";
import type { birthdayPlugin } from "./birthday";

export const birthdayClient = () => {
    return {
        id: "birthday",
        $InferServerPlugin: {} as ReturnType<typeof birthdayPlugin>,
        // The endpoints will be automatically inferred from the server plugin
        // Better Auth will convert kebab-case paths to camelCase:
        // "/birthday/set" -> setBirthday
        // "/birthday/get" -> getBirthday
        // "/birthday/upcoming" -> getUpcomingBirthdays
        // "/birthday/wish" -> sendBirthdayWish
    } satisfies BetterAuthClientPlugin;
};
