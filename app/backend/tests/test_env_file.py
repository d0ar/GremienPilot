import os

import env_file
import pytest


@pytest.fixture
def isolated_environ(monkeypatch):
    """
    Give load_env_file a throwaway os.environ.

    It writes keys that were not set before, which monkeypatch.delenv cannot
    restore, so the real environment would leak into later tests.
    """
    environ: dict[str, str] = {}
    monkeypatch.setattr(os, "environ", environ)
    return environ


def test_load_env_file_applies_variables_from_the_file(tmp_path, isolated_environ):
    path = tmp_path / ".env"
    path.write_text(
        "# Kontextgroesse\n"
        "LLM_CONTEXT_TOKENS=32768\n"
        "\n"
        'export LLM_MODEL="qwen3:8b"\n'
        "MALFORMED_LINE\n",
        encoding="utf-8",
    )

    applied = env_file.load_env_file(path)

    assert applied == {"LLM_CONTEXT_TOKENS": "32768", "LLM_MODEL": "qwen3:8b"}
    assert isolated_environ["LLM_CONTEXT_TOKENS"] == "32768"
    assert isolated_environ["LLM_MODEL"] == "qwen3:8b"


def test_load_env_file_never_overrides_the_real_environment(tmp_path, isolated_environ):
    # Compose, Kubernetes and an inline VAR=value start command have to win
    # over a file that may be a stale local copy.
    path = tmp_path / ".env"
    path.write_text("LLM_CONTEXT_TOKENS=4096\n", encoding="utf-8")
    isolated_environ["LLM_CONTEXT_TOKENS"] = "32768"

    assert env_file.load_env_file(path) == {}
    assert isolated_environ["LLM_CONTEXT_TOKENS"] == "32768"


def test_load_env_file_tolerates_a_missing_file(tmp_path, isolated_environ):
    assert env_file.load_env_file(tmp_path / "absent.env") == {}
