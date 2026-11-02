import { gzipSync } from "node:zlib";
import packageJson from "../../function/package.json?raw";
import extractJs from "../../function/src/extract.js?raw";
import mainJs from "../../function/src/main.js?raw";

// The function's source ships inside the site build, so setup can deploy it without the Console.
const FILES = [
	{ path: "package.json", content: packageJson },
	{ path: "src/main.js", content: mainJs },
	{ path: "src/extract.js", content: extractJs },
];

function octal(value: number, length: number) {
	return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function header(path: string, size: number, mtime: number) {
	const block = Buffer.alloc(512);
	block.write(path, 0, 100, "utf8");
	block.write(octal(0o644, 8), 100);
	block.write(octal(0, 8), 108);
	block.write(octal(0, 8), 116);
	block.write(octal(size, 12), 124);
	block.write(octal(mtime, 12), 136);
	block.write("        ", 148);
	block.write("0", 156);
	block.write("ustar\0", 257);
	block.write("00", 263);
	let sum = 0;
	for (const byte of block) sum += byte;
	block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
	return block;
}

export function functionArchive() {
	const mtime = Math.floor(Date.now() / 1000);
	const parts: Buffer[] = [];
	for (const file of FILES) {
		const data = Buffer.from(file.content, "utf8");
		parts.push(
			header(file.path, data.length, mtime),
			data,
			Buffer.alloc((512 - (data.length % 512)) % 512),
		);
	}
	parts.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(parts));
}
