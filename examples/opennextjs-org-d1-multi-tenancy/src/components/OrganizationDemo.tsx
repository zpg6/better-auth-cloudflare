"use client";

import authClient from "@/auth/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Invitation, Member, Organization } from "better-auth/plugins";
import {
    AlertCircle,
    Building,
    CheckCircle,
    Crown,
    Lock,
    Mail,
    Play,
    Plus,
    RefreshCw,
    Settings,
    Shield,
    Trash2,
    User,
    Users,
} from "lucide-react";
import { useEffect, useState } from "react";

// Extended Member type with user information for display
type MemberWithUser = Member & {
    user?: {
        id?: string;
        name?: string;
        email?: string;
        image?: string;
    };
};

export default function OrganizationDemo() {
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null);
    const [members, setMembers] = useState<MemberWithUser[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [userInvitations, setUserInvitations] = useState<Invitation[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [operationResult, setOperationResult] = useState<{
        success?: boolean;
        error?: string;
        message?: string;
    } | null>(null);

    // Form states
    const [newOrgName, setNewOrgName] = useState("");
    const [newOrgSlug, setNewOrgSlug] = useState("");
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState("member");
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
    const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
        isOpen: boolean;
        organizationId: string;
        organizationName: string;
    }>({ isOpen: false, organizationId: "", organizationName: "" });

    const loadOrganizations = async () => {
        setIsLoading(true);
        try {
            const result = await authClient.organization.list();
            if (result.data) {
                setOrganizations(result.data);
            }
        } catch (error) {
            console.error("Failed to load organizations:", error);
            setOperationResult({ error: "Failed to load organizations" });
        } finally {
            setIsLoading(false);
        }
    };

    const loadActiveOrganization = async () => {
        try {
            const result = await authClient.organization.getFullOrganization();
            if (result.data) {
                setActiveOrganization(result.data);
                setMembers(result.data.members || []);
            }
        } catch (error) {
            console.error("Failed to load active organization:", error);
        }
    };

    const loadInvitations = async () => {
        try {
            const result = await authClient.organization.listInvitations();
            if (result.data) {
                setInvitations(result.data);
            }
        } catch (error) {
            console.error("Failed to load invitations:", error);
        }
    };

    const loadUserInvitations = async () => {
        try {
            // Use listInvitations for now as listUserInvitations might not be available
            const result = await authClient.organization.listInvitations();
            if (result.data) {
                setUserInvitations(result.data);
            }
        } catch (error) {
            console.error("Failed to load user invitations:", error);
        }
    };

    const createOrganization = async () => {
        if (!newOrgName.trim() || !newOrgSlug.trim()) return;

        setIsLoading(true);
        setOperationResult(null);

        try {
            const result = await authClient.organization.create({
                name: newOrgName.trim(),
                slug: newOrgSlug.trim(),
            });

            if (result.error) {
                setOperationResult({ error: result.error.message || "Failed to create organization" });
            } else {
                setOperationResult({ success: true, message: "Organization created successfully!" });
                setNewOrgName("");
                setNewOrgSlug("");
                setIsCreateDialogOpen(false);
                loadOrganizations();
                loadActiveOrganization();
            }
        } catch (error) {
            console.error("Failed to create organization:", error);
            setOperationResult({ error: "Failed to create organization" });
        } finally {
            setIsLoading(false);
        }
    };

    const setActiveOrg = async (organizationId: string) => {
        setIsLoading(true);
        try {
            const result = await authClient.organization.setActive({ organizationId });
            if (!result.error) {
                setOperationResult({ success: true, message: "Active organization updated!" });
                loadActiveOrganization();
            } else {
                setOperationResult({ error: "Failed to set active organization" });
            }
        } catch (error) {
            console.error("Failed to set active organization:", error);
            setOperationResult({ error: "Failed to set active organization" });
        } finally {
            setIsLoading(false);
        }
    };

    const inviteMember = async () => {
        if (!inviteEmail.trim()) return;

        setIsLoading(true);
        setOperationResult(null);

        try {
            const result = await authClient.organization.inviteMember({
                email: inviteEmail.trim(),
                role: inviteRole as "member" | "admin" | "owner",
            });

            if (result.error) {
                setOperationResult({ error: result.error.message || "Failed to send invitation" });
            } else {
                setOperationResult({ success: true, message: "Invitation sent successfully!" });
                setInviteEmail("");
                setInviteRole("member");
                setIsInviteDialogOpen(false);
                loadInvitations();
            }
        } catch (error) {
            console.error("Failed to invite member:", error);
            setOperationResult({ error: "Failed to send invitation" });
        } finally {
            setIsLoading(false);
        }
    };

    const acceptInvitation = async (invitationId: string) => {
        setIsLoading(true);
        try {
            const result = await authClient.organization.acceptInvitation({ invitationId });
            if (!result.error) {
                setOperationResult({ success: true, message: "Invitation accepted!" });
                loadUserInvitations();
                loadOrganizations();
                loadActiveOrganization();
            } else {
                setOperationResult({ error: "Failed to accept invitation" });
            }
        } catch (error) {
            console.error("Failed to accept invitation:", error);
            setOperationResult({ error: "Failed to accept invitation" });
        } finally {
            setIsLoading(false);
        }
    };

    const rejectInvitation = async (invitationId: string) => {
        setIsLoading(true);
        try {
            const result = await authClient.organization.rejectInvitation({ invitationId });
            if (!result.error) {
                setOperationResult({ success: true, message: "Invitation rejected" });
                loadUserInvitations();
            } else {
                setOperationResult({ error: "Failed to reject invitation" });
            }
        } catch (error) {
            console.error("Failed to reject invitation:", error);
            setOperationResult({ error: "Failed to reject invitation" });
        } finally {
            setIsLoading(false);
        }
    };

    const removeMember = async (memberId: string) => {
        setIsLoading(true);
        try {
            const member = members.find(m => m.id === memberId);
            if (!member) return;

            // Use the member ID directly instead of email
            const result = await authClient.organization.removeMember({
                memberIdOrEmail: memberId,
            });

            if (!result.error) {
                setOperationResult({ success: true, message: "Member removed successfully" });
                loadActiveOrganization();
            } else {
                setOperationResult({ error: "Failed to remove member" });
            }
        } catch (error) {
            console.error("Failed to remove member:", error);
            setOperationResult({ error: "Failed to remove member" });
        } finally {
            setIsLoading(false);
        }
    };

    const deleteOrganization = async (organizationId: string) => {
        setIsLoading(true);
        setOperationResult(null);

        try {
            const result = await authClient.organization.delete({
                organizationId,
            });

            if (result.error) {
                setOperationResult({ error: result.error.message || "Failed to delete organization" });
            } else {
                setOperationResult({ success: true, message: "Organization deleted successfully!" });
                setDeleteConfirmDialog({ isOpen: false, organizationId: "", organizationName: "" });

                // Refresh data after deletion
                loadOrganizations();
                loadActiveOrganization();
            }
        } catch (error) {
            console.error("Failed to delete organization:", error);
            setOperationResult({ error: "Failed to delete organization" });
        } finally {
            setIsLoading(false);
        }
    };

    const openDeleteConfirmation = (organizationId: string, organizationName: string) => {
        setDeleteConfirmDialog({
            isOpen: true,
            organizationId,
            organizationName,
        });
    };

    const closeDeleteConfirmation = () => {
        setDeleteConfirmDialog({ isOpen: false, organizationId: "", organizationName: "" });
    };

    const getRoleIcon = (role: string) => {
        switch (role.toLowerCase()) {
            case "owner":
                return <Crown className="h-4 w-4 text-yellow-600" />;
            case "admin":
                return <Lock className="h-4 w-4 text-blue-600" />;
            default:
                return <User className="h-4 w-4 text-gray-600" />;
        }
    };

    const formatRelativeTime = (date: string): string => {
        const now = new Date();
        const targetDate = new Date(date);
        const diffInSeconds = Math.floor((now.getTime() - targetDate.getTime()) / 1000);

        if (diffInSeconds < 60) return "Just now";
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;

        return targetDate.toLocaleDateString();
    };

    useEffect(() => {
        loadOrganizations();
        loadActiveOrganization();
        loadInvitations();
        loadUserInvitations();
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

            {/* Active Organization */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Building className="h-5 w-5" />
                        Active Organization
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {activeOrganization ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold">{activeOrganization.name}</h3>
                                    <p className="text-sm text-gray-500">Slug: {activeOrganization.slug}</p>
                                    <p className="text-sm text-gray-500">
                                        Created: {formatRelativeTime(activeOrganization.createdAt.toString())}
                                    </p>
                                </div>
                                <Button
                                    onClick={loadActiveOrganization}
                                    disabled={isLoading}
                                    variant="outline"
                                    size="sm"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* Members */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-medium flex items-center gap-2">
                                        <Users className="h-4 w-4" />
                                        Members ({members.length})
                                    </h4>
                                    <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
                                        <DialogTrigger asChild>
                                            <Button size="sm">
                                                <Mail className="h-4 w-4 mr-2" />
                                                Invite Member
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <DialogHeader>
                                                <DialogTitle>Invite New Member</DialogTitle>
                                            </DialogHeader>
                                            <div className="space-y-4">
                                                <div>
                                                    <Label htmlFor="invite-email">Email Address</Label>
                                                    <Input
                                                        id="invite-email"
                                                        type="email"
                                                        placeholder="user@example.com"
                                                        value={inviteEmail}
                                                        onChange={e => setInviteEmail(e.target.value)}
                                                    />
                                                </div>
                                                <div>
                                                    <Label htmlFor="invite-role">Role</Label>
                                                    <select
                                                        id="invite-role"
                                                        value={inviteRole}
                                                        onChange={e => setInviteRole(e.target.value)}
                                                        className="w-full p-2 border rounded-md"
                                                    >
                                                        <option value="member">Member</option>
                                                        <option value="admin">Admin</option>
                                                    </select>
                                                </div>
                                                <Button
                                                    onClick={inviteMember}
                                                    disabled={!inviteEmail.trim() || isLoading}
                                                    className="w-full"
                                                >
                                                    {isLoading ? "Sending..." : "Send Invitation"}
                                                </Button>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                </div>

                                <div className="space-y-2">
                                    {members.map(member => (
                                        <div
                                            key={member.id}
                                            className="flex items-center justify-between p-3 border rounded-lg"
                                        >
                                            <div className="flex items-center gap-3">
                                                {getRoleIcon(member.role)}
                                                <div>
                                                    <p className="font-medium">
                                                        {member.user?.name ||
                                                            member.user?.email ||
                                                            `User ${member.userId}`}
                                                    </p>
                                                    <p className="text-sm text-gray-500">
                                                        {member.role} • Joined{" "}
                                                        {formatRelativeTime(member.createdAt.toString())}
                                                    </p>
                                                </div>
                                            </div>
                                            {member.role !== "owner" && (
                                                <Button
                                                    onClick={() => removeMember(member.id)}
                                                    variant="destructive"
                                                    size="sm"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Pending Invitations */}
                            {invitations.length > 0 && (
                                <div>
                                    <h4 className="font-medium mb-3">Pending Invitations ({invitations.length})</h4>
                                    <div className="space-y-2">
                                        {invitations.map(invitation => (
                                            <div
                                                key={invitation.id}
                                                className="flex items-center justify-between p-3 border rounded-lg bg-yellow-50"
                                            >
                                                <div>
                                                    <p className="font-medium">{invitation.email}</p>
                                                    <p className="text-sm text-gray-500">
                                                        Role: {invitation.role} • Expires:{" "}
                                                        {formatRelativeTime(invitation.expiresAt.toString())}
                                                    </p>
                                                </div>
                                                <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs">
                                                    Pending
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-gray-500">No active organization. Create or join one to get started.</p>
                    )}
                </CardContent>
            </Card>

            {/* Organizations List */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Your Organizations</CardTitle>
                    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Organization
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create New Organization</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="org-name">Organization Name</Label>
                                    <Input
                                        id="org-name"
                                        placeholder="My Organization"
                                        value={newOrgName}
                                        onChange={e => setNewOrgName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="org-slug">Slug</Label>
                                    <Input
                                        id="org-slug"
                                        placeholder="my-organization"
                                        value={newOrgSlug}
                                        onChange={e => setNewOrgSlug(e.target.value)}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Used in URLs. Must be unique and contain only letters, numbers, and hyphens.
                                    </p>
                                </div>
                                <Button
                                    onClick={createOrganization}
                                    disabled={!newOrgName.trim() || !newOrgSlug.trim() || isLoading}
                                    className="w-full"
                                >
                                    {isLoading ? "Creating..." : "Create Organization"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    {organizations.length === 0 ? (
                        <div className="text-center py-8">
                            <Building className="text-gray-400 h-16 w-16 mx-auto mb-4" />
                            <p className="text-gray-500 text-lg font-medium">No organizations yet</p>
                            <p className="text-gray-400 text-sm mt-1">Create your first organization to get started</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {organizations.map(org => (
                                <div key={org.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div>
                                        <p className="font-medium">{org.name}</p>
                                        <p className="text-sm text-gray-500">
                                            {org.slug} • Created {formatRelativeTime(org.createdAt.toString())}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {activeOrganization?.id !== org.id && (
                                            <Button onClick={() => setActiveOrg(org.id)} variant="outline" size="sm">
                                                <Play className="h-4 w-4 mr-2" />
                                                Set Active
                                            </Button>
                                        )}
                                        {activeOrganization?.id === org.id && (
                                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                                                Active
                                            </span>
                                        )}
                                        <Button
                                            onClick={() => openDeleteConfirmation(org.id, org.name)}
                                            variant="destructive"
                                            size="sm"
                                            disabled={isLoading}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* User Invitations */}
            {userInvitations.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Mail className="h-5 w-5" />
                            Pending Invitations
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {userInvitations.map(invitation => (
                                <div
                                    key={invitation.id}
                                    className="flex items-center justify-between p-3 border rounded-lg bg-blue-50"
                                >
                                    <div>
                                        <p className="font-medium">Organization ID: {invitation.organizationId}</p>
                                        <p className="text-sm text-gray-500">
                                            Role: {invitation.role} • Invitation ID: {invitation.inviterId}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            Expires: {formatRelativeTime(invitation.expiresAt.toString())}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={() => acceptInvitation(invitation.id)}
                                            size="sm"
                                            disabled={isLoading}
                                        >
                                            Accept
                                        </Button>
                                        <Button
                                            onClick={() => rejectInvitation(invitation.id)}
                                            variant="outline"
                                            size="sm"
                                            disabled={isLoading}
                                        >
                                            Reject
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteConfirmDialog.isOpen} onOpenChange={closeDeleteConfirmation}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-600">
                            <AlertCircle className="h-5 w-5" />
                            Delete Organization
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                            <p className="text-red-800 font-medium">
                                Are you sure you want to delete "{deleteConfirmDialog.organizationName}"?
                            </p>
                            <p className="text-red-700 text-sm mt-2">
                                This action cannot be undone. All members, invitations, and organization data will be
                                permanently removed.
                            </p>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <Button onClick={closeDeleteConfirmation} variant="outline" disabled={isLoading}>
                                Cancel
                            </Button>
                            <Button
                                onClick={() => deleteOrganization(deleteConfirmDialog.organizationId)}
                                variant="destructive"
                                disabled={isLoading}
                            >
                                {isLoading ? "Deleting..." : "Delete Organization"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
