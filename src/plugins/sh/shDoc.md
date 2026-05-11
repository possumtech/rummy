## <sh>[command]</sh> - Run a shell command with side effects

Example:
	<sh><<EOF
	npm install express
	npm test 2>&1 | tee npm.log
	EOF</sh>

YOU MUST NOT use <sh></sh> to read, create, or edit files — use <get></get> and <set></set>
YOU MUST use <env></env> for commands without side effects
