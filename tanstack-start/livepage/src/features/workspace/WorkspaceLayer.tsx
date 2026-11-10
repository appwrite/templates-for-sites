// What the shell adds to a page's top bar: the favorite star and the Share button.
import { useEffect, useMemo, useRef, useState } from "react";
import { MoreIcon, StarIcon } from "#/components/icons";
import { TopBarActions } from "#/components/shell/top-bar";
import { useWorkspace } from "#/components/shell/workspace-context";
import {
	Button,
	Menu,
	type MenuItem,
	useMenu,
	usePhone,
} from "#/components/ui";
import { useExtras } from "./extras";
import { ShareDialog } from "./ShareDialog";

export function WorkspaceLayer() {
	const { pages, activePageId } = useWorkspace();
	const { favorites, toggleFavorite } = useExtras();
	const anchor = useRef<HTMLButtonElement>(null);
	const [sharing, setSharing] = useState(false);
	const page = useMemo(
		() => pages.find((p) => p.id === activePageId),
		[pages, activePageId],
	);
	const phone = usePhone();
	const moreMenu = useMenu();

	// The editor's page menu reaches these from a phone, where the top bar has no room for them.
	const toggle = page ? () => toggleFavorite(page.id) : null;
	useEffect(() => {
		if (!toggle) return;
		const onShare = () => setSharing((v) => !v);
		const onFavorite = () => toggle();
		window.addEventListener("livepage:share", onShare);
		window.addEventListener("livepage:favorite", onFavorite);
		return () => {
			window.removeEventListener("livepage:share", onShare);
			window.removeEventListener("livepage:favorite", onFavorite);
		};
	}, [toggle]);

	if (!page) return null;
	const favorite = favorites.includes(page.id);
	const moreItems: MenuItem[] = [
		{ id: "share", label: "Share", onSelect: () => setSharing((v) => !v) },
		{
			id: "favorite",
			label: favorite ? "Remove from favorites" : "Add to favorites",
			onSelect: () => toggleFavorite(page.id),
		},
	];
	return (
		<TopBarActions>
			<button
				type="button"
				aria-pressed={favorite}
				aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
				onClick={() => toggleFavorite(page.id)}
				className={`order-9 flex size-7 items-center justify-center rounded-md hover:bg-wash-2 max-md:hidden ${favorite ? "text-amber" : "text-pencil hover:text-ink"}`}
			>
				<StarIcon size={15} fill={favorite ? "currentColor" : "none"} />
			</button>
			<Button
				ref={anchor}
				variant="primary"
				className="order-10 max-md:hidden"
				onClick={() => setSharing((v) => !v)}
			>
				Share
			</Button>
			{phone && page.kind === "database" && (
				<>
					<button
						ref={moreMenu.anchor}
						type="button"
						aria-label="More page options"
						onClick={moreMenu.toggle}
						className="order-8 flex size-10 items-center justify-center rounded-md text-graphite hover:bg-wash-2"
					>
						<MoreIcon size={15} />
					</button>
					<Menu
						anchor={moreMenu.anchor}
						open={moreMenu.open}
						onClose={moreMenu.close}
						items={moreItems}
					/>
				</>
			)}
			{sharing && (
				<ShareDialog
					key={page.id}
					pageId={page.id}
					anchor={anchor}
					onClose={() => setSharing(false)}
				/>
			)}
		</TopBarActions>
	);
}
