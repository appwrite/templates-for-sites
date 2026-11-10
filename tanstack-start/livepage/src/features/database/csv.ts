// CSV reading and writing. Handles quotes, newlines inside quotes, CRLF and a byte-order mark.

export type CsvTable = { headers: string[]; rows: string[][] };

export function detectDelimiter(text: string) {
	const firstLine = text.slice(0, text.indexOf("\n") >>> 0);
	const counts = [",", "\t", ";"].map((d) => ({
		d,
		n: firstLine.split(d).length,
	}));
	counts.sort((a, b) => b.n - a.n);
	return counts[0].n > 1 ? counts[0].d : ",";
}

export function parseCsv(input: string, delimiter?: string): CsvTable {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const sep = delimiter ?? detectDelimiter(text);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let wasQuoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
			continue;
		}
		if (c === '"' && field === "" && !wasQuoted) {
			quoted = true;
			wasQuoted = true;
			continue;
		}
		if (c === sep) {
			row.push(field);
			field = "";
			wasQuoted = false;
			continue;
		}
		if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			field = "";
			wasQuoted = false;
			if (row.some((cell) => cell !== "")) rows.push(row);
			row = [];
			continue;
		}
		field += c;
	}
	if (field !== "" || row.length || wasQuoted) {
		row.push(field);
		if (row.some((cell) => cell !== "")) rows.push(row);
	}
	const headers = (rows.shift() ?? []).map(
		(h, i) => h.trim() || `Column ${i + 1}`,
	);
	const width = headers.length;
	return {
		headers,
		rows: rows.map((r) => {
			const copy = r.slice(0, width);
			while (copy.length < width) copy.push("");
			return copy;
		}),
	};
}

// Spreadsheets run a cell that starts with one of these as a formula. Prefixing a quote keeps the
// value as text in Excel and Sheets and is the usual way to neutralize it.
const FORMULA_START = ["=", "+", "-", "@", "\t", "\r"];

const PLAIN_NUMBER = /^[-+]?\d+([.,]\d+)?$/;

function neutralize(value: string) {
	if (PLAIN_NUMBER.test(value)) return value;
	return FORMULA_START.some((c) => value.startsWith(c)) ? `'${value}` : value;
}

function escapeField(raw: string, sep: string) {
	const value = neutralize(raw);
	if (
		value.includes(sep) ||
		value.includes('"') ||
		value.includes("\n") ||
		value.includes("\r")
	)
		return `"${value.split('"').join('""')}"`;
	return value;
}

export function toCsv(headers: string[], rows: string[][], sep = ","): string {
	const lines = [headers, ...rows].map((row) =>
		row.map((value) => escapeField(value, sep)).join(sep),
	);
	return lines.join("\r\n");
}

// What a column of raw values looks like, so the importer can pick a sensible type.
export type InferredType =
	| "text"
	| "number"
	| "checkbox"
	| "date"
	| "select"
	| "url"
	| "email";

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "checked", "done"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "unchecked", ""]);

export function parseBool(value: string) {
	return TRUE_WORDS.has(value.trim().toLowerCase());
}

export function parseNumber(value: string): number | null {
	const cleaned = value
		.trim()
		.split(",")
		.join("")
		.split("$")
		.join("")
		.split("%")
		.join("");
	if (cleaned === "") return null;
	const n = Number(cleaned);
	return Number.isNaN(n) ? null : n;
}

export function parseDateText(value: string): string | null {
	const text = value.trim();
	if (!text) return null;
	const direct = new Date(text);
	if (Number.isNaN(direct.getTime())) return null;
	return direct.toISOString().slice(0, 10);
}

function isUrl(value: string) {
	return value.startsWith("http://") || value.startsWith("https://");
}

function isEmail(value: string) {
	const at = value.indexOf("@");
	return at > 0 && value.indexOf(".", at) > at + 1 && !value.includes(" ");
}

export function inferType(values: string[]): InferredType {
	const filled = values.map((v) => v.trim()).filter(Boolean);
	if (!filled.length) return "text";
	const lower = filled.map((v) => v.toLowerCase());
	if (lower.every((v) => TRUE_WORDS.has(v) || FALSE_WORDS.has(v)))
		return "checkbox";
	if (filled.every((v) => parseNumber(v) !== null)) return "number";
	if (filled.every(isUrl)) return "url";
	if (filled.every(isEmail)) return "email";
	if (filled.every((v) => parseDateText(v) !== null)) return "date";
	const distinct = new Set(lower);
	if (distinct.size <= 12 && distinct.size < filled.length * 0.6)
		return "select";
	return "text";
}
