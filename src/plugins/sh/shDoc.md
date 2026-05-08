## <sh>[command]</sh> - Run a shell command with side effects

Example:
	<sh><<EOF
	npm install express
	npm test 2>&1 | tee npm.log
	EOF</sh>
Example: <get path="sh://turn_N/*" line="-50"/>
<!-- Heredoc body is opaque — embed multi-line scripts, redirects, and special characters without escaping. Output is addressable: every <sh> result lives at sh://turn_N/<slug>. Slice with line/limit instead of re-running. -->

YOU MUST NOT use <sh></sh> to read, create, or edit files — use <get></get> and <set></set>
YOU MUST use <env></env> for commands without side effects
