#!/usr/bin/env python3
"""
Boxel JSON:API instance correctness scanner.

Catches three classes of bug that pass `npx boxel file lint` AND `npx boxel file write` AND
even index successfully, then brick the realm at render or reindex time:

  Rule 1 (BRICKS REALM)  — `linksToMany` shape uses array under `links.self`.
                            Host rejects with "not a card resource document".

  Rule 2 (BRICKS REALM)  — External URL (http/https) in `relationships.<field>.links.self`.
                            Indexer fetches binary, JSON.parse fails, NULL byte
                            in error message rejects postgres JSONB write,
                            entire batch rolls back.

  Rule 3 (CRASHES RENDER) — `contains(DateField)` value has `T` (ISO datetime),
                             or `contains(DateTimeField)` value lacks `T`.
                             date-fns format() throws `RangeError: Invalid time value`
                             on serialize.

Usage:

    python3 .claude/skills/boxel/scripts/instance-correctness-scan.py <realm-root>

Exit code 0 = clean; 1 = one or more issues found. Pair with pre-push hooks
or pre-commit checks.

See `.claude/skills/boxel/SKILL.md` Cardinal Rules 11, 12, 13.
"""
import re
import sys
import json
import glob
import os

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
DATETIME_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$')


def build_field_type_map(realm_root):
    """Return {gts_rel_path: {field_name: 'DateField'|'DateTimeField'}}."""
    file_field_type = {}
    for f in glob.glob(f'{realm_root}/**/*.gts', recursive=True):
        if '.boxel-history' in f:
            continue
        try:
            with open(f) as fh:
                src = fh.read()
        except Exception:
            continue
        rel = os.path.relpath(f, realm_root)
        file_field_type[rel] = {}
        for m in re.finditer(r'@field\s+(\w+)\s*=\s*contains\((Date(?:Time)?Field)', src):
            file_field_type[rel][m.group(1)] = m.group(2)
    return file_field_type


def scan(realm_root):
    file_field_type = build_field_type_map(realm_root)
    problems = []

    for inst in sorted(glob.glob(f'{realm_root}/**/*.json', recursive=True)):
        if 'history' in inst or '_distilled' in inst:
            continue
        if inst.endswith('realm.json') or inst.endswith('index.json'):
            continue
        try:
            with open(inst) as fh:
                data = json.load(fh)
        except Exception as e:
            problems.append((inst, 'invalid-json', str(e)[:80]))
            continue
        d = data.get('data', {})
        rels = d.get('relationships', {}) or {}

        # Rule 1: linksToMany array shape
        for rk, rv in rels.items():
            if isinstance(rv, dict):
                self_link = (rv.get('links') or {}).get('self')
                if isinstance(self_link, list):
                    problems.append((inst, 'rule-1-array-shape',
                                     f'{rk} (use {rk}.0, {rk}.1, ... instead)'))

        # Rule 2: external (non-card) URLs in relationship links
        # The valid shapes for links.self are: relative paths ("../Foo/bar") or
        # absolute realm URLs pointing at cards. Flag URLs that clearly aren't
        # cards: image hosts, file extensions, etc.
        REALM_HOSTS = ('realms-staging.stack.cards', 'app.boxel.ai', 'stack.cards')
        NONCARD_EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.pdf', '.mp3', '.mp4', '.wav', '.zip')
        NONCARD_HOSTS = ('images.unsplash.com', 'images.', 'cdn.', 'img.', 's3.amazonaws.com')
        for rk, rv in rels.items():
            if isinstance(rv, dict):
                link = (rv.get('links') or {}).get('self')
                if not isinstance(link, str) or not link.startswith('http'):
                    continue
                low = link.lower()
                # ext-based detection
                if any(low.split('?')[0].endswith(ext) for ext in NONCARD_EXTS):
                    problems.append((inst, 'rule-2-noncard-url-in-link',
                                     f'{rk}={link[:60]}...'))
                    continue
                # host-based detection
                if any(h in low for h in NONCARD_HOSTS):
                    problems.append((inst, 'rule-2-noncard-url-in-link',
                                     f'{rk}={link[:60]}...'))
                    continue
                # everything else (likely a realm card URL) is OK

        # Rule 3: date format mismatch
        meta = d.get('meta', {}).get('adoptsFrom', {})
        module = meta.get('module', '')
        if module.startswith('../'):
            inst_dir = os.path.dirname(os.path.relpath(inst, realm_root))
            kit = inst_dir.split('/')[0]
            gts = f'{kit}/{module.replace("../", "")}.gts'
            field_map = file_field_type.get(gts, {})
            attrs = d.get('attributes', {}) or {}
            for fname, ftype in field_map.items():
                v = attrs.get(fname)
                if v is None or v == '' or not isinstance(v, str):
                    continue
                if ftype == 'DateField' and not DATE_RE.match(v):
                    problems.append((inst, 'rule-3-date-format',
                                     f'{fname}={v} (DateField requires YYYY-MM-DD)'))
                elif ftype == 'DateTimeField' and not DATETIME_RE.match(v):
                    problems.append((inst, 'rule-3-datetime-format',
                                     f'{fname}={v} (DateTimeField requires ISO datetime with T and Z)'))

    return problems


def main():
    if len(sys.argv) != 2:
        print(f'Usage: {sys.argv[0]} <realm-root>', file=sys.stderr)
        sys.exit(2)
    realm_root = os.path.abspath(sys.argv[1])
    if not os.path.isdir(realm_root):
        print(f'Not a directory: {realm_root}', file=sys.stderr)
        sys.exit(2)
    problems = scan(realm_root)
    for inst, rule, detail in problems:
        print(f'{rule}: {os.path.relpath(inst, realm_root)} :: {detail}')
    print()
    if problems:
        print(f'  ✗ {len(problems)} instance correctness issue(s) found.')
        sys.exit(1)
    print(f'  ✓ clean')
    sys.exit(0)


if __name__ == '__main__':
    main()
