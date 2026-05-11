## <get path="[path]"/> - Read an entry's content into the log

YOU MUST check the `tokens` of the target entry and the turn's `tokensFree` to avoid a budget overflow error.
YOU SHOULD use the `line`/`limit` functionality to read slices of the entry when `tokensFree` is low.

Example: <get path="*.md"/>
Example: <get path="src/agent/AgentLoop.js" line="644" limit="80"/>
Example: <get path="known://*">auth</get>
Example: <get path="src/**/!(*.test).js" manifest>auth</get>
Example: <get path="log://*/*/*/sh/**" manifest/>
