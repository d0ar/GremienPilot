"""Bounded, redacted error reports. Never serialize requests, locals or model output."""
import os
import re
import time
import traceback
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, quote, quote_plus

REDACTED = '[REDACTED]'
CONFIG_FIELDS = ('provider', 'model', 'base_url', 'context_tokens', 'output_tokens', 'reasoning_effort')
PROGRESS_FIELDS = ('phase', 'agenda_phase', 'summary_phase', 'pdf_phase', 'page', 'total_pages',
                   'round', 'processed_lines', 'total_lines', 'model_calls')


def redact(text):
    text = str(text)
    secrets = {v for k,v in os.environ.items() if v and
               re.search(r'(?:^|_)(?:TOKEN|PASSWORD|SECRET|API_?KEY|CREDENTIALS?|AUTHORIZATION)(?:$|_)', k, re.I)}
    for value in sorted(secrets, key=len, reverse=True):
        for variant in {value, quote(value, safe=''), quote_plus(value)}:
            if len(variant) < 4:
                text = re.sub(r'(?<!\w)'+re.escape(variant)+r'(?!\w)', lambda _: REDACTED, text)
            else:
                text = text.replace(variant, REDACTED)
    def url(match):
        try:
            parsed = urlsplit(match.group())
            return urlunsplit((parsed.scheme, parsed.netloc.rsplit('@', 1)[-1], parsed.path,
                urlencode([(k, REDACTED) for k,_ in parse_qsl(parsed.query, keep_blank_values=True)]), ''))
        except ValueError:
            return '[URL REDACTED]'
    text = re.sub(r'https?://[^\s<>\"\']+', url, text)
    text = re.sub(r'(?im)\b((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+', lambda m: m[1]+REDACTED, text)
    text = re.sub(r'(?i)\bBearer\s+[^\s,;\"\']+', 'Bearer '+REDACTED, text)
    text = re.sub(r'''(?ix)(?<![\w-])(["']?[\w-]{0,64}(?:api[_-]?key|token|password|secret|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)''',
                  lambda m: m[1]+REDACTED, text)
    return re.sub(r'\b(?:sk-|hf_)[A-Za-z0-9_-]{8,}', REDACTED, text)


def clean(value):
    if isinstance(value, dict):
        return {k:clean(v) for k,v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return redact(value) if isinstance(value, str) else value


def exception_report(exc, *, phase=None, attempt=None, config=None):
    chain, seen, truncated = [], set(), False
    while exc is not None and id(exc) not in seen and len(chain) < 8:
        seen.add(id(exc))
        message = redact(str(exc))
        frames = traceback.extract_tb(exc.__traceback__)
        entry = {'type': type(exc).__name__, 'message': message[:12000],
                 'stack': [redact(f'{f.filename}:{f.lineno} in {f.name}') for f in frames[-40:]]}
        status = getattr(exc, 'status_code', None)
        if isinstance(status, int):
            entry['http_status'] = status
        chain.append(entry)
        truncated |= len(message)>12000 or len(frames)>40
        exc = exc.__cause__ or (None if exc.__suppress_context__ else exc.__context__)
    return clean(dict(captured_at=time.time(), phase=phase, attempt=attempt,
        configuration={k:config[k] for k in CONFIG_FIELDS if config and k in config},
        exceptions=chain, truncated=truncated or exc is not None))
