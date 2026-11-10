// Which links may be clicked. Stored text decides what gets rendered, so a javascript: or data: link
// typed in the editor, pasted into a URL cell, or written by an agent can never become a real link.

const ALLOWED = new Set(["http:", "https:", "mailto:"]);

// The href to render, or null to show plain text. A bare domain gets https:// so it still works.
export function safeHref(raw: string | null | undefined): string | null {
	const value = String(raw ?? "").trim();
	if (!value || value.startsWith("#") || value.startsWith("/"))
		return value.startsWith("//") ? null : value || null;
	try {
		const url = new URL(value);
		return ALLOWED.has(url.protocol) ? value : null;
	} catch {
		if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
		return `https://${value}`;
	}
}
