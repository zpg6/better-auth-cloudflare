"use client";

import authClient from "../auth/authClient";

export function BirthdayExample() {
    const handleSetBirthday = async () => {
        try {
            // The endpoints are automatically inferred and typed!
            const result = await authClient.birthday.update({
                birthday: new Date("1990-01-15"),
                isPublic: true,
                timezone: "America/New_York",
            });

            console.log("Birthday set:", result);
        } catch (error) {
            console.error("Failed to set birthday:", error);
        }
    };

    const handleGetBirthday = async () => {
        try {
            const birthday = await authClient.birthday.read({
                userId: "user-123",
            });
            console.log("Current birthday:", birthday);
        } catch (error) {
            console.error("Failed to get birthday:", error);
        }
    };

    const handleGetUpcomingBirthdays = async () => {
        try {
            const upcoming = await authClient.birthday.upcoming();
            console.log("Upcoming birthdays:", upcoming);
        } catch (error) {
            console.error("Failed to get upcoming birthdays:", error);
        }
    };

    const handleSendBirthdayWish = async () => {
        try {
            const result = await authClient.birthday.wish({
                toUserId: "user-123",
                message: "Happy Birthday! 🎉",
                isPublic: true,
            });

            console.log("Birthday wish sent:", result);
        } catch (error) {
            console.error("Failed to send birthday wish:", error);
        }
    };

    return (
        <div className="p-6 space-y-4">
            <h2 className="text-2xl font-bold">Birthday Plugin Example</h2>

            <div className="space-y-2">
                <button
                    onClick={handleSetBirthday}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                    Set My Birthday
                </button>

                <button
                    onClick={handleGetBirthday}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                    Get My Birthday
                </button>

                <button
                    onClick={handleGetUpcomingBirthdays}
                    className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                >
                    Get Upcoming Birthdays
                </button>

                <button
                    onClick={handleSendBirthdayWish}
                    className="px-4 py-2 bg-pink-500 text-white rounded hover:bg-pink-600"
                >
                    Send Birthday Wish
                </button>
            </div>

            <div className="mt-6 p-4 bg-gray-100 rounded">
                <h3 className="font-semibold mb-2">Available Endpoints:</h3>
                <ul className="text-sm space-y-1">
                    <li>
                        <code>POST /api/auth/birthday/set</code> - Set user birthday
                    </li>
                    <li>
                        <code>GET /api/auth/birthday/get</code> - Get user birthday
                    </li>
                    <li>
                        <code>GET /api/auth/birthday/upcoming</code> - Get upcoming birthdays
                    </li>
                    <li>
                        <code>POST /api/auth/birthday/wish</code> - Send birthday wish
                    </li>
                </ul>
            </div>
        </div>
    );
}
