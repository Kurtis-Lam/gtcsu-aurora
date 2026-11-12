#!/usr/bin/env python3
"""Recompute CSP sha256 hashes for every inline <script> and inline event
handler in public/*.html and write them into vercel.json + firebase.json.
Run after editing any inline script:  python3 scripts/update-csp-hashes.py"""
import re, hashlib, base64, glob, html, json

def h(s): return "'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'"

hashes = set()
for f in glob.glob('public/*.html'):
    t = open(f, encoding='utf-8').read()
    for m in re.finditer(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', t, re.S):
        if m.group(2).strip(): hashes.add(h(m.group(2)))
    for m in re.finditer(r'\son[a-z]+\s*=\s*("([^"]*)"|\'([^\']*)\')', t):
        v = m.group(2) if m.group(2) is not None else m.group(3)
        hashes.add(h(html.unescape(v)))

def patch(path, key_path):
    raw = open(path, encoding='utf-8').read()
    data = json.loads(raw)
    def walk(headers):
        for hd in headers:
            if hd['key'] == 'Content-Security-Policy':
                parts = [p.strip() for p in hd['value'].split(';') if p.strip()]
                out = []
                for p in parts:
                    if p.startswith('script-src '):
                        srcs = [s for s in p.split()[1:] if not s.startswith("'sha256-")]
                        p = 'script-src ' + ' '.join(srcs + sorted(hashes))
                    elif p.startswith('connect-src ') and 'https://cdn.jsdelivr.net' not in p:
                        p += ' https://cdn.jsdelivr.net'
                    out.append(p)
                hd['value'] = '; '.join(out)
    if path == 'vercel.json':
        walk([x for g in data['headers'] for x in g['headers']])
    else:
        walk([x for g in data['hosting']['headers'] for x in g['headers']])
    open(path, 'w', encoding='utf-8').write(json.dumps(data, indent=2) + '\n')

patch('vercel.json', None); patch('firebase.json', None)
print(len(hashes), 'hashes written')