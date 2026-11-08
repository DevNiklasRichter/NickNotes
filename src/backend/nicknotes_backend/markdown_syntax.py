"""Transform visible Markdown prose without touching code samples."""
import re
def transform_prose(body, transform):
    fence = None
    output = []
    for line in body.splitlines(keepends=True):
        match = re.match(r'^\s*(`{3,}|~{3,})', line)
        if match:
            token = match.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            output.append(line)
        elif fence is not None:
            output.append(line)
        else:
            output.append(''.join(part if part.startswith('`') else transform(part) for part in re.split(r'(`+[^`]*`+)', line)))
    return ''.join(output)


def prose_text(body):
    """Visible prose shared by derived tags and links; code examples have no semantics."""
    visible=[]
    transform_prose(body,lambda text:visible.append(text) or text)
    return ''.join(visible)


def split_markdown_destination(value):
    """Separate the common inline destination/title syntax without losing a title."""
    match = re.fullmatch(r'''\s*(<[^>]+>|[^\s]+?)(\s+(?:"[^"]*"|'[^']*'))?\s*''', value)
    if not match:
        return None
    raw = match.group(1)
    angled = raw.startswith('<') and raw.endswith('>')
    return (raw[1:-1] if angled else raw, match.group(2) or '', angled)


def rewrite_markdown_links(body, current_path, mappings, deleted=None):
    """Retarget local Markdown links relative to the old and new source location."""
    import posixpath
    from urllib.parse import unquote, quote, urlsplit
    deleted = deleted or {}
    mappings_by_key = {old.lower(): new for old, new in mappings.items()}
    current = str(current_path).replace('\\', '/')
    current_no_ext = current[:-3] if current.lower().endswith('.md') else current
    old_current = next((old for old, new in mappings.items() if new.lower() == current_no_ext.lower()), current_no_ext) + '.md'
    def rewrite(text):
        def replace(match):
            label, raw = match.group(1), match.group(2)
            parts = split_markdown_destination(raw)
            if parts is None:
                return match.group(0)
            target, title, angled = parts
            if urlsplit(target).scheme or target.startswith('#'):
                return match.group(0)
            path, separator, anchor = target.partition('#')
            decoded = unquote(path).replace('\\', '/')
            if not decoded.lower().endswith('.md'):
                return match.group(0)
            absolute = posixpath.normpath(decoded.lstrip('/') if decoded.startswith('/') else posixpath.join(posixpath.dirname(old_current), decoded))[:-3]
            if absolute.lower() in deleted:
                return f'~~{label}~~ *(deleted note: {absolute})*'
            destination = mappings_by_key.get(absolute.lower(), absolute)
            if destination == absolute and old_current == current:
                return match.group(0)
            next_path = '/' + destination + '.md' if decoded.startswith('/') else posixpath.relpath(destination + '.md', posixpath.dirname(current) or '.')
            destination = f'{quote(next_path, safe="/._-~")}{separator}{anchor}'
            if angled:
                destination = '<' + destination + '>'
            return f'[{label}]({destination}{title})'
        return re.sub(r'(?<!!)\[([^]\n]*)\]\(([^)\n]+)\)', replace, text)
    return transform_prose(body, rewrite)
