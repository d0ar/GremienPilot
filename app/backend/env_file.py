"""
Minimal .env loader for local backend development.

Nothing else in the project reads app/backend/.env: Docker Compose only
substitutes the repository root .env into docker-compose.yml, and the
documented local start command is a plain `uv run uvicorn main:app`. A
developer who set LLM_NUM_CTX (or any other LLM_* variable) in
app/backend/.env therefore got the defaults, with no hint that the file was
never read.

Real environment variables always win, so Compose, Kubernetes and an inline
`VAR=value uv run ...` keep overriding the file.
"""

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_ENV_PATH = Path(__file__).resolve().parent / ".env"


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def load_env_file(path: Path | None = None) -> dict[str, str]:
    """
    Apply KEY=VALUE lines from `path` to os.environ and return what was set.

    Missing files are not an error - the file is optional everywhere.
    """
    env_path = DEFAULT_ENV_PATH if path is None else path
    try:
        raw = env_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    except OSError as error:
        logger.warning("Could not read %s: %s", env_path, error)
        return {}

    applied: dict[str, str] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        # "export KEY=value" is common enough in hand-edited .env files.
        if stripped.startswith("export "):
            stripped = stripped[len("export ") :].lstrip()
        key, _, value = stripped.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = _unquote(value.strip())
        applied[key] = os.environ[key]

    if applied:
        logger.info(
            "Loaded %d variable(s) from %s: %s",
            len(applied),
            env_path,
            ", ".join(sorted(applied)),
        )
    return applied
