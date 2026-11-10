import { afterEach, describe, expect, it } from "vitest";
import { assertPublicUrl, BlockedAddress } from "./net-guard";

afterEach(() => {
	delete process.env.LIVEPAGE_AI_ALLOW_PRIVATE_HOSTS;
});

describe("assertPublicUrl", () => {
	it.each([
		"http://127.0.0.1/v1",
		"http://10.1.2.3/v1",
		"http://172.16.0.1/v1",
		"http://192.168.1.1/v1",
		"http://169.254.169.254/latest",
		"http://100.64.0.1/v1",
		"http://[::1]/v1",
		"http://[fe80::1]/v1",
		"http://[fd00::1]/v1",
		"http://[::ffff:127.0.0.1]/v1",
		"http://metadata.google.internal/",
		"ftp://8.8.8.8/x",
	])("blocks %s", async (url) => {
		await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(BlockedAddress);
	});

	it("allows a public address", async () => {
		await expect(
			assertPublicUrl("https://8.8.8.8/v1"),
		).resolves.toBeUndefined();
	});

	it("allows only the exact host and port the owner approved", async () => {
		await expect(
			assertPublicUrl("http://10.0.0.5:8317/v1", "10.0.0.5:8317"),
		).resolves.toBeUndefined();
		await expect(
			assertPublicUrl("http://10.0.0.5:22/", "10.0.0.5:8317"),
		).rejects.toBeInstanceOf(BlockedAddress);
	});

	it("honours the env allowlist", async () => {
		process.env.LIVEPAGE_AI_ALLOW_PRIVATE_HOSTS = "gateway:8317";
		await expect(
			assertPublicUrl("http://gateway:8317/v1"),
		).resolves.toBeUndefined();
	});
});
