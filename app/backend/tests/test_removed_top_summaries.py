"""Undo in the editor re-adds removed TOPs; their summary data must come back unchanged."""
import copy

import pytest
from fastapi.testclient import TestClient

import main
import persistence


def _link(index):
    return {'section': 'discussion', 'item_index': 0, 'item_text': f'Punkt {index}',
            'line_indices': [index], 'excerpt': f'Zeile {index}', 'confidence': 1.0,
            'missing_source': False}


def seed(session_id, count=2):
    """Store a session as the pipeline would, bypassing the editor reconciliation."""
    tops = [f'TOP {index + 1}' for index in range(count)]
    state = {
        'session_id': session_id, 'current_step': 2, 'skipped_assignment': False,
        'tops': tops, 'top_ids': [f'top-{index}' for index in range(count)],
        'transcript': [{'line_id': f'line-{index}', 'speaker': 'S1', 'text': f'Beratung {index}.',
                        'start': index, 'end': index + 1} for index in range(count)],
        'assignments': list(range(count)),
        'speaker_names': {'S1': 'Anna'},
        'summaries': {index: f'Zusammenfassung {index}.' for index in range(count)},
        'summary_reviews': {index: {'structured': None, 'source_links': [_link(index)],
                                    'review_warnings': [], 'llm_usage': {'origin': 'pipeline'}}
                            for index in range(count)},
    }
    state['summary_states'] = {}
    for index in range(count):
        snapshot, input_hash = main.current_summary_input(state, index)
        state['summary_states'][index] = {
            'top_id': f'top-{index}', 'status': 'ready', 'origin': 'pipeline',
            'input_hash': input_hash, 'current_input_hash': input_hash,
            'source_snapshot': snapshot, 'change_reasons': [], 'generated_at': 1000.0,
            'updated_at': 1000.0,
        }
    persistence.save_session(session_id, state)


def put(client, payload):
    response = client.put(f"/api/sessions/{payload['session_id']}", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def without(session, keep_indexes, *, merge_into=None):
    """Editor payload after deleting (or merging away) TOPs, like the frontend sends it."""
    payload = copy.deepcopy(session)
    keep = list(keep_indexes)
    new_index = {old: new for new, old in enumerate(keep)}
    payload['tops'] = [session['tops'][index] for index in keep]
    payload['top_ids'] = [session['top_ids'][index] for index in keep]
    if merge_into is not None:
        payload['tops'][new_index[merge_into]] = ' / '.join(
            title for index, title in enumerate(session['tops']) if index not in keep or index == merge_into)
    payload['assignments'] = [
        new_index.get(value, new_index[merge_into] if merge_into is not None else None)
        if value is not None else None
        for value in session['assignments']
    ]
    for key in ('summaries', 'summary_reviews', 'summary_states'):
        payload[key] = {str(new_index[int(index)]): value for index, value in session[key].items()
                        if int(index) in new_index}
    return payload


def restored(current, snapshot):
    """Editor payload after undo: the snapshot's TOP data on the latest revision."""
    payload = copy.deepcopy(snapshot)
    payload['revision'] = current['revision']
    return payload


def top_data(session, index):
    return (session['summaries'][str(index)], session['summary_reviews'][str(index)],
            session['summary_states'][str(index)])


@pytest.mark.parametrize('operation', ['delete', 'merge'])
def test_undo_restores_removed_top_summary_unchanged_across_saves(operation):
    client = TestClient(main.app)
    seed('undo-session')
    before = put(client, client.get('/api/sessions/undo-session').json())
    assert before['summary_states']['1']['origin'] == 'pipeline'

    removed = without(before, [0], merge_into=0 if operation == 'merge' else None)
    after_remove = put(client, removed)
    assert after_remove['top_ids'] == ['top-0']
    assert '1' not in after_remove['summaries']
    assert 'removed_top_summaries' not in after_remove
    # Further autosaves keep the bookkeeping.
    after_remove = put(client, after_remove)
    after_remove = put(client, after_remove)
    stored = persistence.load_session('undo-session')['removed_top_summaries']
    assert [entry['top_id'] for entry in stored] == ['top-1']

    after_undo = put(client, restored(after_remove, before))

    assert after_undo['top_ids'] == ['top-0', 'top-1']
    assert top_data(after_undo, 1) == top_data(before, 1)
    assert after_undo['summary_reviews']['1']['source_links'] == [_link(1)]
    assert after_undo['summary_states']['1']['origin'] == 'pipeline'
    assert after_undo['summary_states']['1']['updated_at'] == before['summary_states']['1']['updated_at']
    # The remaining TOP is back to its earlier input; only its timestamp moved on a merge.
    def unstamped(session):
        summary, review, state = top_data(session, 0)
        return summary, review, {key: value for key, value in state.items() if key != 'updated_at'}
    assert unstamped(after_undo) == unstamped(before)
    assert persistence.load_session('undo-session')['removed_top_summaries'] == []
    # And it stays that way on the next autosave.
    assert top_data(put(client, after_undo), 1) == top_data(before, 1)


def test_changed_text_on_restore_is_a_manual_edit():
    client = TestClient(main.app)
    seed('edited-session')
    before = put(client, client.get('/api/sessions/edited-session').json())
    after_remove = put(client, without(before, [0]))

    payload = restored(after_remove, before)
    payload['summaries']['1'] = 'Manuell geänderte Zusammenfassung.'
    after_undo = put(client, payload)

    assert after_undo['summaries']['1'] == 'Manuell geänderte Zusammenfassung.'
    assert after_undo['summary_states']['1']['origin'] == 'manual'
    assert after_undo['summary_states']['1']['updated_at'] > before['summary_states']['1']['updated_at']
    assert persistence.load_session('edited-session')['removed_top_summaries'] == []


def test_removed_top_bookkeeping_is_bounded():
    client = TestClient(main.app)
    count = main.MAX_REMOVED_TOP_SUMMARIES + 2
    seed('bounded-session', count)
    before = put(client, client.get('/api/sessions/bounded-session').json())

    after_remove = put(client, without(before, [0]))
    stored = persistence.load_session('bounded-session')['removed_top_summaries']
    assert len(stored) == main.MAX_REMOVED_TOP_SUMMARIES
    # The oldest removal (top-1) was evicted.
    assert [entry['top_id'] for entry in stored] == [f'top-{index}' for index in range(2, count)]

    after_undo = put(client, restored(after_remove, before))
    assert after_undo['summary_states']['1']['origin'] == 'manual'
    assert top_data(after_undo, 2) == top_data(before, 2)
    assert top_data(after_undo, count - 1) == top_data(before, count - 1)


def test_bookkeeping_survives_saves_that_do_not_reconcile():
    client = TestClient(main.app)
    seed('worker-session')
    before = put(client, client.get('/api/sessions/worker-session').json())
    after_remove = put(client, without(before, [0]))

    # E.g. a summary worker saving a loaded session without this key.
    session = persistence.load_session('worker-session')
    session.pop('removed_top_summaries')
    persistence.save_session('worker-session', session)
    assert [entry['top_id'] for entry in persistence.load_session('worker-session')['removed_top_summaries']] == ['top-1']

    after_undo = put(client, restored(client.get('/api/sessions/worker-session').json(), before))
    assert top_data(after_undo, 1) == top_data(before, 1)
    assert after_remove['revision'] < after_undo['revision']
