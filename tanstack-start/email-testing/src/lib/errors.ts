// Errors from server functions can arrive as plain objects, so read the message from either.
export function errorText(err: unknown) {
	if (err && typeof err === "object" && "message" in err && err.message)
		return String(err.message);
	return typeof err === "string" && err
		? err
		: "Something went wrong. Try again.";
}
