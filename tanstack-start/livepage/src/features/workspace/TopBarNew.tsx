import { useRouter } from "@tanstack/react-router";
import { TopBarActions } from "#/components/shell/top-bar";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button } from "#/components/ui";

// The black "New page" button in the top bar of Home, Templates and the like.
export function NewPageAction() {
	const router = useRouter();
	const { workspace } = useWorkspace();
	return (
		<TopBarActions>
			<Button
				variant="primary"
				onClick={() =>
					router.navigate({
						to: "/w/$workspaceId/new",
						params: { workspaceId: workspace.id },
					})
				}
			>
				New page
			</Button>
		</TopBarActions>
	);
}
