import json
from fastapi.testclient import TestClient
import durable_jobs as jobs
import error_diagnostics as errors
import main
import persistence
from llm_transport import ProviderError
from test_durable_jobs import claimed, wait


def test_exception_chain_redacts_secrets_and_keeps_http_status_and_frames(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY','private-api-value-123')
    monkeypatch.setenv('HF_TOKEN','hf_verysecret123456')
    try:
        try:
            raise ProviderError('Failed private-api-value-123 hf_verysecret123456 Bearer another-secret '
                'https://user:pass@example.org/v1?key=querysecret token=inline-secret',400)
        except ProviderError as cause:
            raise RuntimeError('TOP processing failed') from cause
    except RuntimeError as exc:
        report=errors.exception_report(exc,phase='fast:context')
    text=json.dumps(report)
    for secret in ('private-api-value-123','hf_verysecret123456','another-secret','user:pass','querysecret','inline-secret'):
        assert secret not in text
    assert [v['type'] for v in report['exceptions']]==['RuntimeError','ProviderError']
    assert report['exceptions'][1]['http_status']==400
    assert report['exceptions'][0]['message']=='TOP processing failed'
    assert 'test_exception_chain' in report['exceptions'][0]['stack'][-1]
    assert 'raise ProviderError' not in text  # No source lines or local variables.


def test_long_messages_are_explicitly_marked_as_truncated():
    report=errors.exception_report(RuntimeError('x'*13000))
    assert report['truncated']
    assert len(report['exceptions'][0]['message'])==12000


def test_report_endpoint_is_separate_redacted_and_excludes_private_artifacts(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY','private-api-value-123')
    job=jobs.submit('test',{'private_prompt':'do not expose payload'})
    with claimed(job):
        jobs.artifact('private','model_attempt',{'raw':'do not expose model output'})
        try:
            raise RuntimeError('Concrete cause private-api-value-123')
        except RuntimeError as exc:
            jobs.record_failure(exc,phase='fast:context',config={'model':'demo','api_key':'private-api-value-123'})
    with persistence.connect() as db:
        db.execute("UPDATE durable_jobs SET state='failed',error='RuntimeError' WHERE job_id=?",(job['job_id'],))
    with TestClient(main.app) as client:
        ordinary=client.get('/api/model-jobs/'+job['job_id']).json()
        response=client.get('/api/model-jobs/'+job['job_id']+'/error-details')
        assert client.get('/api/model-jobs/missing/error-details').status_code==404
    assert 'reports' not in ordinary
    assert response.status_code==200
    report=response.json();text=json.dumps(report)
    assert report['reports'][0]['phase']=='fast:context'
    assert report['reports'][0]['attempt']==1
    assert 'Concrete cause' in text
    for private in ('private-api-value-123','do not expose payload','do not expose model output','api_key'):
        assert private not in text


def test_worker_captures_unhandled_runtime_error():
    def fail(job):
        raise RuntimeError('Runtime error with actual explanation')
    job=jobs.submit('test',{})
    worker=jobs.Manager(fail)
    current=jobs.claim('test-worker',60)
    worker.execute(current)
    assert jobs.load(job['job_id'])['state']=='failed'
    report=jobs.error_details(job['job_id'])
    assert report['reports'][0]['exceptions'][0]['message']=='Runtime error with actual explanation'


def test_fast_swallowed_failure_is_available_in_frontend_report(agenda_model):
    agenda_model.overrides['fast:discover']=RuntimeError('Concrete FAST cause')
    with TestClient(main.app) as client:
        response=client.post('/api/agenda-detection/jobs',json=dict(processing_mode='fast',use_llm=True,
            tops=['Haushalt'],transcript=[dict(line_id='line-1',speaker='S',text='Beratung.',start=0,end=1)]))
        assert response.status_code==202
        jid=response.json()['job_id']
        wait(lambda: jobs.load(jid)['state'] in jobs.TERMINAL)
        result=client.get('/api/model-jobs/'+jid).json()
        report=client.get('/api/model-jobs/'+jid+'/error-details').json()
    assert result['state']=='failed'
    assert 'Concrete FAST cause' in json.dumps(report)
    assert any(r['phase']=='fast:discover' for r in report['reports'])


def test_older_job_has_clear_fallback_without_invented_stacktrace():
    job=jobs.submit('test',{})
    with claimed(job):
        jobs.artifact('old','technical_diagnostic',dict(phase='fast:context',code='RuntimeError',raw='private answer'))
    report=jobs.error_details(job['job_id'])
    assert report['reports']==[]
    assert report['previous_diagnostics']==[dict(phase='fast:context',code='RuntimeError')]
    assert 'private answer' not in json.dumps(report)


def test_header_and_url_credentials_are_redacted():
    value=errors.redact('Cookie: session=one; other=two\nAuthorization: Bearer three\n'
        'https://user:pass@host/v1?key=four&other=five\napi_key="six"')
    for secret in ('one','two','three','user:pass','four','five','six'):
        assert secret not in value
    assert 'host/v1' in value


def test_context_token_limits_are_not_credentials_and_short_keys_are_redacted(monkeypatch):
    monkeypatch.setenv('LLM_CONTEXT_TOKENS','65536')
    monkeypatch.setenv('HF_TOKEN','abc')
    assert errors.redact('Context limit 65536, rejected credential abc')=='Context limit 65536, rejected credential [REDACTED]'
