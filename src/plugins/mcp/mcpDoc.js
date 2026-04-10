const LINES = [
	["* get: URL or git repo to install from.", "The source of the MCP server."],
	[
		"* name: Local name for the server.",
		"Used to identify the server in subsequent calls.",
	],
	[
		'<mcp get="https://github.com/modelcontextprotocol/servers/tree/main/src/github" name="github"/>',
		"Example: proposing installation of a GitHub MCP server",
	],
	[
		'<mcp name="github"/>',
		"Example: listing available tools for an installed server",
	],
	[
		"* Installation requires user approval (202 proposed).",
		"Aligns with the proposed status paradigm.",
	],
];
export default LINES.map(([text]) => text).join("\n");
