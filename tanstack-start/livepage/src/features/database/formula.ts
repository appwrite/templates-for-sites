// Formula language: a tokenizer, a Pratt parser and a tree-walking evaluator. No eval, no regex.
//
// Column names are written bare, spaces included: `Target date`, `Open tasks + 1`. `prop("Name")` is
// there for names that hold punctuation. Identifiers are matched against the longest known column
// name first, so an unknown column reports the whole phrase and can suggest the closest match.

export type DateVal = { kind: "date"; start: string; end?: string };
export type Val = number | string | boolean | null | DateVal | Val[];

export type RefInfo = { id: string; name: string };

export type FormulaError = {
	message: string;
	start: number;
	end: number;
	line: number;
	col: number;
	suggestion?: string;
};

export type Node =
	| { t: "num"; v: number; start: number; end: number }
	| { t: "str"; v: string; start: number; end: number }
	| { t: "bool"; v: boolean; start: number; end: number }
	| { t: "ref"; id: string; name: string; start: number; end: number }
	| { t: "call"; name: string; args: Node[]; start: number; end: number }
	| { t: "un"; op: "-" | "!"; arg: Node; start: number; end: number }
	| { t: "bin"; op: string; a: Node; b: Node; start: number; end: number }
	| { t: "if"; c: Node; a: Node; b: Node; start: number; end: number };

export type ParseResult =
	| { ok: true; ast: Node; refs: string[] }
	| { ok: false; error: FormulaError };

export type EvalContext = {
	ref: (id: string) => Val;
	now?: Date;
};

class ParseFail extends Error {
	constructor(
		message: string,
		readonly start: number,
		readonly end: number,
		readonly suggestion?: string,
	) {
		super(message);
	}
}

export class RuntimeError extends Error {}

// ---------- Tokens ----------

type Tok =
	| { k: "num"; v: number; start: number; end: number }
	| { k: "str"; v: string; start: number; end: number }
	| { k: "ident"; v: string; start: number; end: number }
	| { k: "ref"; id: string; name: string; start: number; end: number }
	| { k: "op"; v: string; start: number; end: number }
	| { k: "eof"; start: number; end: number };

const isDigit = (c: string) => c >= "0" && c <= "9";
const isWordChar = (c: string) =>
	(c >= "a" && c <= "z") ||
	(c >= "A" && c <= "Z") ||
	isDigit(c) ||
	c === "_" ||
	c.charCodeAt(0) > 127;
const isSpace = (c: string) =>
	c === " " || c === "\t" || c === "\n" || c === "\r";

const KEYWORDS = new Set(["and", "or", "not", "true", "false", "prop"]);
const TWO_CHAR = new Set(["==", "!=", "<=", ">=", "&&", "||", "=="]);
const ONE_CHAR = new Set([
	"+",
	"-",
	"*",
	"/",
	"%",
	"^",
	"<",
	">",
	"!",
	"(",
	")",
	",",
	"?",
	":",
	"=",
]);

