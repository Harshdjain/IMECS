# Contributing to IMECS

Thank you for your interest in contributing to the **Intelligent Multi-Layer Emergency Communication System (IMECS)**!

## 🛠️ Code of Conduct
Please be respectful, collaborative, and considerate when opening issues or pull requests.

## 🌿 Branching Strategy
- `main` / `master`: Production-ready releases.
- `feature/*`: New features and enhancements.
- `bugfix/*`: Bug fixes and hotfixes.

## 🧪 Development & Testing Workflow
1. Fork and clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the automated test suite before committing:
   ```bash
   npm test
   ```
4. Verify that all tests pass without errors.
5. Create a descriptive commit message following Conventional Commits (e.g. `feat: ...`, `fix: ...`, `docs: ...`).

## 📬 Submitting Pull Requests
- Ensure PR targets `main` or `master`.
- Include a summary of changes, motivation, and test results.
- Verify environment variables are documented in `.env.example`.
