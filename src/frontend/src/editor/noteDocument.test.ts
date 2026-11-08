import { expect, test } from 'vitest'
import { parseNoteDocument, serializeNoteDocument } from './noteDocument'

test('completed timestamps retain their instant across repeated editor roundtrips', () => {
  let text = '---\nid: task_time\nnode_id: task_time\ntitle: Time\ntype: task\nstatus: done\ncompleted_at: 2026-11-08T12:00:00+01:00\n---\n\nBody\n'
  for (let i = 0; i < 3; i++) {
    text = serializeNoteDocument(parseNoteDocument(text, 'Time'))
    const completed = parseNoteDocument(text, 'Time').frontmatter.completed_at
    expect(new Date(completed).toISOString()).toBe('2026-11-08T11:00:00.000Z')
  }
})