function tokenize(src: string, refs: RefInfo[]) {
	const byName = new Map(refs.map((r) => [r.name.toLowerCase(), r]));
	const toks: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (isSpace(c)) {
			i++;
			continue;
		}
		if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
			const start = i;
			while (i < src.length && (isDigit(src[i]) || src[i] === ".")) i++;
			const text = src.slice(start, i);
			const value = Number(text);
			if (Number.isNaN(value))
				throw new ParseFail(`"${text}" isn't a number.`, start, i);
			toks.push({ k: "num", v: value, start, end: i });
			continue;
		}
		if (c === '"' || c === "'") {
			const quote = c;
			const start = i++;
			let out = "";
			while (i < src.length && src[i] !== quote) {
				if (src[i] === "\\" && i + 1 < src.length) {
					const n = src[i + 1];
					out += n === "n" ? "\n" : n === "t" ? "\t" : n;
					i += 2;
				} else {
					out += src[i++];
				}
			}
			if (i >= src.length)
				throw new ParseFail("This text never closes.", start, src.length);
			i++;
			toks.push({ k: "str", v: out, start, end: i });
			continue;
		}
		if (isWordChar(c)) {
			const start = i;
			const words: { text: string; end: number }[] = [];
			let end = i;
			for (;;) {
				const wordStart = end;
				while (end < src.length && isWordChar(src[end])) end++;
				const text = src.slice(wordStart, end);
				if (!text) break;
				words.push({ text, end });
				// A word that is an operator keyword stops the phrase, and so does a call.
				let probe = end;
				while (
					probe < src.length &&
					(src[probe] === " " || src[probe] === "\t")
				)
					probe++;
				if (
					probe >= src.length ||
					!isWordChar(src[probe]) ||
					src[probe] === "("
				)
					break;
				if (src[end] === "\n") break;
				const next = src.slice(probe).split(" ", 1)[0].toLowerCase();
				if (KEYWORDS.has(next)) break;
				end = probe;
			}
			// A function call ends the phrase at one word.
			let after = words[words.length - 1].end;
			while (after < src.length && isSpace(src[after])) after++;
			const isCall = src[after] === "(";
			if (words.length === 1 && isCall) {
				toks.push({ k: "ident", v: words[0].text, start, end: words[0].end });
				i = words[0].end;
				continue;
			}
			// Longest known column at the start of this phrase.
			let matched = false;
			for (let n = words.length; n >= 1; n--) {
				const phrase = src.slice(start, words[n - 1].end);
				const ref = byName.get(phrase.toLowerCase());
				if (ref) {
					toks.push({
						k: "ref",
						id: ref.id,
						name: ref.name,
						start,
						end: words[n - 1].end,
					});
					i = words[n - 1].end;
					matched = true;
					break;
				}
			}
			if (matched) continue;
			// Not a column. Keywords and function names stay as a single word.
			const first = words[0].text.toLowerCase();
			if (KEYWORDS.has(first) || words.length === 1) {
				toks.push({ k: "ident", v: words[0].text, start, end: words[0].end });
				i = words[0].end;
				continue;
			}
			const phrase = src.slice(start, words[words.length - 1].end);
			throw unknownColumn(phrase, start, start + phrase.length, refs);
		}
		const two = src.slice(i, i + 2);
		if (TWO_CHAR.has(two)) {
			toks.push({ k: "op", v: two, start: i, end: i + 2 });
			i += 2;
			continue;
		}
		if (ONE_CHAR.has(c)) {
			toks.push({ k: "op", v: c === "=" ? "==" : c, start: i, end: i + 1 });
			i++;
			continue;
		}
		throw new ParseFail(`"${c}" can't be used here.`, i, i + 1);
	}
	toks.push({ k: "eof", start: src.length, end: src.length });
	return toks;
}

function levenshtein(a: string, b: string) {
	const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = dp[0];
		dp[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = dp[j];
			dp[j] = Math.min(
				dp[j] + 1,
				dp[j - 1] + 1,
				prev + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			prev = tmp;
		}
	}
	return dp[b.length];
}

function closest(input: string, options: string[]) {
	const lower = input.toLowerCase();
	let best: string | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const option of options) {
		const score = levenshtein(lower, option.toLowerCase());
		if (score < bestScore) {
			bestScore = score;
			best = option;
		}
	}
	const limit = Math.max(2, Math.floor(input.length / 3));
	return best && bestScore <= limit ? best : undefined;
}

function unknownColumn(
	phrase: string,
	start: number,
	end: number,
	refs: RefInfo[],
) {
	const suggestion = closest(
		phrase,
		refs.map((r) => r.name),
	);
	return new ParseFail(
		`There's no column called ${phrase}`,
		start,
		end,
		suggestion,
	);
}

// ---------- Parser ----------

const PRECEDENCE: Record<string, number> = {
	"||": 1,
	or: 1,
	"&&": 2,
	and: 2,
	"==": 3,
	"!=": 3,
	"<": 4,
	"<=": 4,
	">": 4,
	">=": 4,
	"+": 5,
	"-": 5,
	"*": 6,
	"/": 6,
	"%": 6,
	"^": 7,
};

class Parser {
	private pos = 0;
	constructor(
		private readonly toks: Tok[],
		private readonly refs: RefInfo[],
		private readonly names: Set<string>,
	) {}

	private peek() {
		return this.toks[this.pos];
	}
	private next() {
		return this.toks[this.pos++];
	}
	private isOp(v: string) {
		const t = this.peek();
		return t.k === "op" && t.v === v;
	}
	private isWord(v: string) {
		const t = this.peek();
		return t.k === "ident" && t.v.toLowerCase() === v;
	}
	private expect(v: string) {
		const t = this.peek();
		if (t.k === "op" && t.v === v) return this.next();
		throw new ParseFail(
			t.k === "eof"
				? `This needs a closing ${v}`
				: `Expected ${v} but found ${describe(t)}.`,
			t.start,
			t.end,
		);
	}

