# Development Guide

## Baseline

The public source baseline is commit d2bc481 from the private development repository.

## Development principles

1. Commands require explicit user approval.
2. Commands must never execute automatically.
3. Results must never be automatically submitted to ChatGPT.
4. Workspace restrictions must remain enforced.
5. Local bridge binding should remain restricted to localhost.

## Validation

Run the executor security tests and JavaScript syntax checks before release.
