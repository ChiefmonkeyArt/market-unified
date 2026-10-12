#!/usr/bin/env python3
"""Collapse src/ duplicates and deprecated re-export shims onto their @sdk/@ui/@platform home.

For every mapped src file, rewrite each importer (static import/export, dynamic import(),
mock.module(), require()) to the canonical specifier, then delete the src file.
Idempotent; prints what it did."""
import os, re, sys, json
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCAN = ['src', 'contextvm', 'e2e', 'scripts', 'deploy-simple', 'sdk', 'ui', 'platform']
EXTS = ('.ts', '.tsx', '.js', '.mjs')
ALIASES = {'@/': 'src/', '@sdk/': 'sdk/', '@ui/': 'ui/', '@platform/': 'platform/'}

DUPES = {
  'src/lib/auctionP2pk.ts': '@sdk/commerce/auctions/auctionP2pk',
  'src/lib/auctionSettlementP2pk.ts': '@sdk/commerce/auctions/auctionSettlementP2pk',
  **{f'src/lib/auction/{b}.ts': f'@sdk/commerce/auctions/{b}' for b in
     ['bidValidation','constants','events','immutability','reserveGuard','settlementDescriptor','tagBuilders','validatedBidView','validation','verdictQuorum']},
  **{f'src/lib/cashu/{b}.ts': f'@sdk/commerce/payments/cashu/{b}' for b in ['dleq','hashToCurve','mintCapability','nut7','p2pkSecret']},
}

SPEC_RE = re.compile(r"""((?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|mock\.module\(\s*|require\(\s*))(['"])([^'"]+)\2""")

def resolve(spec, importer):
    base = None
    for a, d in ALIASES.items():
        if spec.startswith(a): base = os.path.join(ROOT, d + spec[len(a):]); break
    if base is None and spec.startswith('.'):
        base = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    if base is None: return None
    for cand in [base, base + '.ts', base + '.tsx', os.path.join(base, 'index.ts'), os.path.join(base, 'index.tsx')]:
        if os.path.isfile(cand): return os.path.relpath(cand, ROOT)
    return None

def find_shims():
    """A shim is a src file whose code is only `export ... from '<one @sdk|@ui|@platform specifier>'`."""
    out = {}
    for d, _, fs in os.walk(os.path.join(ROOT, 'src')):
        for f in fs:
            if not f.endswith(EXTS): continue
            p = os.path.join(d, f); rel = os.path.relpath(p, ROOT)
            code = re.sub(r'/\*.*?\*/', '', open(p).read(), flags=re.S)
            code = '\n'.join(l for l in code.splitlines() if l.strip() and not l.strip().startswith('//'))
            if not code: continue
            stmts = re.findall(r"export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+'([^']+)'", code)
            rest = re.sub(r"export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+'[^']+'\s*;?", '', code).strip()
            if stmts and not rest and len(set(stmts)) == 1 and re.match(r'^@(sdk|ui|platform)/', stmts[0]):
                if re.search(r'\{[^}]*\bas\b[^}]*\}', code): continue  # renamed re-exports: keep (would change names)
                out[rel] = stmts[0]
    return out

def main():
    mapping = dict(DUPES)
    shims = find_shims()
    # a shim may itself point at a module we are collapsing; resolve chains
    mapping.update(shims)
    for k in list(mapping):
        if not os.path.isfile(os.path.join(ROOT, k)): mapping.pop(k)
    changed = {}
    for top in SCAN:
        for d, dirs, fs in os.walk(os.path.join(ROOT, top)):
            dirs[:] = [x for x in dirs if x not in ('node_modules', 'dist', '.git')]
            for f in fs:
                if not f.endswith(EXTS): continue
                p = os.path.join(d, f); rel = os.path.relpath(p, ROOT)
                if rel in mapping: continue
                s = open(p).read()
                def sub(m):
                    target = resolve(m.group(3), p)
                    if target in mapping:
                        changed[rel] = changed.get(rel, 0) + 1
                        return f"{m.group(1)}{m.group(2)}{mapping[target]}{m.group(2)}"
                    return m.group(0)
                n = SPEC_RE.sub(sub, s)
                if n != s: open(p, 'w').write(n)
    for k in mapping: os.remove(os.path.join(ROOT, k))
    print(json.dumps({'deleted': sorted(mapping), 'rewritten_files': len(changed), 'rewritten_imports': sum(changed.values()), 'shims': len(shims)}, indent=1))

main()
