from fastapi.testclient import TestClient
import pytest

import highlight_terms
import main
import persistence


URL = "/api/settings/highlight-terms"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PERSISTENCE_DB_PATH", str(tmp_path / "sessions.sqlite3"))
    persistence.init_db()
    return TestClient(main.app)


def test_get_returns_empty_list_with_revision_zero_initially(client):
    response = client.get(URL)

    assert response.status_code == 200
    assert response.json() == {"terms": [], "revision": 0}


def test_put_normalizes_terms_and_bumps_revision(client):
    response = client.put(
        URL,
        json={
            "terms": [
                "  Haushalt  ",
                "",
                "   ",
                "*",
                "haushalt",
                "Rat*",
                "Bebauungs   plan",
                "Straße",
                "STRASSE",
            ],
            "revision": 0,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "terms": ["Haushalt", "Rat*", "Bebauungs plan", "Straße", "STRASSE"],
        "revision": 1,
    }
    assert client.get(URL).json() == response.json()

    second = client.put(URL, json={"terms": ["Kita"], "revision": 1})
    assert second.json() == {"terms": ["Kita"], "revision": 2}


def test_put_with_stale_revision_returns_conflict_with_current_list(client):
    client.put(URL, json={"terms": ["Haushalt"], "revision": 0})
    client.put(URL, json={"terms": ["Haushalt", "Kita"], "revision": 1})

    stale = client.put(URL, json={"terms": ["Feuerwehr"], "revision": 1})

    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["terms"] == ["Haushalt", "Kita"]
    assert detail["revision"] == 2
    assert "zwischenzeitlich geändert" in detail["message"]
    assert client.get(URL).json() == {"terms": ["Haushalt", "Kita"], "revision": 2}

    # Last writer wins after confirming: resend with the revision from the conflict.
    overwrite = client.put(URL, json={"terms": ["Feuerwehr"], "revision": 2})
    assert overwrite.status_code == 200
    assert overwrite.json() == {"terms": ["Feuerwehr"], "revision": 3}


def test_put_rejects_revision_ahead_of_server(client):
    response = client.put(URL, json={"terms": ["Haushalt"], "revision": 5})

    assert response.status_code == 409
    assert response.json()["detail"]["revision"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"terms": ["x" * (highlight_terms.MAX_TERM_LENGTH + 1)], "revision": 0},
        {"terms": [f"Begriff {index}" for index in range(highlight_terms.MAX_TERMS + 1)], "revision": 0},
        {"terms": "Haushalt", "revision": 0},
        {"terms": ["Haushalt"], "revision": -1},
        {"terms": ["Haushalt"], "revision": "1"},
        {"terms": ["Haushalt"]},
    ],
)
def test_put_validates_payload(client, payload):
    response = client.put(URL, json=payload)

    assert response.status_code == 422
    assert client.get(URL).json() == {"terms": [], "revision": 0}


def test_terms_persist_across_reinitialization(tmp_path, monkeypatch, client):
    client.put(URL, json={"terms": ["Haushalt", "*rat*"], "revision": 0})

    # Simulates a server restart: migration must keep the stored list.
    persistence.init_db()

    assert persistence.load_setting("highlight_terms")["value"] == ["Haushalt", "*rat*"]
    assert TestClient(main.app).get(URL).json() == {
        "terms": ["Haushalt", "*rat*"],
        "revision": 1,
    }


def test_save_setting_conflict_leaves_value_unchanged(tmp_path):
    db_path = tmp_path / "settings.sqlite3"
    persistence.init_db(db_path)
    persistence.save_setting("demo", ["a"], expected_revision=0, db_path=db_path)

    with pytest.raises(persistence.SettingConflictError) as error:
        persistence.save_setting("demo", ["b"], expected_revision=0, db_path=db_path)

    assert error.value.current["value"] == ["a"]
    assert error.value.current["revision"] == 1
    assert persistence.load_setting("demo", db_path=db_path)["value"] == ["a"]


def test_normalize_keeps_order_and_first_spelling():
    assert highlight_terms.normalize_highlight_terms(
        ["Ökologie", "ÖKOLOGIE", "  *rat ", "Rat*", "rat*"]
    ) == ["Ökologie", "*rat", "Rat*"]
