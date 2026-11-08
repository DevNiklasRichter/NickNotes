import unittest
from src.backend.nicknotes_backend.markdown_io import parse_markdown_text, dump_markdown, MarkdownFormatError


class MarkdownFormatTests(unittest.TestCase):
    def test_yaml_roundtrip_preserves_nested_unknown_values(self):
        text = '---\ntitle: "A: title"\ntags: [project:alpha]\nsummary: |\n  first line\n  second line\ncustom:\n  enabled: true\n  nothing: null\n---\n\nBody\n'
        meta, body = parse_markdown_text(text)
        again, _ = parse_markdown_text(dump_markdown(meta, body))
        self.assertEqual(meta, again)
        self.assertEqual(meta['tags'], ['project:alpha'])
        self.assertIn('second line', meta['summary'])
        self.assertIsNone(meta['custom']['nothing'])

    def test_duplicate_keys_and_unsafe_yaml_are_rejected(self):
        for header in ['id: a\nid: b', 'custom: !!python/object/apply:os.system [echo unsafe]']:
            with self.assertRaises(MarkdownFormatError):
                parse_markdown_text('---\n' + header + '\n---\n')