	parse() {
		const ast = this.ternary();
		const t = this.peek();
		if (t.k !== "eof")
			throw new ParseFail(`Didn't expect ${describe(t)} here.`, t.start, t.end);
		return ast;
	}

	private ternary(): Node {
		const c = this.binary(1);
		if (this.isOp("?")) {
			this.next();
			const a = this.ternary();
			this.expect(":");
			const b = this.ternary();
			return { t: "if", c, a, b, start: c.start, end: b.end };
		}
		return c;
	}

	private binary(minPrec: number): Node {
		let left = this.unary();
		for (;;) {
			const t = this.peek();
			const op = t.k === "op" ? t.v : t.k === "ident" ? t.v.toLowerCase() : "";
			const prec = PRECEDENCE[op];
			if (!prec || prec < minPrec) return left;
			this.next();
			// ^ is right associative.
			const right = this.binary(op === "^" ? prec : prec + 1);
			left = {
				t: "bin",
				op: op === "and" ? "&&" : op === "or" ? "||" : op,
				a: left,
				b: right,
				start: left.start,
				end: right.end,
			};
		}
	}

	private unary(): Node {
		const t = this.peek();
		if (t.k === "op" && t.v === "-") {
			this.next();
			const arg = this.unary();
			return { t: "un", op: "-", arg, start: t.start, end: arg.end };
		}
		if ((t.k === "op" && t.v === "!") || this.isWord("not")) {
			this.next();
			const arg = this.unary();
			return { t: "un", op: "!", arg, start: t.start, end: arg.end };
		}
		return this.primary();
	}

	private primary(): Node {
		const t = this.peek();
		if (t.k === "num") {
			this.next();
			return { t: "num", v: t.v, start: t.start, end: t.end };
		}
		if (t.k === "str") {
			this.next();
			return { t: "str", v: t.v, start: t.start, end: t.end };
		}
		if (t.k === "ref") {
			this.next();
			return { t: "ref", id: t.id, name: t.name, start: t.start, end: t.end };
		}
		if (t.k === "op" && t.v === "(") {
			this.next();
			const inner = this.ternary();
			this.expect(")");
			return inner;
		}
		if (t.k === "ident") {
			this.next();
			const lower = t.v.toLowerCase();
			if (lower === "true" || lower === "false")
				return {
					t: "bool",
					v: lower === "true",
					start: t.start,
					end: t.end,
				};
			if (this.isOp("(")) return this.call(t.v, t.start);
			if (FUNCTIONS[lower])
				throw new ParseFail(
					`${t.v} needs brackets after it, like ${t.v}()`,
					t.start,
					t.end,
				);
			throw unknownColumn(t.v, t.start, t.end, this.refs);
		}
		if (t.k === "eof")
			throw new ParseFail(
				"The formula stops before it's finished.",
				t.start,
				t.end,
			);
		throw new ParseFail(`Didn't expect ${describe(t)} here.`, t.start, t.end);
	}

	private call(name: string, start: number): Node {
		this.expect("(");
		const args: Node[] = [];
		if (!this.isOp(")")) {
			for (;;) {
				args.push(this.ternary());
				if (!this.isOp(",")) break;
				this.next();
			}
		}
		const close = this.expect(")");
		const lower = name.toLowerCase();
		if (lower === "prop") return this.propCall(args, start, close.end);
		const fn = FUNCTIONS[lower];
		if (!fn) {
			const suggestion = closest(name, [...this.names]);
			throw new ParseFail(
				`There's no function called ${name}`,
				start,
				start + name.length,
				suggestion,
			);
		}
		const count = args.length;
		if (count < fn.min || count > fn.max)
			throw new ParseFail(
				fn.min === fn.max
					? `${name} takes ${fn.min} ${fn.min === 1 ? "value" : "values"}, not ${count}.`
					: `${name} takes ${fn.min} to ${fn.max === Number.POSITIVE_INFINITY ? "any number of" : fn.max} values, not ${count}.`,
				start,
				close.end,
			);
		return { t: "call", name: lower, args, start, end: close.end };
	}

