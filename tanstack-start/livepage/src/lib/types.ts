// Shapes the browser sees. Server modules map Appwrite rows onto these.

export type Role = "owner" | "admin" | "member" | "guest";

export type Viewer = {
	userId: string;
	name: string;
	email: string;
	emailVerified: boolean;
	mfa: boolean;
};

export type Section = { id: string; name: string };

export type Workspace = {
	id: string;
	name: string;
	icon: string | null;
	sections: Section[];
	role: Role;
};

export type Share = { userId: string; level: "edit" | "comment" | "view" };

export type PageKind = "page" | "database" | "row";
export type Visibility = "workspace" | "private" | "restricted";

export type Page = {
	id: string;
	workspaceId: string;
	parentId: string | null;
	sectionId: string | null;
	kind: PageKind;
	title: string;
	icon: string | null;
	coverFileId: string | null;
	position: number;
	databaseId: string | null;
	visibility: Visibility;
	shares: Share[];
	publishedSlug: string | null;
	trashedAt: string | null;
	createdBy: string;
	updatedBy: string;
	createdAt: string;
	updatedAt: string;
};

export type Member = {
	membershipId: string;
	userId: string;
	name: string;
	email: string;
	role: Role;
	confirmed: boolean;
	joinedAt: string;
};

export type AppState =
	| { status: "setup" }
	| { status: "signed-out"; setupComplete: boolean }
	| { status: "mfa" }
	| {
			status: "ok";
			viewer: Viewer;
			workspaces: Workspace[];
			twoStepRequired?: boolean;
			schemaUpdate?: boolean;
	  };

export type PageDraft = {
	workspaceId: string;
	title?: string;
	kind?: PageKind;
	parentId?: string | null;
	sectionId?: string | null;
	position?: number;
	visibility?: Visibility;
	icon?: string | null;
	databaseId?: string | null;
};

export type PagePatch = Partial<
	Pick<
		Page,
		"title" | "icon" | "coverFileId" | "parentId" | "sectionId" | "position"
	>
>;
