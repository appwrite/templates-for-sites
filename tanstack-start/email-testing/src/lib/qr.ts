import qrcode from "qrcode-generator";

// A QR code as one SVG path in a size × size grid, with dark runs in each row merged into one
// rectangle. Medium error correction, like most authenticator setup codes.
export function qrPath(text: string): { size: number; path: string } {
	const qr = qrcode(0, "M");
	qr.addData(text);
	qr.make();
	const size = qr.getModuleCount();
	let path = "";
	for (let row = 0; row < size; row++) {
		let col = 0;
		while (col < size) {
			if (!qr.isDark(row, col)) {
				col++;
				continue;
			}
			const start = col;
			while (col < size && qr.isDark(row, col)) col++;
			path += `M${start} ${row}h${col - start}v1h${start - col}z`;
		}
	}
	return { size, path };
}
