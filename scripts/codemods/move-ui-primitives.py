#!/usr/bin/env python3
"""Move shadcn primitives from src/components/ui/ into the ui/ package.

- src/components/ui/<name>.tsx            -> ui/primitives/<name>.tsx
- src/components/ui/{image-uploader,relay-manager}/ (app-aware) -> src/components/<dir>/
- every import that resolves to a moved file is rewritten:
    outside ui/  -> '@ui/primitives/<name>' (or '@/components/<dir>/...')
    inside ui/   -> a relative path
- '@/lib/utils' inside moved primitives -> relative '../utils/cn'

Imports are resolved, not pattern-matched, so '@/components/ui/x', './ui/x' and
'../ui/x' are all handled. Idempotent: a second run finds nothing to move.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OLD_UI = os.path.join(ROOT, 'src', 'components', 'ui')
NEW_UI = os.path.join(ROOT, 'ui', 'primitives')
APP_WIDGET_DIRS = ('image-uploader', 'relay-manager')
EXTS = ('.tsx', '.ts')
SPEC = re.compile(r"""(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bmock\.module\(\s*|\bvi\.mock\(\s*)(['"])([^'"]+)\2""")


def strip_ext(p: str) -> str:
    for e in EXTS:
        if p.endswith(e):
            return p[: -len(e)]
    return p


def build_moves() -> dict[str, str]:
    """old absolute path (with extension) -> new absolute path."""
    moves: dict[str, str] = {}
    if not os.path.isdir(OLD_UI):
        return moves
    for name in sorted(os.listdir(OLD_UI)):
        src = os.path.join(OLD_UI, name)
        if os.path.isdir(src):
            if name not in APP_WIDGET_DIRS:
                sys.exit(f'unexpected directory {src}')
            for dp, _, fns in os.walk(src):
                for fn in fns:
                    old = os.path.join(dp, fn)
                    moves[old] = os.path.join(ROOT, 'src', 'components', os.path.relpath(old, OLD_UI))
        elif name.endswith(EXTS):
            moves[src] = os.path.join(NEW_UI, name)
    return moves


def resolve(spec: str, file_old: str) -> str | None:
    if spec.startswith('@/'):
        base = os.path.join(ROOT, 'src', spec[2:])
    elif spec.startswith('@ui/'):
        base = os.path.join(ROOT, 'ui', spec[4:])
    elif spec.startswith('.'):
        base = os.path.normpath(os.path.join(os.path.dirname(file_old), spec))
    else:
        return None
    for cand in (base, *(base + e for e in EXTS), *(os.path.join(base, 'index' + e) for e in EXTS)):
        if os.path.isfile(cand):
            return cand
    return None


def spec_for(target_new: str, file_new: str) -> str:
    in_ui = lambda p: os.path.commonpath([p, os.path.join(ROOT, 'ui')]) == os.path.join(ROOT, 'ui')
    t = strip_ext(target_new)
    if t.endswith(os.sep + 'index'):
        t = t[: -len('/index')]
    if in_ui(file_new):
        rel = os.path.relpath(t, os.path.dirname(file_new))
        return rel if rel.startswith('.') else './' + rel
    if in_ui(target_new):
        return '@ui/' + os.path.relpath(t, os.path.join(ROOT, 'ui')).replace(os.sep, '/')
    return '@/' + os.path.relpath(t, os.path.join(ROOT, 'src')).replace(os.sep, '/')


def source_files() -> list[str]:
    out = subprocess.run(['git', 'ls-files', '-co', '--exclude-standard', '*.ts', '*.tsx'], cwd=ROOT, capture_output=True, text=True, check=True)
    return [os.path.join(ROOT, p) for p in out.stdout.split() if not p.startswith('node_modules/')]


def main() -> None:
    moves = build_moves()
    if not moves:
        print('nothing to move')
        return
    utils_cn = os.path.join(ROOT, 'ui', 'utils', 'cn.ts')
    lib_utils = resolve('@/lib/utils', ROOT + '/x')
    changed = 0
    for f_old in source_files():
        f_new = moves.get(f_old, f_old)
        src = open(f_old, encoding='utf8').read()

        def repl(m: re.Match[str]) -> str:
            spec = m.group(3)
            target = resolve(spec, f_old)
            if target is None:
                return m.group(0)
            if f_old in moves and target == lib_utils and f_new.startswith(NEW_UI):
                return f"{m.group(1)}{m.group(2)}{spec_for(utils_cn, f_new)}{m.group(2)}"
            if target not in moves and f_old not in moves:
                return m.group(0)
            new_spec = spec_for(moves.get(target, target), f_new)
            if f_old not in moves and target not in moves:
                return m.group(0)
            return f"{m.group(1)}{m.group(2)}{new_spec}{m.group(2)}"

        out = SPEC.sub(repl, src)
        if out != src:
            changed += 1
            open(f_old, 'w', encoding='utf8').write(out)
    for old, new in moves.items():
        os.makedirs(os.path.dirname(new), exist_ok=True)
        subprocess.run(['git', 'mv', old, new], cwd=ROOT, check=True)
    print(f'moved {len(moves)} files, rewrote imports in {changed} files')


if __name__ == '__main__':
    main()
