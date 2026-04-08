# crunch

Mid-cascade entry summarization. When the budget cascade demotes known entries
from full to summary fidelity, this plugin compresses their bodies into ≤80-char
keyword strings and stores them as `attributes.summary`. The existing
ToolRegistry fallback renders these summaries automatically at summary fidelity.

Not a model-facing tool. No scheme registration. Subscribes to `cascade.summarize`.
