# Licence and data-use record

- Runtime container: NVIDIA NGC vLLM container; use is subject to the NVIDIA Deep Learning Container and NGC terms shown with the image. Review them before redistribution. Do not redistribute the container inside this repository.
- Runtime software: vLLM and its bundled dependencies retain their upstream licences. Capture `/opt/vllm/LICENSE` and installed-package metadata from the running container when available.
- Primary model: `Qwen/Qwen3-4B-Instruct-2507`, pinned revision `cdbee75f17c01a7cc42f958dc650907174af0554`, Apache-2.0.
- Reduced model: `Qwen/Qwen3-0.6B`, pinned revision `c1899de289a04d12100db370d81485cdf75e47ca`, Apache-2.0.
- Prompt set: original synthetic prompts in `data/prompts.jsonl`, dedicated to the public domain under CC0-1.0. It contains no customer, production, personal, confidential, or operational incident data.
- Generated outputs: treat as untrusted model output. Do not use the outputs to make operational leak, cyber-response, safety, legal, medical, or financial decisions.

Before publishing, record the image digest, retain model cards/licences, scan the repository for secrets, and publish only redacted synthetic results.