	private propCall(args: Node[], start: number, end: number): Node {
		const arg = args[0];
		if (args.length !== 1 || arg.t !== "str")
			throw new ParseFail('Write prop("Column name").', start, end);
		const ref = this.refs.find(
			(r) => r.name.toLowerCase() === arg.v.toLowerCase(),
		);
		if (!ref) throw unknownColumn(arg.v, start, end, this.refs);
		return { t: "ref", id: ref.id, name: ref.name, start, end };
	}
}

function describe(t: Tok) {
	if (t.k === "eof") return "the end";
	if (t.k === "num") return String(t.v);
	if (t.k === "str") return `"${t.v}"`;
	if (t.k === "ref") return t.name;
	return t.v;
}

function positionOf(src: string, offset: number) {
	let line = 1;
	let col = 1;
	for (let i = 0; i < offset && i < src.length; i++) {
		if (src[i] === "\n") {
			line++;
			col = 1;
		} else col++;
	}
	return { line, col };
}

export function parseFormula(src: string, refs: RefInfo[]): ParseResult {
	try {
		const toks = tokenize(src, refs);
		const names = new Set(Object.keys(FUNCTIONS));
		const ast = new Parser(toks, refs, names).parse();
		const used = new Set<string>();
		collectRefs(ast, used);
		return { ok: true, ast, refs: [...used] };
	} catch (err) {
		if (err instanceof ParseFail) {
			const { line, col } = positionOf(src, err.start);
			return {
				ok: false,
				error: {
					message: err.message,
					start: err.start,
					end: err.end,
					line,
					col,
					suggestion: err.suggestion,
				},
			};
		}
		throw err;
	}
}

// The references in a parsed formula, in source order: which column each one is, and where it's written.
export function refSpans(node: Node) {
	const out: { id: string; name: string; start: number; end: number }[] = [];
	const walk = (n: Node) => {
		switch (n.t) {
			case "ref":
				out.push({ id: n.id, name: n.name, start: n.start, end: n.end });
				break;
			case "call":
				n.args.forEach(walk);
				break;
			case "un":
				walk(n.arg);
				break;
			case "bin":
				walk(n.a);
				walk(n.b);
				break;
			case "if":
				walk(n.c);
				walk(n.a);
				walk(n.b);
				break;
			default:
				break;
		}
	};
	walk(node);
	return out;
}

// The saved form of a formula's references: each name as written, pointing at its column's id.
export function refMap(node: Node) {
	const refs: Record<string, string> = {};
	for (const ref of refSpans(node)) refs[ref.name] = ref.id;
	return refs;
}

function collectRefs(node: Node, out: Set<string>) {
	switch (node.t) {
		case "ref":
			out.add(node.id);
			break;
		case "call":
			for (const a of node.args) collectRefs(a, out);
			break;
		case "un":
			collectRefs(node.arg, out);
			break;
		case "bin":
			collectRefs(node.a, out);
			collectRefs(node.b, out);
			break;
		case "if":
			collectRefs(node.c, out);
			collectRefs(node.a, out);
			collectRefs(node.b, out);
			break;
		default:
			break;
	}
}

// ---------- Values ----------

export function isDate(v: Val): v is DateVal {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isEmptyVal(v: Val) {
	return (
		v === null ||
		v === "" ||
		(Array.isArray(v) && v.length === 0) ||
		(typeof v === "number" && Number.isNaN(v))
	);
}

function truthy(v: Val): boolean {
	if (Array.isArray(v)) return v.length > 0;
	if (isDate(v)) return true;
	return Boolean(v);
}

export function toText(v: Val): string {
	if (v === null) return "";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number") return formatNumber(v);
	if (isDate(v)) return v.end ? `${v.start} to ${v.end}` : v.start;
	if (Array.isArray(v)) return v.map(toText).join(", ");
	return v;
}

function formatNumber(n: number) {
	if (Number.isInteger(n)) return String(n);
	return String(Number(n.toPrecision(12)));
}

function toNum(v: Val, label: string): number {
	if (v === null || v === "") return 0;
	if (typeof v === "number") return v;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "string") {
		const n = Number(v);
		if (!Number.isNaN(n) && v.trim() !== "") return n;
	}
	throw new RuntimeError(`${label} needs a number, not ${quoteVal(v)}.`);
}

