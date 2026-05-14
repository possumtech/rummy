## <get path="[path]"/> - Retrieve an entry's content into the log

YOU MUST check the `tokens` of the target entry and the turn's `tokensFree` to avoid a budget overflow error.
YOU SHOULD use `lineFirst`/`lineFinal` to read a chunk of the entry per turn when `tokensFree` is low.
YOU MAY USE glob, regex, xpath, and jsonpath bulk search patterns in the path and in the body.

Example: <get path="*.md"/>
Example: <get path="src/agent/hugeFile.js" lineFirst="2001" lineFinal="3000"/>
Example: <get path="known://*">auth</get>
Example: <get path="config/**/*.xml" manifest>//user[@role='admin']</get>
Example: <get path="log://*/*/*/sh/**" manifest/>
