## <set path="{path}" tags="{tags}" {archive|index} {manifest}>{HEREDOC Block}</set> - Create, edit, or update an entry

HEREDOC Blocks:
* `<<NEW ... NEW` — create or overwrite entire body.
* `<<APPEND ... APPEND` — append content to the end.
* `<<PREPEND ... PREPEND` — prepend content to the start.
* `<<REPLACE[LineFirst] ... REPLACE[LineFinal]` — replace lines (only line numbers, NO text matching)
* `<<DELETE[LineFirst] ... DELETE[LineFinal]` — delete lines (empty body, only line numbers, NO text matching).

* `archive` archives the entry, optimizing context relevance and freeing `tokensFree`.
* `index` restores an entry from the archive, consuming `tokens="N"` tokens.

YOU SHOULD prefer minimal, atomic edits.
YOU MAY add alphanumeric character suffixes to the HEREDOC label to ensure uniqueness.
