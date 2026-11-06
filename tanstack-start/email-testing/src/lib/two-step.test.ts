import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";
import {
	groupSecret,
	otpauthLabel,
	readAnyCode,
	readCode,
	recoveryCodesFile,
} from "./two-step";

describe("readCode", () => {
	it("takes 6 digits from an app, with spaces or a dash", () => {
		expect(readCode("123456", "totp")).toBe("123456");
		expect(readCode(" 123 456 ", "totp")).toBe("123456");
		expect(readCode("123-456", "totp")).toBe("123456");
		expect(readCode("12345", "totp")).toBeNull();
		expect(readCode("12345a", "totp")).toBeNull();
	});

	it("takes 10 hex characters for a recovery code, in any case", () => {
		expect(readCode("A1B2C-3D4E5", "recovery")).toBe("a1b2c3d4e5");
		expect(readCode("a1b2c3d4e", "recovery")).toBeNull();
		expect(readCode("a1b2c3d4eg", "recovery")).toBeNull();
	});

	it("tells the two apart where either works", () => {
		expect(readAnyCode("123 456")).toEqual({ kind: "totp", code: "123456" });
		expect(readAnyCode("0A1B2C3D4E")).toEqual({
			kind: "recovery",
			code: "0a1b2c3d4e",
		});
		expect(readAnyCode("1234567")).toBeNull();
	});
});

describe("groupSecret", () => {
	it("splits the key into groups of four", () => {
		expect(groupSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PX")).toBe(
			"JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PX",
		);
	});
});

describe("otpauthLabel", () => {
	it("reads Appwrite's label, with the colon encoded or not", () => {
		const encoded =
			"otpauth://totp/Kestrel%20QA%3Aana%40kestrel.dev?issuer=Kestrel%20QA&secret=JBSWY3DPEHPK3PXP";
		expect(otpauthLabel(encoded)).toEqual({
			issuer: "Kestrel QA",
			account: "ana@kestrel.dev",
		});
		const plain =
			"otpauth://totp/Kestrel%20QA:ana%40kestrel.dev?secret=JBSWY3DPEHPK3PXP";
		expect(otpauthLabel(plain)).toEqual({
			issuer: "Kestrel QA",
			account: "ana@kestrel.dev",
		});
	});

	it("copes with a bare label or a broken URI", () => {
		expect(otpauthLabel("otpauth://totp/ana%40kestrel.dev?secret=X")).toEqual({
			issuer: null,
			account: "ana@kestrel.dev",
		});
		expect(otpauthLabel("not a uri")).toEqual({ issuer: null, account: null });
	});
});

describe("qrPath", () => {
	const uri =
		"otpauth://totp/Kestrel%20QA%3Aana%40kestrel.dev?issuer=Kestrel%20QA&secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

	it("draws a QR code grid of a valid size", () => {
		const { size, path } = qrPath(uri);
		expect((size - 17) % 4).toBe(0);
		expect(size).toBeGreaterThanOrEqual(21);
		// Every QR code starts with the 7-module finder pattern in the top-left corner.
		expect(path.startsWith("M0 0h7v1h-7z")).toBe(true);
	});

	it("draws the same code every time", () => {
		expect(qrPath(uri)).toEqual(qrPath(uri));
		expect(qrPath(uri).path).not.toEqual(qrPath(`${uri}A`).path);
	});
});

describe("recoveryCodesFile", () => {
	it("lists the codes with who and where they're for", () => {
		const text = recoveryCodesFile(["0a1b2c3d4e", "5f6a7b8c9d"], {
			email: "ana@kestrel.dev",
			site: "inbox.kestrel.dev",
			date: new Date("2026-11-03T12:00:00Z"),
		});
		expect(text).toContain("Catchall recovery codes for ana@kestrel.dev");
		expect(text).toContain("inbox.kestrel.dev, created 2026-11-03");
		expect(text.trim().split("\n").slice(-2)).toEqual([
			"0a1b2c3d4e",
			"5f6a7b8c9d",
		]);
	});
});
