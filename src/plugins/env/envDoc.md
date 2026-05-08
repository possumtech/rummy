## <env>[command]</env> - Run an exploratory shell command

Example:
	<env><<EOF
	npm --version
	node --version
	git log --oneline -3
	EOF</env>
<!-- Heredoc body is opaque — embed multi-line scripts and special characters without escaping. Output co-locates at env://turn_N/<slug>. -->

YOU MUST NOT use <env></env> to read or list files — use <get path="*"/> instead
YOU MUST NOT use <env></env> for commands with side effects
