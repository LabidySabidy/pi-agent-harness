# Global Standards

Default acceptance gates and capability mappings. Project-specific `STANDARDS.md` overrides anything here for that project.

## Capability mapping

Used by skills, the spawn extension (when active), and any place a capability is referenced. Maps abstract capability tags to concrete provider/model identifiers.

| Capability | Provider/Model | Use for |
|---|---|---|
| `reasoning` | `deepseek/deepseek-v4` | Default thinking; primary work |
| `hard-reasoning` | `deepseek/deepseek-reasoner` (R1) | Genuinely hard problems requiring step-by-step reasoning |
| `fast` | `deepseek/deepseek-v4` (with low temperature) | Quick lookups, simple classifications |
| `cheap-bulk` | `nvidia_nim/z-ai/glm4.7` (free tier via OpenRouter) | Research-trawling, boilerplate, routine PR updates |
| `escalation` | (not configured) | Reserved for future Claude reintegration |

When a contract or skill references a capability, resolve to the model on the right.

## Authoritative references

When gates conflict or guidance is ambiguous, these external sources win:

- **Security**: OWASP Top 10 (current)
- **Accessibility**: WCAG 2.2 AA
- **React**: [react.dev](https://react.dev) official patterns
- **Angular**: [angular.dev](https://angular.dev) official guides
- **Spring**: [spring.io](https://spring.io/guides) official guides
- **Python**: PEP 8 + the project's own style config (ruff/black config in `pyproject.toml`)
- **Java**: Effective Java (Bloch) for design idioms; project's `checkstyle.xml` for style

## Default acceptance gates by stack

Run these before claiming work is complete. Failure output is input to your next attempt — never re-run the same change without addressing the specific failure.

### Java / Spring Boot

```
Lint:    mvn checkstyle:check
Tests:   mvn test
Build:   mvn package -DskipTests=false
Security: mvn dependency-check:check (if plugin configured)
```

### TypeScript (React or Angular)

```
Lint:    npm run lint
Type:    tsc --noEmit (or `npx tsc --noEmit`)
Tests:   npm test
Build:   npm run build
Security: npm audit --audit-level=high
```

### Python / Flask

```
Lint:    ruff check . (fall back to: python -m flake8 src/)
Tests:   pytest src/tests/ -v (or pytest if no src layout)
Type:    mypy src/ (if mypy configured in project)
Security: pip-audit (fall back to: safety check)
```

## Gate execution rules

1. **Order matters**: Lint → Type → Tests → Build → Security. Cheap checks first.
2. **Stop at first failure**, fix, then continue from where you stopped.
3. **Treat warnings as warnings**, not blockers — note them, but don't loop on them unless I ask.
4. **For destructive commands** (`rm`, `git push --force`, `psql DROP`), confirm with me before running, even if a gate seems to require it.

## When project STANDARDS.md is missing

If a project doesn't have its own `STANDARDS.md`:

1. Detect the stack from project files (`package.json`, `pom.xml`, `pyproject.toml`, `requirements.txt`, etc.)
2. Apply the matching defaults from above
3. Surface this to me at session start: "No project STANDARDS.md found. Using global defaults for `<stack>`."
4. If the project clearly uses a stack not covered here, ask me what gates to run rather than guessing.

## When project STANDARDS.md exists

The project file overrides this one for that project. Project file should specify only the things that differ from defaults — additions, exceptions, or replacements.

## Capability mapping changes

If I tell you to use a different model for a session (e.g., "use Haiku for this"), honor that for the rest of the session and treat it as a temporary override of the mapping above. Don't persist it to STANDARDS.md without explicit instruction.
