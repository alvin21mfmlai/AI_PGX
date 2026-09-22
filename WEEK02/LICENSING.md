# Licensing and publication boundaries

This package contains newly authored experiment scripts, instructions and configuration, not copied NVIDIA code. Suggested publication licence: MIT for code and CC BY 4.0 for prose and synthetic measurement outputs, subject to Alvin's approval before public release. No licence is asserted over third-party components by this suggestion.

There is no downloaded model checkpoint and no external dataset this week. Inputs are pseudo-random numerical matrices generated from the recorded seed, with no personal or customer records. Generated raw telemetry can reveal machine identifiers and installed software; review before publication. No training-data or model-weight licence applies to the synthetic workload.

The NVIDIA container and included components retain NVIDIA and third-party terms. Review the NGC container terms and bundled notices before pulling, using or redistributing. PyTorch has its own BSD-style licence and third-party notices. Do not redistribute the container, its full filesystem, or proprietary components as part of a GitHub source release.

- NVIDIA terms: https://catalog.ngc.nvidia.com/orgs/nvidia/containers/pytorch
- PyTorch licence: https://github.com/pytorch/pytorch/blob/main/LICENSE

No cyber targets, packets, credentials, confidential RAG corpus, Bentley material or utility customer data are required. Compute containers use network isolation, no Docker socket mount, no privileged mode, and only the project directory is mounted. Optional report serving is localhost-only. This is a performance lab, not a security boundary against a hostile container image; use trusted official images.
