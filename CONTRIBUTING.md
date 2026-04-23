# Contributing

Thanks for your interest in contributing to Immich Public Proxy.

## Development Setup

1. Install prerequisites:
   - Go 1.22+
   - Node.js 22+
   - npm
   - `just` (optional but recommended)
2. Install dependencies:
   ```bash
   just install
   ```
3. Build everything:
   ```bash
   just build
   ```
4. Run tests:
   ```bash
   just test
   ```

## Branch and PR Workflow

1. Create a branch from `main`.
2. Keep changes focused and atomic.
3. Add or update tests for behavior changes.
4. Run `just test` before opening a PR.
5. Open a pull request using the PR template.

## Commit Messages

- Use clear, descriptive messages in imperative mood.
- Reference issues when relevant (for example: `Fixes #123`).

## Coding Guidelines

- Prefer small, composable functions over large handlers.
- Preserve existing naming and folder conventions.
- Do not introduce breaking behavior without documenting it in the PR.
- Update docs (`README.md` and `docs/`) when behavior or configuration changes.

## Reporting Bugs and Security Issues

- For regular bugs/features, use GitHub Issues.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md).
