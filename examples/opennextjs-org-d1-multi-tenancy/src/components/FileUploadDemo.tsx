"use client";

import authClient from "@/auth/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, FolderOpen, Upload } from "lucide-react";
import { useEffect, useState } from "react";

export default function FileUploadDemo() {
    const [file, setFile] = useState<File | null>(null);
    const [category, setCategory] = useState("");
    const [isPublic, setIsPublic] = useState(false);
    const [description, setDescription] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [fileOperationResult, setFileOperationResult] = useState<{
        success?: boolean;
        error?: string;
        data?: any;
    } | null>(null);
    const [userFiles, setUserFiles] = useState<any[]>([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);

    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setFileOperationResult(null);

        try {
            // To do: Improve type-safety of metadata using client action
            const result = await authClient.uploadFile(file, {
                isPublic,
                ...(category.trim() && { category: category.trim() }),
                ...(description.trim() && { description: description.trim() }),
            });

            if (result.error) {
                setFileOperationResult({ error: result.error.message || "Failed to upload file. Please try again." });
            } else {
                setFileOperationResult({ success: true, data: result.data });
                // Clear form
                setFile(null);
                setCategory("");
                setIsPublic(false);
                setDescription("");
                // Refresh file list
                loadUserFiles();
            }
        } catch (error) {
            console.error("Upload failed:", error);
            setFileOperationResult({
                error:
                    error instanceof Error && error.message
                        ? `Upload failed: ${error.message}`
                        : "Failed to upload file. Please check your connection and try again.",
            });
        } finally {
            setIsUploading(false);
        }
    };

    const loadUserFiles = async () => {
        setIsLoadingFiles(true);
        try {
            // Use the inferred list endpoint with pagination support
            const result = await authClient.files.list();

            if (result.data) {
                // Types should now be properly inferred from the endpoint
                setUserFiles(result.data.files || []);
            } else {
                setUserFiles([]);
            }
        } catch (error) {
            console.error("Failed to load files:", error);
            setUserFiles([]);
        } finally {
            setIsLoadingFiles(false);
        }
    };

    const downloadFile = async (fileId: string, filename: string) => {
        try {
            const result = await authClient.files.download({ fileId });

            if (result.error) {
                console.error("Download failed:", result.error);
                setFileOperationResult({ error: "Failed to download file. Please try again." });
                return;
            }

            // Extract blob from Better Auth response structure
            const response = result.data;
            const blob = response instanceof Response ? await response.blob() : response;

            if (blob instanceof Blob && blob.size === 0) {
                console.warn("Warning: Downloaded file appears to be empty");
            }

            // Create and trigger download
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();

            // Cleanup
            setTimeout(() => {
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }, 100);
        } catch (error) {
            console.error("Failed to download file:", error);
            setFileOperationResult({ error: "Failed to download file. Please try again." });
        }
    };

    const deleteFile = async (fileId: string) => {
        try {
            // Use the inferred delete endpoint
            const result = await authClient.files.delete({ fileId });
            if (!result.error) {
                loadUserFiles(); // Auto-refresh list
            } else {
                console.error("Delete failed:", result.error);
                setFileOperationResult({ error: "Failed to delete file. Please try again." });
            }
        } catch (error) {
            console.error("Failed to delete file:", error);
            setFileOperationResult({ error: "Failed to delete file. Please try again." });
        }
    };

    // Helper function for better file size formatting
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    };

    // Helper function for relative time formatting
    const formatRelativeTime = (date: Date | string): string => {
        const now = new Date();
        const uploadDate = new Date(date);
        const diffInSeconds = Math.floor((now.getTime() - uploadDate.getTime()) / 1000);

        if (diffInSeconds < 60) return "Just now";
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;

        return uploadDate.toLocaleDateString();
    };

    // Auto-load files when component mounts
    useEffect(() => {
        loadUserFiles();
    }, []);

    return (
        <div className="space-y-6">
            {/* Upload Form */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Upload className="h-5 w-5" />
                        File Upload
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="file" className="mb-2 block">
                            Select File
                        </Label>
                        <Input
                            id="file"
                            type="file"
                            accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx"
                            onChange={e => setFile(e.target.files?.[0] || null)}
                        />
                        {file && (
                            <p className="text-sm text-gray-500 mt-1">
                                Selected: {file.name} ({formatFileSize(file.size)})
                            </p>
                        )}
                    </div>

                    <div>
                        <Label htmlFor="category" className="mb-2 block">
                            Category (optional)
                        </Label>
                        <Input
                            id="category"
                            type="text"
                            placeholder="e.g., documents, images"
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="description" className="mb-2 block">
                            Description (optional)
                        </Label>
                        <Input
                            id="description"
                            type="text"
                            placeholder="File description"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center space-x-2">
                        <input
                            id="isPublic"
                            type="checkbox"
                            checked={isPublic}
                            onChange={e => setIsPublic(e.target.checked)}
                        />
                        <Label htmlFor="isPublic">Make file public</Label>
                    </div>

                    <div className="flex justify-center">
                        <Button onClick={handleUpload} disabled={!file || isUploading} className="w-full max-w-xs">
                            {isUploading ? "Uploading..." : "Upload File"}
                        </Button>
                    </div>

                    {fileOperationResult && (
                        <div
                            className={`p-3 rounded-lg ${fileOperationResult.error ? "bg-red-50 border border-red-200" : "bg-green-50 border border-green-200"}`}
                        >
                            {fileOperationResult.error ? (
                                <div className="flex items-start space-x-2">
                                    <span className="text-red-500 mt-0.5">❌</span>
                                    <p className="text-red-700 text-sm">{fileOperationResult.error}</p>
                                </div>
                            ) : (
                                <div className="flex items-start space-x-2">
                                    <CheckCircle className="text-green-500 h-5 w-5 mt-0.5" />
                                    <div>
                                        <p className="text-green-700 font-medium text-sm">
                                            File uploaded successfully!
                                        </p>
                                        <p className="text-green-600 text-xs mt-1">
                                            Your file has been stored securely and is now available in your file list.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* File List */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Your Files</CardTitle>
                    <Button onClick={loadUserFiles} disabled={isLoadingFiles} variant="outline" size="sm">
                        {isLoadingFiles ? "Loading..." : "Refresh"}
                    </Button>
                </CardHeader>
                <CardContent>
                    {userFiles.length === 0 ? (
                        <div className="text-center py-8">
                            <div className="flex justify-center mb-4">
                                <FolderOpen className="text-gray-400 h-16 w-16" />
                            </div>
                            <p className="text-gray-500 text-lg font-medium">No files uploaded yet</p>
                            <p className="text-gray-400 text-sm mt-1">Upload your first file using the form above</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {userFiles.map(file => (
                                <div key={file.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex-1">
                                        <p className="font-medium text-gray-900">{file.originalName}</p>
                                        <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-gray-500">
                                            {file.category && (
                                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                                                    {file.category}
                                                </span>
                                            )}
                                            <span>{formatFileSize(file.size)}</span>
                                            <span>•</span>
                                            <span>{formatRelativeTime(file.uploadedAt)}</span>
                                            {file.isPublic && (
                                                <>
                                                    <span>•</span>
                                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">
                                                        Public
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                        {file.description && (
                                            <p className="text-sm text-gray-600 mt-1">{file.description}</p>
                                        )}
                                    </div>
                                    <div className="flex gap-2 ml-4">
                                        <Button
                                            onClick={() => downloadFile(file.id, file.originalName)}
                                            variant="outline"
                                            size="sm"
                                        >
                                            Download
                                        </Button>
                                        <Button onClick={() => deleteFile(file.id)} variant="destructive" size="sm">
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
