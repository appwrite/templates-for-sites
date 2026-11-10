// The row properties shown above a row's page body, for the editor's route.
import type { Page } from "#/lib/types";
import { RowProperties as Properties } from "./RowProperties";

export function RowProperties({ page }: { page: Page }) {
	if (!page.databaseId) return null;
	return <Properties databaseId={page.databaseId} rowId={page.id} />;
}
