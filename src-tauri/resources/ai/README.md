# Local AI Assets

The desktop app can bundle a local llama.cpp runtime and a GGUF model, but those files are intentionally not committed to git because they are large binary artifacts.

Expected local layout when building a full installer:

```text
src-tauri/resources/ai/bin/llama-server.exe
src-tauri/resources/ai/models/qwen2.5-3b-instruct-q3_k_m.gguf
```

The current release installer keeps these files inside the package. Source control should keep only code, docs, recipe data, and this placeholder.
