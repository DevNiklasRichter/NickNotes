import tempfile
import unittest
from pathlib import Path

from src.backend.nicknotes_backend.graph_index import build_graph_index
from src.backend.nicknotes_backend.graph_queries import graph_ranked, note_context


class GraphQueryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        # Alpha -> Beta -> Delta, Gamma -> Alpha; Solo stands alone.
        notes = {'Alpha': '[[Beta]]', 'Beta': '[[Delta]]', 'Gamma': '[[Alpha]]', 'Delta': 'Ende', 'Solo': 'Nichts'}
        for title, body in notes.items():
            (root / f'{title}.md').write_text(f'# {title}\n\n{body}\n', encoding='utf-8')
        self.index = build_graph_index(root, [])

    def tearDown(self):
        self.temp.cleanup()

    def test_context_names_links_backlinks_and_second_degree_with_reasons(self):
        context = note_context(self.index, 'Alpha.md', depth=2)
        self.assertEqual([item['path'] for item in context['links']], ['Beta.md'])
        self.assertEqual([item['path'] for item in context['backlinks']], ['Gamma.md'])
        self.assertEqual(context['secondDegree'], [{'path': 'Delta.md', 'title': 'Delta', 'tags': [], 'via': ['Beta']}])
        self.assertEqual(note_context(self.index, 'Alpha.md')['secondDegree'], [])
        self.assertIsNone(note_context(self.index, 'Fehlt.md')['note'])

    def test_search_hits_linked_with_other_hits_rise(self):
        hits = [{'relativePath': path, 'title': path[:-3], 'path': path} for path in ('Solo.md', 'Alpha.md', 'Beta.md')]
        ranked = graph_ranked(self.index, hits)
        self.assertEqual([hit['relativePath'] for hit in ranked], ['Alpha.md', 'Solo.md', 'Beta.md'])
        self.assertEqual(ranked[0]['linkedHits'], ['Beta'])
        self.assertEqual(ranked[0]['backlinks'], 1)
        self.assertEqual([hit['relativePath'] for hit in graph_ranked(self.index, hits, rerank=False)], ['Solo.md', 'Alpha.md', 'Beta.md'])


if __name__ == '__main__':
    unittest.main()
