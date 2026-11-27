"""Manual regeneration: current prompt, fresh model call, unchanged pipeline cache."""
import asyncio
import itertools
from pathlib import Path
import re
import threading

import durable_jobs as durable
import gemma_summary as gemma
import llm_transport
import main
import persistence
import summary_grounding
from llm_transport import cache_read, cache_write, fresh_responses
from summary_grounding import digest
from test_gemma_summary import setup_model, generate
from test_gemma_integration import session_state, review_lines


def counting_model(monkeypatch, tmp_path):
    """Fast Gemma model with a numbered answer per call and an enabled file cache."""
    monkeypatch.setenv('LLM_CACHE_DIR', str(tmp_path / 'cache'))
    monkeypatch.setattr(summary_grounding, 'model_fingerprint', lambda _: {'digest': 'fixed'})
    numbers = itertools.count(1)
    return setup_model(monkeypatch, 'fast', draft=lambda _: f'Entwurf {next(numbers)}')


def create_session(prompt):
    result = generate('fast', summary_style='gemma4-custom', custom_summary_prompt=prompt)
    persistence.save_session('gemma-session', main.reconcile_session_summaries(None, session_state(result)))


def manual_regeneration(worker, **preferences):
    session = persistence.load_session('gemma-session')
    job = asyncio.run(main.create_summary_job('gemma-session', main.SummaryJobCreateRequest(
        revision=session['revision'], top_ids=['costs'], **preferences)))
    current = durable.claim(worker, 60)
    assert current['job_id'] == job.summary_job_id
    token = durable.CURRENT.set(durable.Runtime(current, worker, threading.Event()))
    try:
        main.run_summary_job(job.summary_job_id)
    finally:
        durable.CURRENT.reset(token)
    assert persistence.load_summary_job(job.summary_job_id)['status'] == 'completed'
    return persistence.load_session('gemma-session')


def pipeline(monkeypatch, prompt):
    # Fresh pipeline progress each time, so only the response cache can avoid a call.
    state = {'result_refs': {}}
    monkeypatch.setattr(main, 'load_pipeline_job', lambda _: state)
    monkeypatch.setattr(main, 'save_pipeline_state', lambda _, result_refs: state['result_refs'].update(result_refs))
    summaries, reviews = main.summarize_pipeline_segments('pipeline', transcript=review_lines(), tops=['Kosten'],
        assignments=[0, 0], options=dict(processing_mode='fast', summary_style='gemma4-custom', custom_summary_prompt=prompt))
    return summaries[0]


def test_changed_custom_prompt_reaches_the_model_message(monkeypatch, tmp_path):
    calls = counting_model(monkeypatch, tmp_path)
    create_session('Erster Stil')
    calls.clear()
    saved = manual_regeneration('worker-1', summary_style='gemma4-custom', custom_summary_prompt='Zweiter Stil')
    assert len(calls) == 1
    settings, request = calls[0]
    assert settings.summary_style == 'gemma4-custom' and settings.lora_scale == 0
    assert request['messages'][0]['content'] == gemma.CUSTOM_SYSTEM
    assert request['messages'][1]['content'].startswith('Stilvorgaben:\nZweiter Stil\n\n')
    assert 'Erster Stil' not in str(request['messages'])
    usage = saved['summary_reviews'][0]['llm_usage']
    assert usage['summary_style'] == 'gemma4-custom'
    # The UI compares this hash with the current settings (summaryProvenance.ts).
    assert usage['policy']['prompt_sha256'] == digest([gemma.CUSTOM_SYSTEM, 'Zweiter Stil'])


def test_manual_regeneration_bypasses_cache_but_pipeline_reuses_it(monkeypatch, tmp_path):
    calls = counting_model(monkeypatch, tmp_path)
    create_session('Stil')
    calls.clear()
    first = pipeline(monkeypatch, 'Stil')
    assert len(calls) == 1 and first == 'Entwurf 2'
    assert pipeline(monkeypatch, 'Stil') == first and len(calls) == 1  # cache hit
    cached = list((tmp_path / 'cache').iterdir())

    # Identical input: the manual regeneration calls the model nonetheless.
    saved = manual_regeneration('worker-1', summary_style='gemma4-custom', custom_summary_prompt='Stil')
    assert len(calls) == 2 and calls[1][1] == calls[0][1]
    assert saved['summaries'][0] == 'Entwurf 3'
    assert saved['summary_reviews'][0]['llm_usage'].get('cached_calls') is None
    # The fresh result replaced the cache entry; the pipeline now reuses it.
    assert list((tmp_path / 'cache').iterdir()) == cached
    assert pipeline(monkeypatch, 'Stil') == 'Entwurf 3' and len(calls) == 2

    # Another job never inherits checkpoints of an earlier job with the same input.
    assert manual_regeneration('worker-2', summary_style='gemma4-custom',
                               custom_summary_prompt='Stil')['summaries'][0] == 'Entwurf 4'
    assert len(calls) == 3


def test_fresh_scope_skips_shared_cache_only(monkeypatch, tmp_path):
    monkeypatch.setenv('LLM_CACHE_DIR', str(tmp_path / 'cache'))
    cache_write('key', 'alt')
    with fresh_responses():
        assert cache_read('key') is None
        cache_write('key', 'neu')
        job = durable.submit('summary', {})
        current = durable.claim('worker', 60)
        token = durable.CURRENT.set(durable.Runtime(current, 'worker', threading.Event()))
        try:
            # Entries of the running job itself remain readable for its resumption.
            cache_write('job-key', 'zwischenstand')
            assert cache_read('job-key') == 'zwischenstand'
        finally:
            durable.CURRENT.reset(token)
        assert current['job_id'] == job['job_id']
    assert cache_read('key') == 'neu'
    with fresh_responses(False):
        assert cache_read('key') == 'neu'
    assert llm_transport._FRESH.get() is False
