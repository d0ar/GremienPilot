"""FAST orchestration contracts; scripted responses do not establish model quality."""
import pytest
from agenda_detection import segment_known_agenda
from assignment_suggestions import TranscriptUtterance
import agenda_llm
from llm_transport import ContextBudgetError, IncompleteResponseError


def rows(count):
    return [TranscriptUtterance('S',f'Originalbeitrag {i}',f'line-{i}',i,i+1) for i in range(count)]


def test_free_fast_uses_originals_and_all_tops_including_backward_jumps(agenda_model,monkeypatch):
    monkeypatch.setenv('AGENDA_DETECTION_CHUNK_LINES','2')
    def forbidden(*args,**kwargs):
        pytest.fail('Known FAST agenda must not require global preparation')
    for method in ('context','discover','reconstruction'):
        monkeypatch.setattr(agenda_llm.Workflow,method,forbidden)
    expected=[2,0,1,0,2,1]
    agenda_model.labels={i:[f'detected:{top}'] for i,top in enumerate(expected)}
    titles=['Haushalt','Schule','Verkehr'];ids=['stable-a','stable-b','stable-c']
    result=segment_known_agenda(rows(6),titles,top_ids=ids,processing_mode='fast',enforce_top_order=False)
    assert result.assignments==expected
    assert result.tops==titles
    assert result.llm.processing_complete and result.llm.review_status=='skipped'
    assert result.llm.reconstructions==[]
    assert [s['top_id'] for s in result.llm.agenda_states]==ids
    assert len(agenda_model.calls)==3
    for body,request in agenda_model.calls:
        assert body['phase']=='fast:detail'
        assert [a['title'] for a in body['agenda']]==titles
        assert 'previous_top_position' not in body['context']
        assert body['source_windows']==[]
        schema=request['response_format']['json_schema']['schema']['properties']['response']
        assert 'anyOf' not in schema
        assert 'boundary' not in request['response_format']['json_schema']['schema']['$defs']['assignment']['properties']
    assert [r['index'] for b,_ in agenda_model.calls for r in b['target_lines']]==list(range(6))
    assert [t['top_id'] for t in result.llm.provenance['identities']]==ids


def test_free_fast_fits_windows_before_model_calls(agenda_model,monkeypatch):
    original=agenda_llm.Workflow.details
    def limited(self,role,context,agenda,reconstruction,start,end,opinions=None):
        if end-start+1>2:raise ContextBudgetError('Test budget')
        return original(self,role,context,agenda,reconstruction,start,end,opinions)
    monkeypatch.setattr(agenda_llm.Workflow,'details',limited)
    result=segment_known_agenda(rows(9),['Haushalt'],processing_mode='fast')
    assert result.assignments==[0]*9
    assert result.llm.processing_complete
    assert all(len(b['target_lines'])<=2 for b,_ in agenda_model.calls)
    assert [r['index'] for b,_ in agenda_model.calls for r in b['target_lines']]==list(range(9))


def test_failed_window_does_not_erase_other_free_fast_assignments(agenda_model,monkeypatch):
    monkeypatch.setenv('AGENDA_DETECTION_CHUNK_LINES','2')
    def respond(body):
        if body['target_start']==2:raise IncompleteResponseError('LLM output incomplete')
        return agenda_model.answer(body)
    agenda_model.overrides['fast:detail']=respond
    result=segment_known_agenda(rows(6),['Haushalt'],processing_mode='fast')
    assert result.assignments==[0,0,None,None,0,0]
    assert result.llm.processed_lines==[0,1,4,5]
    assert not result.llm.processing_complete
    assert len(agenda_model.calls)==3  # No retry/split tree for malformed FAST output.
    assert all(g['kind']=='technical' for g in result.llm.gaps)


def test_joint_and_semantically_unassigned_lines_remain_distinct(agenda_model):
    agenda_model.labels={0:['detected:0','detected:1'],1:[]}
    result=segment_known_agenda(rows(2),['Haushalt','Schule'],processing_mode='fast')
    assert result.assignments==[None,None]
    assert result.llm.processing_complete
    assert [r['status'] for r in result.llm.line_results]==['assigned','unassigned']
    assert len(result.llm.line_results[0]['top_ids'])==2


def test_optional_neighbours_cannot_prevent_processing_owned_originals(agenda_model,monkeypatch):
    original=agenda_llm.Workflow.details
    def limited(self,role,context,agenda,reconstruction,start,end,opinions=None):
        if len(context.get('boundary_overlap',[])) + end-start+1>1:
            raise ContextBudgetError('Test original budget')
        return original(self,role,context,agenda,reconstruction,start,end,opinions)
    monkeypatch.setattr(agenda_llm.Workflow,'details',limited)
    result=segment_known_agenda(rows(4),['Haushalt'],processing_mode='fast')
    assert result.assignments==[0]*4 and result.llm.processing_complete
    assert len(agenda_model.calls)==4
    assert all(b['context']['boundary_overlap']==[] for b,_ in agenda_model.calls)


def test_unordered_fast_job_returns_source_bound_assignments(agenda_model,monkeypatch):
    from fastapi.testclient import TestClient
    import main
    import durable_jobs as jobs
    from test_durable_jobs import wait
    monkeypatch.setenv('AGENDA_DETECTION_CHUNK_LINES','2')
    agenda_model.labels={i:[f'detected:{top}'] for i,top in enumerate([1,0,1,0])}
    transcript=[dict(speaker='S',text=f'Originalbeitrag {i}',line_id=f'original-{i}',start=i,end=i+1) for i in range(4)]
    with TestClient(main.app) as client:
        response=client.post('/api/agenda-detection/jobs',json=dict(transcript=transcript,tops=['Haushalt','Verkehr'],
            top_ids=['stable-a','stable-b'],processing_mode='fast',enforce_top_order=False,preserve_transcript_structure=True))
        assert response.status_code==202
        jid=response.json()['job_id'];wait(lambda: jobs.load(jid)['state'] in jobs.TERMINAL)
        result=client.get('/api/model-jobs/'+jid).json()
    assert result['state']=='review_required'
    value=result['result']
    assert value['assignments']==[1,0,1,0]
    assert value['transcript']==transcript
    assert value['llm']['processing_complete'] and value['llm']['review_status']=='skipped'
    assert [i['top_id'] for i in value['llm']['provenance']['identities']]==['stable-a','stable-b']


@pytest.mark.parametrize('known',[False,True])
def test_invalid_source_response_in_preparation_does_not_block_existing_fast_agenda(agenda_model,known):
    # Valid JSON but the wrong envelope for source_call, matching the reported failure.
    agenda_model.overrides['fast:discover']='{"kind":"result","result":{}}'
    result=segment_known_agenda(rows(7),['Haushalt'] if known else [],processing_mode='fast')
    if known:
        assert result.assignments==[0]*7 and result.llm.processing_complete
        assert all(b['phase']=='fast:detail' for b,_ in agenda_model.calls)
    else:
        assert result.assignments==[None]*7 and not result.llm.processing_complete
        assert 'invalid_source_response' in result.llm.failure_reasons
        assert all(r['status']=='not_processed' and 'invalid_source_response' in r['reason'] for r in result.llm.line_results)
