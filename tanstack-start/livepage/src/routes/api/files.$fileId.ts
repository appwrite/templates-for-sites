import { createFileRoute } from "@tanstack/react-router";
import { appwriteEnv, siteKey } from "#/server/appwrite";
import { readSessionSecret } from "#/server/auth";
import { publishedPageUses } from "#/server/published";
import { BUCKET_ID } from "#/server/schema";

// Only these types are ever shown inline on the app's origin, whatever name or type was declared.
// SVG and HTML can run scripts, so they download instead. The match is on the file's first bytes.
const SIGNATURES: { mime: string; test: (b: Uint8Array) => boolean }[] = [
	{
		mime: "image/png",
		test: (b) =>
			b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
	},
	{
		mime: "image/jpeg",
		test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		mime: "image/gif",
		test: (b) => {
			const head = String.fromCharCode(...b.slice(0, 6));
			return head === "GIF87a" || head === "GIF89a";
		},
	},
	{
		mime: "image/webp",
		test: (b) =>
			String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
			String.fromCharCode(...b.slice(8, 12)) === "WEBP",
	},
];

const SNIFF_BYTES = 32;

function sniff(head: Uint8Array) {
	return SIGNATURES.find((s) => s.test(head))?.mime ?? null;
}

// Reads just enough of the stream to sniff, without losing what it read.
async function peek(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let seen = 0;
	let done = false;
	while (seen < SNIFF_BYTES && !done) {
		const read = await reader.read();
		done = read.done;
		if (read.value) {
			chunks.push(read.value);
			seen += read.value.length;
		}
	}
	const head = new Uint8Array(seen);
	let offset = 0;
	for (const chunk of chunks) {
		head.set(chunk, offset);
		offset += chunk.length;
	}
	const rest = new ReadableStream<Uint8Array>({
		async start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			if (done) controller.close();
		},
		async pull(controller) {
			const { value, done: finished } = await reader.read();
			if (finished) controller.close();
			else controller.enqueue(value);
		},
		cancel() {
			reader.cancel().catch(() => undefined);
		},
	});
	return { head, stream: rest };
}

function downloadName(upstream: Headers) {
	const match = upstream
		.get("content-disposition")
		?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
	const name = match?.[1]?.replace(/[\r\n"\\/]/g, "") || "download";
	return name.slice(0, 200);
}

// Serves a file with the signed-in person's own permissions, so private images stay private. A
// published page can pass its slug: then the file is served only if that page really uses it
// and it belongs to that page's workspace or creator.
export const Route = createFileRoute("/api/files/$fileId")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const url = new URL(request.url);
				const slug = url.searchParams.get("slug");
				const download = url.searchParams.has("download");
				const headers: Record<string, string> = {
					"X-Appwrite-Project": appwriteEnv().projectId,
				};
				if (slug) {
					if (!(await publishedPageUses(slug, params.fileId)))
						return new Response("Not found", { status: 404 });
					const key = siteKey();
					if (!key) return new Response("Not found", { status: 404 });
					headers["X-Appwrite-Key"] = key;
				} else {
					const secret = readSessionSecret();
					if (!secret) return new Response("Not found", { status: 404 });
					headers["X-Appwrite-Session"] = secret;
				}
				const { endpoint } = appwriteEnv();
				const upstream = await fetch(
					`${endpoint}/storage/buckets/${BUCKET_ID}/files/${params.fileId}/${download ? "download" : "view"}`,
					{ headers },
				);
				if (!upstream.ok || !upstream.body)
					return new Response("Not found", { status: 404 });
				const { head, stream } = await peek(upstream.body);
				const inlineType = download ? null : sniff(head);
				const out = new Headers({
					"x-content-type-options": "nosniff",
					"content-security-policy":
						"sandbox; default-src 'none'; img-src 'self'",
					"cache-control": slug
						? "public, max-age=300"
						: "private, max-age=300",
				});
				const length = upstream.headers.get("content-length");
				if (length) out.set("content-length", length);
				if (inlineType) {
					out.set("content-type", inlineType);
				} else {
					out.set("content-type", "application/octet-stream");
					out.set(
						"content-disposition",
						`attachment; filename="${downloadName(upstream.headers)}"`,
					);
				}
				return new Response(stream, { status: 200, headers: out });
			},
		},
	},
});