function quoteVal(v: Val) {
	return typeof v === "string" ? `"${v}"` : toText(v);
}

function toDate(v: Val, label: string): Date {
	if (isDate(v)) return new Date(v.start);
	if (typeof v === "string" && v) {
		const d = new Date(v);
		if (!Number.isNaN(d.getTime())) return d;
	}
	throw new RuntimeError(`${label} needs a date, not ${quoteVal(v)}.`);
}

function dateVal(d: Date): DateVal {
	return { kind: "date", start: d.toISOString() };
}

function list(v: Val): Val[] {
	return Array.isArray(v) ? v : v === null ? [] : [v];
}

function flatNums(args: Val[], label: string): number[] {
	const out: number[] = [];
	for (const a of args) {
		for (const item of list(a)) {
			if (Array.isArray(item)) out.push(...flatNums(item, label));
			else if (item !== null && item !== "") out.push(toNum(item, label));
		}
	}
	return out;
}

const DAY_MS = 86_400_000;

function addUnits(date: Date, amount: number, unit: string) {
	const d = new Date(date);
	const u = unit.toLowerCase();
	if (u.startsWith("year")) d.setUTCFullYear(d.getUTCFullYear() + amount);
	else if (u.startsWith("quarter")) d.setUTCMonth(d.getUTCMonth() + amount * 3);
	else if (u.startsWith("month")) d.setUTCMonth(d.getUTCMonth() + amount);
	else if (u.startsWith("week")) d.setTime(d.getTime() + amount * 7 * DAY_MS);
	else if (u.startsWith("day")) d.setTime(d.getTime() + amount * DAY_MS);
	else if (u.startsWith("hour")) d.setTime(d.getTime() + amount * 3_600_000);
	else if (u.startsWith("minute")) d.setTime(d.getTime() + amount * 60_000);
	else
		throw new RuntimeError(
			`"${unit}" isn't a time unit. Use days, weeks, months, or years.`,
		);
	return d;
}

function diffUnits(a: Date, b: Date, unit: string) {
	const u = unit.toLowerCase();
	const ms = a.getTime() - b.getTime();
	if (u.startsWith("year")) return a.getUTCFullYear() - b.getUTCFullYear();
	if (u.startsWith("quarter"))
		return Math.trunc(
			(a.getUTCFullYear() * 12 +
				a.getUTCMonth() -
				(b.getUTCFullYear() * 12 + b.getUTCMonth())) /
				3,
		);
	if (u.startsWith("month"))
		return (
			a.getUTCFullYear() * 12 +
			a.getUTCMonth() -
			(b.getUTCFullYear() * 12 + b.getUTCMonth())
		);
	if (u.startsWith("week")) return Math.trunc(ms / (7 * DAY_MS));
	if (u.startsWith("day")) return Math.trunc(ms / DAY_MS);
	if (u.startsWith("hour")) return Math.trunc(ms / 3_600_000);
	if (u.startsWith("minute")) return Math.trunc(ms / 60_000);
	throw new RuntimeError(
		`"${unit}" isn't a time unit. Use days, weeks, months, or years.`,
	);
}

