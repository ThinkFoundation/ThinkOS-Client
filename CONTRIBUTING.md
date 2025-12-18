# Contributing to Think

Thanks for your interest in contributing!

## Reporting Issues

Before opening an issue, search existing issues to avoid duplicates.

**Use the issue templates:**
- **Bug Report** - Something isn't working as expected
- **Feature Request** - Suggest a new feature or enhancement
- **Documentation** - Report missing or unclear docs

Blank issues are disabled - please use one of the templates above.

## Development Setup

See the [README](README.md) for setup instructions.

## Project Structure

```
think/
├── app/           # Electron desktop app (macOS/Windows)
├── extension/     # Chrome Extension (Manifest V3)
├── backend/       # Python FastAPI backend
├── scripts/       # Build and release scripts
└── docs/          # Documentation
```

## Making Changes

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint.

**Format:** `<type>(<scope>): <description>`

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Scopes:**
- `app` - Electron desktop app
- `backend` - Python backend
- `extension` - Chrome extension
- `release` - Release-related changes
- `deps` - Dependency updates

**Examples:**
```bash
git commit -m "feat(app): add keyboard shortcuts for navigation"
git commit -m "fix(backend): handle empty memory search results"
git commit -m "chore(deps): update electron to v34"
```

### Creating a Changeset

Every PR that changes functionality should include a changeset.

1. **After making your changes, create a changeset:**
   ```bash
   pnpm changeset
   ```

2. **Select the packages affected** (usually both for unified versioning)

3. **Choose the bump type:**
   - `patch` - Bug fixes, small improvements
   - `minor` - New features, non-breaking changes
   - `major` - Breaking changes

4. **Write a summary** of your changes (this appears in the changelog)

5. **Commit the changeset file** along with your code changes

## Pull Requests

**Every PR must reference an Issue.** CI will fail if no issue is linked.

1. Create an issue first (bug, feature, or docs)
2. Fork the repo and create your branch from `main`
3. Make your changes
4. Run `pnpm changeset` to create a changeset
5. Test your changes locally
6. Submit a PR with `Closes #<issue-number>` in the description

## Code Style

- TypeScript/React: Follow existing patterns in the codebase
- Python: Follow PEP 8
- Keep changes focused and minimal

## Release Process (Maintainers)

Releases use Changesets with unified versioning across all components.

### How Releases Work

1. PRs with changesets merge to `main`
2. Changesets bot opens a "Version Packages" PR
3. Merge that PR when ready to release
4. A git tag is created and release workflow runs
5. CI builds macOS DMG and Chrome extension automatically
6. Review the draft GitHub Release and publish when ready

### Pre-release Versions

```bash
# Enter pre-release mode
pnpm changeset pre enter beta

# Versions will be like v0.2.0-beta.0

# Exit when ready for stable
pnpm changeset pre exit
```

### Manual Release (Fallback)

```bash
pnpm version
git add -A
git commit -m "chore(release): v0.2.0"
git tag v0.2.0
git push && git push --tags
```
