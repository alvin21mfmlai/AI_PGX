# 2–3 minute demo script

1. **Platform and pinning (25 s):** show `uname -m`, `manifests/image-ref.txt`, and the SM121 gate JSON. Explain that Arm64 plus a generic Blackwell label is insufficient.
2. **Local service (30 s):** run `bash run_week04.sh status`, highlight `127.0.0.1:8004`, and show the smoke response.
3. **Workload (40 s):** show the synthetic prompt file and launch/describe the concurrency sweep. State that all responses, including failures, are retained.
4. **Results (45 s):** open `summary.json`, `summary.csv`, and `throughput_by_concurrency.svg`. Report throughput speedup, p95 latency, strict-JSON accuracy and CV together.
5. **Limits and next step (30 s):** show the risk card. State that this is a local serving baseline, not confidential RAG, an autonomous agent, or a production water/cyber decision system.