function pad(n: number) {
	return String(n).padStart(2, "0");
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function formatDatePattern(d: Date, pattern: string) {
	let out = "";
	for (let i = 0; i < pattern.length; ) {
		const rest = pattern.slice(i);
		if (rest.startsWith("YYYY")) {
			out += d.getUTCFullYear();
			i += 4;
		} else if (rest.startsWith("MMM")) {
			out += MONTHS[d.getUTCMonth()];
			i += 3;
		} else if (rest.startsWith("MM")) {
			out += pad(d.getUTCMonth() + 1);
			i += 2;
		} else if (rest.startsWith("DD")) {
			out += pad(d.getUTCDate());
			i += 2;
		} else if (rest.startsWith("HH")) {
			out += pad(d.getUTCHours());
			i += 2;
		} else if (rest.startsWith("mm")) {
			out += pad(d.getUTCMinutes());
			i += 2;
		} else {
			out += pattern[i];
			i++;
		}
	}
	return out;
}

// ---------- Functions ----------

type Fn = {
	min: number;
	max: number;
	run: (args: Val[], ctx: EvalContext) => Val;
};

const any = Number.POSITIVE_INFINITY;

const FUNCTIONS: Record<string, Fn> = {
	// Logic
	if: {
		min: 3,
		max: 3,
		run: () => null, // Lazy: handled in evaluate.
	},
	ifs: {
		min: 3,
		max: any,
		run: () => null, // Lazy: handled in evaluate.
	},
	empty: { min: 1, max: 1, run: ([v]) => isEmptyVal(v) },
	not: { min: 1, max: 1, run: ([v]) => !truthy(v) },
	and: { min: 2, max: any, run: (a) => a.every(truthy) },
	or: { min: 2, max: any, run: (a) => a.some(truthy) },

	// Numbers
	round: {
		min: 1,
		max: 2,
		run: ([v, digits]) => {
			const scale = 10 ** (digits === undefined ? 0 : toNum(digits, "round"));
			return Math.round(toNum(v, "round") * scale) / scale;
		},
	},
	floor: { min: 1, max: 1, run: ([v]) => Math.floor(toNum(v, "floor")) },
	ceil: { min: 1, max: 1, run: ([v]) => Math.ceil(toNum(v, "ceil")) },
	abs: { min: 1, max: 1, run: ([v]) => Math.abs(toNum(v, "abs")) },
	sqrt: { min: 1, max: 1, run: ([v]) => Math.sqrt(toNum(v, "sqrt")) },
	pow: {
		min: 2,
		max: 2,
		run: ([a, b]) => toNum(a, "pow") ** toNum(b, "pow"),
	},
	mod: {
		min: 2,
		max: 2,
		run: ([a, b]) => {
			const d = toNum(b, "mod");
			if (d === 0) throw new RuntimeError("Can't divide by zero.");
			return toNum(a, "mod") % d;
		},
	},
	min: {
		min: 1,
		max: any,
		run: (a) => {
			const nums = flatNums(a, "min");
			return nums.length ? Math.min(...nums) : null;
		},
	},
	max: {
		min: 1,
		max: any,
		run: (a) => {
			const nums = flatNums(a, "max");
			return nums.length ? Math.max(...nums) : null;
		},
	},
	sum: {
		min: 1,
		max: any,
		run: (a) => flatNums(a, "sum").reduce((x, y) => x + y, 0),
	},
	average: {
		min: 1,
		max: any,
		run: (a) => {
			const nums = flatNums(a, "average");
			return nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : null;
		},
	},
	median: {
		min: 1,
		max: any,
		run: (a) => {
			const nums = flatNums(a, "median").sort((x, y) => x - y);
			if (!nums.length) return null;
			const mid = Math.floor(nums.length / 2);
			return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
		},
	},
	tonumber: {
		min: 1,
		max: 1,
		run: ([v]) => {
			if (typeof v === "boolean") return v ? 1 : 0;
			if (isDate(v)) return new Date(v.start).getTime();
			const n = Number(typeof v === "string" ? v.trim() : v);
			return Number.isNaN(n) ? null : n;
		},
	},

	// Text
	concat: {
		min: 1,
		max: any,
		run: (a) => a.map(toText).join(""),
	},
	join: {
		min: 2,
		max: any,
		run: ([first, ...rest]) =>
			rest
				.flatMap((v) => (Array.isArray(v) ? v : [v]))
				.map(toText)
				.join(toText(first)),
	},
	lower: { min: 1, max: 1, run: ([v]) => toText(v).toLowerCase() },
	upper: { min: 1, max: 1, run: ([v]) => toText(v).toUpperCase() },
	trim: { min: 1, max: 1, run: ([v]) => toText(v).trim() },
	length: {
		min: 1,
		max: 1,
		run: ([v]) => (Array.isArray(v) ? v.length : toText(v).length),
	},
	contains: {
		min: 2,
		max: 2,
		run: ([v, part]) =>
			Array.isArray(v)
				? v.some((x) => toText(x) === toText(part))
				: toText(v).toLowerCase().includes(toText(part).toLowerCase()),
	},
	replace: {
		min: 3,
		max: 3,
		run: ([v, from, to]) => toText(v).split(toText(from)).join(toText(to)),
	},
	slice: {
		min: 2,
		max: 3,
		run: ([v, a, b]) => {
			const from = toNum(a, "slice");
			const to = b === undefined ? undefined : toNum(b, "slice");
			return Array.isArray(v) ? v.slice(from, to) : toText(v).slice(from, to);
		},
	},
	format: { min: 1, max: 1, run: ([v]) => toText(v) },
	totext: { min: 1, max: 1, run: ([v]) => toText(v) },

	// Lists
	first: {
		min: 1,
		max: 1,
		run: ([v]) => (Array.isArray(v) ? (v[0] ?? null) : v),
	},
	last: {
		min: 1,
		max: 1,
		run: ([v]) => (Array.isArray(v) ? (v[v.length - 1] ?? null) : v),
	},
	at: {
		min: 2,
		max: 2,
		run: ([v, i]) => {
			const items = list(v);
			const index = toNum(i, "at");
			return items[index < 0 ? items.length + index : index] ?? null;
		},
	},
	unique: {
		min: 1,
		max: 1,
		run: ([v]) => {
			const seen = new Set<string>();
			return list(v).filter((x) => {
				const key = toText(x);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		},
	},
	count: {
		min: 1,
		max: any,
		run: (a) => a.flatMap(list).filter((x) => !isEmptyVal(x)).length,
	},

	// Dates
	now: { min: 0, max: 0, run: (_, ctx) => dateVal(ctx.now ?? new Date()) },
	today: {
		min: 0,
		max: 0,
		run: (_, ctx) => {
			const d = new Date(ctx.now ?? new Date());
			d.setUTCHours(0, 0, 0, 0);
			return dateVal(d);
		},
	},
	datebetween: {
		min: 3,
		max: 3,
		run: ([a, b, unit]) =>
			diffUnits(
				toDate(a, "dateBetween"),
				toDate(b, "dateBetween"),
				toText(unit),
			),
	},
	dateadd: {
		min: 3,
		max: 3,
		run: ([d, n, unit]) =>
			dateVal(
				addUnits(toDate(d, "dateAdd"), toNum(n, "dateAdd"), toText(unit)),
			),
	},
	datesubtract: {
		min: 3,
		max: 3,
		run: ([d, n, unit]) =>
			dateVal(
				addUnits(
					toDate(d, "dateSubtract"),
					-toNum(n, "dateSubtract"),
					toText(unit),
				),
			),
	},
	start: {
		min: 1,
		max: 1,
		run: ([v]) => (isDate(v) ? { kind: "date", start: v.start } : null),
	},
	end: {
		min: 1,
		max: 1,
		run: ([v]) =>
			isDate(v) ? { kind: "date", start: v.end ?? v.start } : null,
	},
	year: {
		min: 1,
		max: 1,
		run: ([v]) => toDate(v, "year").getUTCFullYear(),
	},
	month: {
		min: 1,
		max: 1,
		run: ([v]) => toDate(v, "month").getUTCMonth() + 1,
	},
	day: {
		min: 1,
		max: 1,
		run: ([v]) => toDate(v, "day").getUTCDate(),
	},
	weekday: {
		min: 1,
		max: 1,
		run: ([v]) => toDate(v, "weekday").getUTCDay(),
	},
	hour: {
		min: 1,
		max: 1,
		run: ([v]) => toDate(v, "hour").getUTCHours(),
	},
	formatdate: {
		min: 2,
		max: 2,
		run: ([v, pattern]) =>
			formatDatePattern(toDate(v, "formatDate"), toText(pattern)),
	},
};

export const FUNCTION_NAMES = [
	"if",
	"ifs",
	"empty",
	"not",
	"concat",
	"join",
	"lower",
	"upper",
	"trim",
	"length",
	"contains",
	"replace",
	"slice",
	"round",
	"floor",
	"ceil",
	"abs",
	"sqrt",
	"pow",
	"mod",
	"min",
	"max",
	"sum",
	"average",
	"median",
	"count",
	"toNumber",
	"toText",
	"first",
	"last",
	"at",
	"unique",
	"now",
	"today",
	"dateBetween",
	"dateAdd",
	"dateSubtract",
	"start",
	"end",
	"year",
	"month",
	"day",
	"weekday",
	"hour",
	"formatDate",
];

// ---------- Evaluate ----------

function compare(a: Val, b: Val, op: string, node: Node): boolean {
	if (op === "==" || op === "!=") {
		const eq = looseEqual(a, b);
		return op === "==" ? eq : !eq;
	}
	let x: number | string;
	let y: number | string;
	if (isDate(a) || isDate(b)) {
		x = toDate(a, op).getTime();
		y = toDate(b, op).getTime();
	} else if (typeof a === "number" || typeof b === "number") {
		x = toNum(a, op);
		y = toNum(b, op);
	} else {
		x = toText(a);
		y = toText(b);
	}
	void node;
	if (op === "<") return x < y;
	if (op === "<=") return x <= y;
	if (op === ">") return x > y;
	return x >= y;
}

function looseEqual(a: Val, b: Val): boolean {
	if (isEmptyVal(a) && isEmptyVal(b)) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (Array.isArray(a) && Array.isArray(b))
			return a.length === b.length && a.every((v, i) => looseEqual(v, b[i]));
		const [arr, one] = Array.isArray(a) ? [a, b] : [b as Val[], a];
		return arr.some((v) => looseEqual(v, one));
	}
	if (isDate(a) || isDate(b))
		return toDate(a, "==").getTime() === toDate(b, "==").getTime();
	if (typeof a === "number" || typeof b === "number") {
		const x = typeof a === "number" ? a : Number(a);
		const y = typeof b === "number" ? b : Number(b);
		return x === y;
	}
	return toText(a) === toText(b);
}

function concatVals(a: Val, b: Val): Val {
	return toText(a) + toText(b);
}

export function evaluate(node: Node, ctx: EvalContext): Val {
	switch (node.t) {
		case "num":
		case "str":
		case "bool":
			return node.v;
		case "ref":
			return ctx.ref(node.id);
		case "if":
			return truthy(evaluate(node.c, ctx))
				? evaluate(node.a, ctx)
				: evaluate(node.b, ctx);
		case "un": {
			const arg = evaluate(node.arg, ctx);
			return node.op === "-" ? -toNum(arg, "-") : !truthy(arg);
		}
		case "bin": {
			if (node.op === "&&")
				return truthy(evaluate(node.a, ctx)) && truthy(evaluate(node.b, ctx));
			if (node.op === "||")
				return truthy(evaluate(node.a, ctx)) || truthy(evaluate(node.b, ctx));
			const a = evaluate(node.a, ctx);
			const b = evaluate(node.b, ctx);
			if (
				node.op === "==" ||
				node.op === "!=" ||
				node.op === "<" ||
				node.op === "<=" ||
				node.op === ">" ||
				node.op === ">="
			)
				return compare(a, b, node.op, node);
			if (
				node.op === "+" &&
				(typeof a === "string" ||
					typeof b === "string" ||
					isDate(a) ||
					isDate(b))
			)
				return concatVals(a, b);
			const x = toNum(a, node.op);
			const y = toNum(b, node.op);
			switch (node.op) {
				case "+":
					return x + y;
				case "-":
					return x - y;
				case "*":
					return x * y;
				case "/":
					if (y === 0) throw new RuntimeError("Can't divide by zero.");
					return x / y;
				case "%":
					if (y === 0) throw new RuntimeError("Can't divide by zero.");
					return x % y;
				case "^":
					return x ** y;
				default:
					throw new RuntimeError(`Unknown operator ${node.op}`);
			}
		}
		case "call": {
			if (node.name === "if")
				return truthy(evaluate(node.args[0], ctx))
					? evaluate(node.args[1], ctx)
					: evaluate(node.args[2], ctx);
			if (node.name === "ifs") {
				const { args } = node;
				if (args.length % 2 === 0)
					throw new RuntimeError("ifs needs a value for every condition.");
				for (let i = 0; i + 1 < args.length; i += 2)
					if (truthy(evaluate(args[i], ctx))) return evaluate(args[i + 1], ctx);
				return evaluate(args[args.length - 1], ctx);
			}
			const fn = FUNCTIONS[node.name];
			return fn.run(
				node.args.map((a) => evaluate(a, ctx)),
				ctx,
			);
		}
	}
}

// Evaluates, turning runtime errors into a value the caller can show.
export function evaluateSafe(
	node: Node,
	ctx: EvalContext,
): { ok: true; value: Val } | { ok: false; error: string } {
	try {
		return { ok: true, value: evaluate(node, ctx) };
	} catch (err) {
		if (err instanceof RuntimeError) return { ok: false, error: err.message };
		return { ok: false, error: "This formula can't be worked out." };
	}
}
