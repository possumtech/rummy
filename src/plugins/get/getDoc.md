## <get path="[path]"/> - Read an entry's content into the log

YOU MUST check the `tokens` of the target entry and the turn's `tokensFree` to avoid a budget overflow error.
YOU SHOULD use `lineFirst`/`lineFinal` to read a chunk of the entry per turn when `tokensFree` is low.

Example: <get path="*.md"/>
Example: <get path="src/agent/hugeFile.js" lineFirst="2001" lineFinal="3000"/>
Example: <get path="known://*">auth</get>
Example: <get path="src/**/!(*.test).js" manifest>auth</get>
Example: <get path="log://*/*/*/sh/**" manifest/>
