"use client";

import authClient from "@/auth/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    AlertCircle,
    Calendar,
    CheckCircle,
    Gift,
    Heart,
    RefreshCw,
    Users,
    Cake,
    Clock,
    Globe,
    Eye,
    EyeOff,
} from "lucide-react";
import { useEffect, useState } from "react";

interface BirthdayData {
    userId: string;
    birthday: Date;
    isPublic: boolean;
    timezone: string;
}

interface UpcomingBirthday {
    userId: string;
    birthday: Date;
    timezone: string;
}

interface BirthdayWish {
    wishId: string;
    fromUserId: string;
    toUserId: string;
    message: string;
    isPublic: boolean;
    createdAt: Date;
}

export function BirthdayExample() {
    // State management
    const [currentBirthday, setCurrentBirthday] = useState<BirthdayData | null>(null);
    const [upcomingBirthdays, setUpcomingBirthdays] = useState<UpcomingBirthday[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [operationResult, setOperationResult] = useState<{
        success?: boolean;
        error?: string;
        message?: string;
    } | null>(null);

    // Form states for setting birthday
    const [birthdayDate, setBirthdayDate] = useState("");
    const [timezone, setTimezone] = useState("America/New_York");
    const [isPublic, setIsPublic] = useState(false);
    const [isBirthdayDialogOpen, setIsBirthdayDialogOpen] = useState(false);

    // Form states for birthday wishes
    const [targetUserId, setTargetUserId] = useState("");
    const [wishMessage, setWishMessage] = useState("");
    const [isWishPublic, setIsWishPublic] = useState(true);
    const [isWishDialogOpen, setIsWishDialogOpen] = useState(false);

    const loadCurrentBirthday = async () => {
        setIsLoading(true);
        try {
            // Use no userId to get current user's birthday (defaults to session user)
            const result = await authClient.birthday.get({});
            if (result.data) {
                setCurrentBirthday({
                    userId: result.data.userId,
                    birthday: new Date(result.data.birthday),
                    isPublic: result.data.isPublic,
                    timezone: result.data.timezone,
                });
            }
        } catch (error) {
            console.error("Failed to load current birthday:", error);
            // Not an error if birthday doesn't exist yet
            setCurrentBirthday(null);
        } finally {
            setIsLoading(false);
            setIsInitialLoading(false);
        }
    };

    const loadUpcomingBirthdays = async () => {
        try {
            const result = await authClient.birthday.upcoming({});
            if (result.data) {
                setUpcomingBirthdays(
                    result.data.birthdays.map((b: any) => ({
                        userId: b.userId,
                        birthday: new Date(b.birthday),
                        timezone: b.timezone,
                    }))
                );
            }
        } catch (error) {
            console.error("Failed to load upcoming birthdays:", error);
            setUpcomingBirthdays([]);
        }
    };

    const handleSetBirthday = async () => {
        if (!birthdayDate) return;

        setIsLoading(true);
        setOperationResult(null);

        try {
            const result = await authClient.birthday.update({
                birthday: birthdayDate,
                isPublic,
                timezone,
            });

            if (result.error) {
                setOperationResult({ error: result.error.message || "Failed to set birthday" });
            } else {
                setOperationResult({ success: true, message: "Birthday saved successfully!" });
                setIsBirthdayDialogOpen(false);
                setBirthdayDate("");
                setTimezone("America/New_York");
                setIsPublic(false);
                loadCurrentBirthday();
                loadUpcomingBirthdays(); // Refresh upcoming list
            }
        } catch (error) {
            console.error("Failed to set birthday:", error);
            setOperationResult({ error: "Failed to set birthday" });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendBirthdayWish = async () => {
        if (!targetUserId.trim() || !wishMessage.trim()) return;

        setIsLoading(true);
        setOperationResult(null);

        try {
            const result = await authClient.birthday.wish({
                toUserId: targetUserId.trim(),
                message: wishMessage.trim(),
                isPublic: isWishPublic,
            });

            if (result.error) {
                setOperationResult({ error: result.error.message || "Failed to send birthday wish" });
            } else {
                setOperationResult({ success: true, message: "Birthday wish sent successfully!" });
                setIsWishDialogOpen(false);
                setTargetUserId("");
                setWishMessage("");
                setIsWishPublic(true);
            }
        } catch (error) {
            console.error("Failed to send birthday wish:", error);
            setOperationResult({ error: "Failed to send birthday wish" });
        } finally {
            setIsLoading(false);
        }
    };

    const formatBirthdayDate = (date: Date): string => {
        // Use UTC methods to avoid timezone conversion issues
        // The date is stored as a local date, so we want to display it as-is
        return new Date(date.getTime() + date.getTimezoneOffset() * 60000).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
        });
    };

    const getBirthdayThisYear = (birthday: Date): Date => {
        const now = new Date();
        // Use UTC methods to get the actual stored date values
        const utcDate = new Date(birthday.getTime() + birthday.getTimezoneOffset() * 60000);
        return new Date(now.getFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
    };

    const getDaysUntilBirthday = (birthday: Date): number => {
        const now = new Date();
        const birthdayThisYear = getBirthdayThisYear(birthday);

        if (birthdayThisYear < now) {
            // Birthday already passed this year, calculate for next year
            const birthdayNextYear = new Date(now.getFullYear() + 1, birthday.getMonth(), birthday.getDate());
            return Math.ceil((birthdayNextYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }

        return Math.ceil((birthdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    useEffect(() => {
        loadCurrentBirthday();
        loadUpcomingBirthdays();
    }, []);

    return (
        <div className="space-y-6">
            {/* Operation Result */}
            {operationResult && (
                <div
                    className={`p-3 rounded-lg ${
                        operationResult.error
                            ? "bg-red-50 border border-red-200"
                            : "bg-green-50 border border-green-200"
                    }`}
                >
                    {operationResult.error ? (
                        <div className="flex items-start space-x-2">
                            <AlertCircle className="text-red-500 h-5 w-5 mt-0.5" />
                            <p className="text-red-700 text-sm">{operationResult.error}</p>
                        </div>
                    ) : (
                        <div className="flex items-start space-x-2">
                            <CheckCircle className="text-green-500 h-5 w-5 mt-0.5" />
                            <p className="text-green-700 text-sm">{operationResult.message}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Current User's Birthday */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Cake className="h-5 w-5" />
                        My Birthday
                    </CardTitle>
                    <Dialog open={isBirthdayDialogOpen} onOpenChange={setIsBirthdayDialogOpen}>
                        <DialogTrigger asChild>
                            <Button
                                onClick={() => {
                                    if (currentBirthday) {
                                        // Pre-fill form with current values for updates
                                        const dateStr = currentBirthday.birthday.toISOString().split("T")[0];
                                        setBirthdayDate(dateStr);
                                        setTimezone(currentBirthday.timezone);
                                        setIsPublic(currentBirthday.isPublic);
                                    }
                                }}
                            >
                                <Calendar className="h-4 w-4 mr-2" />
                                {currentBirthday ? "Update Birthday" : "Set Birthday"}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{currentBirthday ? "Update" : "Set"} Your Birthday</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="birthday-date">Birthday Date</Label>
                                    <Input
                                        id="birthday-date"
                                        type="date"
                                        value={birthdayDate}
                                        onChange={e => setBirthdayDate(e.target.value)}
                                        className="focus-visible:border-input focus-visible:ring-0 focus-visible:ring-offset-0"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="timezone">Timezone</Label>
                                    <select
                                        id="timezone"
                                        value={timezone}
                                        onChange={e => setTimezone(e.target.value)}
                                        className="w-full p-2 border rounded-md"
                                    >
                                        <option value="America/New_York">Eastern Time (EST/EDT)</option>
                                        <option value="America/Chicago">Central Time (CST/CDT)</option>
                                        <option value="America/Denver">Mountain Time (MST/MDT)</option>
                                        <option value="America/Los_Angeles">Pacific Time (PST/PDT)</option>
                                        <option value="UTC">UTC</option>
                                        <option value="Europe/London">London (GMT/BST)</option>
                                        <option value="Europe/Paris">Paris (CET/CEST)</option>
                                        <option value="Asia/Tokyo">Tokyo (JST)</option>
                                        <option value="Asia/Shanghai">Shanghai (CST)</option>
                                    </select>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input
                                        id="isPublic"
                                        type="checkbox"
                                        checked={isPublic}
                                        onChange={e => setIsPublic(e.target.checked)}
                                    />
                                    <Label htmlFor="isPublic">Make birthday public</Label>
                                </div>
                                <Button
                                    onClick={handleSetBirthday}
                                    disabled={!birthdayDate || isLoading}
                                    className="w-full"
                                >
                                    {isLoading ? "Saving..." : currentBirthday ? "Update Birthday" : "Set Birthday"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    {isInitialLoading ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <div className="h-5 w-5 bg-gray-200 rounded animate-pulse" />
                                        <div className="h-6 w-40 bg-gray-200 rounded animate-pulse" />
                                        <div className="h-4 w-4 bg-gray-200 rounded animate-pulse" />
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <div className="h-4 w-4 bg-gray-200 rounded animate-pulse" />
                                        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                                        <div className="h-4 w-1 bg-gray-200 rounded animate-pulse" />
                                        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                                    </div>
                                </div>
                                <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
                            </div>
                        </div>
                    ) : currentBirthday ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Cake className="h-5 w-5 text-purple-600" />
                                        <h3 className="text-lg font-semibold">
                                            {formatBirthdayDate(currentBirthday.birthday)}
                                        </h3>
                                        {currentBirthday.isPublic ? (
                                            <Eye className="h-4 w-4 text-green-600" />
                                        ) : (
                                            <EyeOff className="h-4 w-4 text-gray-600" />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                                        <Globe className="h-4 w-4" />
                                        <span>{currentBirthday.timezone}</span>
                                        <span>•</span>
                                        <span>
                                            {getDaysUntilBirthday(currentBirthday.birthday)} days until next birthday
                                        </span>
                                    </div>
                                </div>
                                <Button onClick={loadCurrentBirthday} disabled={isLoading} variant="outline" size="sm">
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <Cake className="text-gray-400 h-16 w-16 mx-auto mb-4" />
                            <p className="text-gray-500 text-lg font-medium">No birthday set</p>
                            <p className="text-gray-400 text-sm mt-1">Set your birthday to join the celebration!</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Upcoming Birthdays */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        Upcoming Birthdays ({upcomingBirthdays.length})
                    </CardTitle>
                    <Button onClick={loadUpcomingBirthdays} disabled={isLoading} variant="outline" size="sm">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </CardHeader>
                <CardContent>
                    {upcomingBirthdays.length === 0 ? (
                        <div className="text-center py-8">
                            <Calendar className="text-gray-400 h-16 w-16 mx-auto mb-4" />
                            <p className="text-gray-500 text-lg font-medium">No upcoming birthdays</p>
                            <p className="text-gray-400 text-sm mt-1">
                                Check back later or encourage teammates to set their birthdays!
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {upcomingBirthdays.map((birthday, index) => (
                                <div
                                    key={`${birthday.userId}-${index}`}
                                    className="flex items-center justify-between p-3 border rounded-lg"
                                >
                                    <div className="flex items-center gap-3">
                                        <Cake className="h-5 w-5 text-purple-600" />
                                        <div>
                                            <p className="font-medium">User: {birthday.userId}</p>
                                            <p className="text-sm text-gray-500">
                                                {formatBirthdayDate(birthday.birthday)} •
                                                {getDaysUntilBirthday(birthday.birthday)} days away
                                            </p>
                                            <p className="text-sm text-gray-500">Timezone: {birthday.timezone}</p>
                                        </div>
                                    </div>
                                    <Button
                                        onClick={() => {
                                            setTargetUserId(birthday.userId);
                                            setIsWishDialogOpen(true);
                                        }}
                                        size="sm"
                                        variant="outline"
                                    >
                                        <Gift className="h-4 w-4 mr-2" />
                                        Send Wish
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Send Birthday Wish Dialog */}
            <Dialog open={isWishDialogOpen} onOpenChange={setIsWishDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Heart className="h-5 w-5 text-red-500" />
                            Send Birthday Wish
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="target-user">To User ID</Label>
                            <Input
                                id="target-user"
                                placeholder="Enter user ID"
                                value={targetUserId}
                                onChange={e => setTargetUserId(e.target.value)}
                                className="focus-visible:border-input focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                        </div>
                        <div>
                            <Label htmlFor="wish-message">Birthday Message</Label>
                            <Input
                                id="wish-message"
                                placeholder="Happy Birthday! 🎉"
                                value={wishMessage}
                                onChange={e => setWishMessage(e.target.value)}
                                className="focus-visible:border-input focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <input
                                id="isWishPublic"
                                type="checkbox"
                                checked={isWishPublic}
                                onChange={e => setIsWishPublic(e.target.checked)}
                            />
                            <Label htmlFor="isWishPublic">Make wish public</Label>
                        </div>
                        <Button
                            onClick={handleSendBirthdayWish}
                            disabled={!targetUserId.trim() || !wishMessage.trim() || isLoading}
                            className="w-full"
                        >
                            {isLoading ? "Sending..." : "Send Birthday Wish"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Quick Actions */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <RefreshCw className="h-5 w-5" />
                        Quick Actions
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Button onClick={loadCurrentBirthday} variant="outline" disabled={isLoading} className="w-full">
                            <Cake className="h-4 w-4 mr-2" />
                            Refresh My Birthday
                        </Button>

                        <Button
                            onClick={loadUpcomingBirthdays}
                            variant="outline"
                            disabled={isLoading}
                            className="w-full"
                        >
                            <Clock className="h-4 w-4 mr-2" />
                            Refresh Upcoming
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
