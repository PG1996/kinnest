# Kinnest

Lifelong family logbook for a child. See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for plans.

## Dev

```
export PATH=/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH   # if docker is not on PATH
cp .env.example .env
docker-compose -f deploy/docker-compose.yml up -d --build
curl localhost:8000/api/health
```

Backend tests: `cd backend && uv venv --python 3.12 .venv && uv pip install -p .venv/bin/python -e '.[dev]' && .venv/bin/pytest`
(needs the `db` container running; it listens on localhost:5433).
