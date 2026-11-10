// The theme choice: light, dark, or following the system. The inline script in __root applies it
// before first paint.
export type Theme = "light" | "dark" | "system";

const KEY = "livepage-theme";

export function readTheme(): Theme {
	try {
		const saved = localStorage.getItem(KEY);
		return saved === "light" || saved === "dark" ? saved : "system";
	} catch {
		return "system";
	}
}

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === "system") delete root.dataset.theme;
	else root.dataset.theme = theme;
	try {
		if (theme === "system") localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, theme);
	} catch {
		// A blocked store only means the choice lasts for this tab.
	}
}

export function isDark() {
	const root = document.documentElement;
	return (
		root.dataset.theme === "dark" ||
		(root.dataset.theme !== "light" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches)
	);
}
