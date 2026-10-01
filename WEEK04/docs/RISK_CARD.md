# Week 4 risk card

Complete after the run; preserve failures and mitigations.

| Risk | Evidence to review | Default mitigation | Residual limitation |
|---|---|---|---|
| API exposed beyond the PGX | `ss -ltnp 'sport = :8004'`, Docker port map | Bind `127.0.0.1:8004:8000`; never publish `8004:8000` | Any local process can still call the endpoint |
| Docker privilege | Docker-group membership | Use only on a trusted personal workstation; do not expose Docker socket | Docker group is root-equivalent |
| Supply-chain drift | Image digest, model revision, source checksums | Pull once, record digest, serve offline, export manifests | Registries and upstream licences remain external dependencies |
| Unsupported SM121 kernel | Gate JSON, startup/inference logs | Require actual capability 12.1 BF16 operation and model inference | Gate does not exercise every runtime kernel |
| Unified-memory exhaustion | `free`, telemetry, container/server logs | 0.70 utilization, 8K context, max eight sequences; reduced fallback | OS, CPU and GPU still compete for one memory pool |
| Hallucination or malformed output | Raw responses and strict-JSON scores | Treat outputs as untrusted; human validation; no operational decisions | Small synthetic suite cannot establish general reliability |
| Synthetic-to-real gap | Dataset record and prompt review | Clearly label synthetic scope; no production claims | No evidence of performance on real utility/cyber data |
| Privacy or data leakage | Prompt/data review, repository scan | CC0 synthetic prompts only; offline serving; redact manifests | Model weights may contain unknown pretraining content |
| Licence breach | `LICENSING.md`, model card, NGC terms | Retain notices; do not redistribute model/container; publish code/results only | User remains responsible for downstream redistribution terms |
| Benchmark misinterpretation | Summary definitions and raw results | Report latency, throughput, quality and CV together; keep all runs | Not MLPerf; non-streaming client does not measure TTFT |
| Unsafe cyber use | Prompt set and outputs | Isolated synthetic lab framing; no credentials, targets or autonomous actions | Future agent work requires separate authorization and guardrails |

Decision after run: **REPLACE_WITH_GO / CONDITIONAL / NO-GO**

Rationale: **REPLACE_WITH_EVIDENCE-BASED_SUMMARY**
