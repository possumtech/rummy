# Advanced Patterns
* Paths accept globs: `src/**/*.js`, `known://api_*`
* Body attributes filter by content: `<get path="src/*.js" body="TODO"/>`
* Regex patterns use /slashes/: `<get path="/\.test\.js$/" preview/>`
* Adding `preview` shows matches without making changes
* Chain multiple replacements: `s/old/new/ s/foo/bar/`
Example: <get path="src/**/*.js" body="TODO" preview/> (list js files containing TODO)
Example: <store path="src/**/*.test.js"/> (store all test files)
Example: <rm path="known://temp_*" preview/> (preview which temp entries would be deleted)
