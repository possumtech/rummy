## <env>[command]</env> - Run an exploratory shell command

Example:
	<env><<EOF
	npm --version
	node --version
	git log --oneline -3
	EOF</env>

YOU MUST NOT use <env></env> to read or list files — use <get path="*"/> instead.
YOU MUST NOT use <env></env> for commands with side effects.
