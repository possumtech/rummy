import assert from "node:assert";
import test from "node:test";
import ResponseParser from "../src/application/agent/ResponseParser.js";

test("ResponseParser Mangled Tag Recovery", async (t) => {
    const parser = new ResponseParser();

    await t.test("should recover from unclosed self-closing tag like <unknown/", () => {
        const content = "<tasks>- [x] Done</tasks><known>Fact</known><unknown/";
        const tags = parser.parseActionTags(content);
        
        const unknownTag = tags.find(t => t.tagName === "unknown");
        assert.ok(unknownTag, "Should find 'unknown' tag");
    });

    await t.test("should recover from standalone closing tag like </summary>", () => {
        const content = "<tasks>- [x] Done</tasks><known>Fact</known><unknown/>\n</summary>The actual summary";
        const tags = parser.parseActionTags(content);
        
        const summaryTag = tags.find(t => t.tagName === "summary");
        assert.ok(summaryTag, "Should find 'summary' tag even if it only has a closing tag");
        assert.strictEqual(summaryTag.childNodes[0].value, "The actual summary");
    });

    await t.test("should recover from missing opening bracket like unknown/>", () => {
        const content = "<tasks>- [x] Done</tasks><known>Fact</known>unknown/>";
        const tags = parser.parseActionTags(content);
        
        const unknownTag = tags.find(t => t.tagName === "unknown");
        assert.ok(unknownTag, "Should find 'unknown' tag");
    });
});
