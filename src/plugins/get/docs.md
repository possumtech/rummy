## <get>[path/to/file]</get> - Load a file or entry into context
Example: <get>docs/example.txt</get>
Example: <get>known://auth_flow</get>
Example: <get path="src/**/*.js" preview/> (list matching files without loading)
Example: <get path="src/*.js" preview>TODO</get> (find files containing TODO)
Example: <get path="known://*">auth</get> (recall stored knowledge by matching keyword or pattern)
* Paths accept globs: `src/**/*.js`, `known://api_*`
* Adding `preview` shows matches without loading into context
* Filter by content: <get path="pattern">search text</get>
* Use "known://" paths to recall stored information
* When irrelevant, use <set path="..." stored/> to archive from context
