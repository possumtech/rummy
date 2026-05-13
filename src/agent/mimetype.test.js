import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MIMETYPE, isBinary, isTextual } from "./mimetype.js";

describe("mimetype classifier", () => {
	describe("default", () => {
		it("DEFAULT_MIMETYPE is text/markdown", () => {
			assert.equal(DEFAULT_MIMETYPE, "text/markdown");
		});

		it("unset / null / empty is treated as textual (default applies)", () => {
			assert.equal(isTextual(null), true);
			assert.equal(isTextual(undefined), true);
			assert.equal(isTextual(""), true);
		});
	});

	describe("text/*", () => {
		it("text/markdown is textual", () => {
			assert.equal(isTextual("text/markdown"), true);
		});

		it("text/plain is textual", () => {
			assert.equal(isTextual("text/plain"), true);
		});

		it("text/html is textual", () => {
			assert.equal(isTextual("text/html"), true);
		});

		it("text/anything is textual", () => {
			assert.equal(isTextual("text/x-future-format"), true);
		});
	});

	describe("application/* allowlist", () => {
		it("application/json is textual", () => {
			assert.equal(isTextual("application/json"), true);
		});

		it("application/xml is textual", () => {
			assert.equal(isTextual("application/xml"), true);
		});

		it("application/yaml is textual", () => {
			assert.equal(isTextual("application/yaml"), true);
		});

		it("application/javascript is textual", () => {
			assert.equal(isTextual("application/javascript"), true);
		});

		it("application/typescript is textual", () => {
			assert.equal(isTextual("application/typescript"), true);
		});

		it("application/sql is textual", () => {
			assert.equal(isTextual("application/sql"), true);
		});

		it("application/x-sh is textual", () => {
			assert.equal(isTextual("application/x-sh"), true);
		});

		it("application/toml is textual", () => {
			assert.equal(isTextual("application/toml"), true);
		});
	});

	describe("RFC 6838 structured-syntax suffixes", () => {
		it("application/ld+json is textual", () => {
			assert.equal(isTextual("application/ld+json"), true);
		});

		it("application/vnd.api+json is textual", () => {
			assert.equal(isTextual("application/vnd.api+json"), true);
		});

		it("application/atom+xml is textual", () => {
			assert.equal(isTextual("application/atom+xml"), true);
		});

		it("application/vnd.kubernetes.protobuf+yaml is textual", () => {
			assert.equal(isTextual("application/vnd.kubernetes.protobuf+yaml"), true);
		});
	});

	describe("binary", () => {
		it("image/png is binary", () => {
			assert.equal(isTextual("image/png"), false);
			assert.equal(isBinary("image/png"), true);
		});

		it("image/jpeg is binary", () => {
			assert.equal(isBinary("image/jpeg"), true);
		});

		it("audio/mpeg is binary", () => {
			assert.equal(isBinary("audio/mpeg"), true);
		});

		it("video/mp4 is binary", () => {
			assert.equal(isBinary("video/mp4"), true);
		});

		it("application/pdf is binary", () => {
			assert.equal(isBinary("application/pdf"), true);
		});

		it("application/octet-stream is binary", () => {
			assert.equal(isBinary("application/octet-stream"), true);
		});

		it("application/zip is binary", () => {
			assert.equal(isBinary("application/zip"), true);
		});

		it("font/woff2 is binary", () => {
			assert.equal(isBinary("font/woff2"), true);
		});
	});

	describe("malformed", () => {
		it("no slash is binary (refuse to interpret)", () => {
			assert.equal(isBinary("nonsense"), true);
		});
	});
});
