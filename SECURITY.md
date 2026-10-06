# Security Policy

## Overview

This project executes shell commands in a configured WSL workspace. Commands require explicit user approval before execution.

## Security model

- Detected commands are not executed automatically.
- The user reviews the command before execution.
- The HTTP bridge binds to 127.0.0.1.
- Executor operations are workspace-restricted.
- Sensitive directory names are blocked by the executor.
- Command, output, file-size, directory-entry, and timeout limits are enforced.

## Important limitation

Approved commands execute with the permissions of the configured WSL user. This project is not a complete operating-system sandbox.

## Reporting vulnerabilities

Please report security vulnerabilities privately through the GitHub repository security mechanism when available. Do not include credentials or secrets in reports.
