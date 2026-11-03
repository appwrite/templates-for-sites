// "totp" is the 6-digit code from an authenticator app, "recovery" one of the single-use codes
// Appwrite hands out (10 hex characters).
export type CodeKind = "totp" | "recovery";

// What someone typed, as Appwrite expects it: spaces and dashes dropped, recovery codes lowercase.
export function readCode(input: string, kind: CodeKind): string | null {
	const code = input.replace(/[\s-]/g, "").toLowerCase();
	if (kind === "totp") return /^\d{6}$/.test(code) ? code : null;
	return /^[0-9a-f]{10}$/.test(code) ? code : null;
}

// For the places that take either kind, such as turning two-step sign-in off.
export function readAnyCode(
	input: string,
): { kind: CodeKind; code: string } | null {
	for (const kind of ["totp", "recovery"] as const) {
		const code = readCode(input, kind);
		if (code) return { kind, code };
	}
	return null;
}

// "JBSWY3DPEHPK3PXP" as "JBSW Y3DP EHPK 3PXP", easier to type into an app by hand.
export function groupSecret(secret: string) {
	return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

// The name the authenticator app shows for this entry. Appwrite sets the issuer to the project's
// name and the account to the person's email.
export function otpauthLabel(uri: string): {
	issuer: string | null;
	account: string | null;
} {
	try {
		const url = new URL(uri);
		const label = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
		const [prefix, account] = label.includes(":")
			? [
					label.slice(0, label.indexOf(":")),
					label.slice(label.indexOf(":") + 1),
				]
			: [null, label];
		return {
			issuer: url.searchParams.get("issuer") || prefix || null,
			account: account?.trim() || null,
		};
	} catch {
		return { issuer: null, account: null };
	}
}

// The text file people download next to their recovery codes.
export function recoveryCodesFile(
	codes: string[],
	{ email, site, date }: { email: string; site: string; date: Date },
) {
	return [
		`Catchall recovery codes for ${email}`,
		`${site}, created ${date.toISOString().slice(0, 10)}`,
		"",
		"Each code works once, in place of a code from your authenticator app.",
		"Creating new codes in Settings makes these stop working.",
		"",
		...codes,
		"",
	].join("\n");
}

// Errors from server functions can arrive as plain objects, so read the message from either.
export function errorText(err: unknown) {
	if (err && typeof err === "object" && "message" in err && err.message)
		return String(err.message);
	return typeof err === "string" && err
		? err
		: "Something went wrong. Try again.";
}
