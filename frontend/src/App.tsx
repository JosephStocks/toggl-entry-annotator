import { useEffect, useState } from 'react';
import { Card, Text, Group, Button, TextInput, Loader, Stack } from '@mantine/core';
import { todayWindowUTC } from './utils/time.ts';

// --- Types mirroring your API ------------------------------------
type Note = { id: number; note_text: string; created_at: string };
type Entry = {
  entry_id: number;
  description: string;
  project_name: string;
  seconds: number;
  start: string;
  notes: Note[];
};

// --- Simple fetch helpers ----------------------------------------
async function fetchToday(): Promise<Entry[]> {
  const { startIso, endIso } = todayWindowUTC(4);
  const r = await fetch(
    `/api/time_entries?start_iso=${encodeURIComponent(startIso)}&end_iso=${encodeURIComponent(endIso)}`
  );
  return r.json();
}

async function addNote(entryId: number, text: string) {
  await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry_id: entryId, note_text: text }),
  });
}
// -----------------------------------------------------------------

export default function App() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchToday().then(setEntries);
  }, []);

  if (!entries) return <Loader className="m-10" />;

  return (
    <Stack className="max-w-xl mx-auto p-4">
      {entries.map((e) => (
        <Card key={e.entry_id} shadow="sm" withBorder className="mb-4">
          <Text fw={600}>{e.description}</Text>
          <Text size="sm" c="dimmed">
            {e.project_name} · {(e.seconds / 60).toFixed(1)} min
          </Text>

          {/* notes */}
          <Stack mt="sm" className="pl-2 border-l border-gray-300">
            {e.notes.map((n) => (
              <Text key={n.id} size="sm">
                • {n.note_text}
              </Text>
            ))}
            {/* add-note form */}
            <Group>
              <TextInput
                placeholder="Add note…"
                size="xs"
                className="flex-1"
                value={drafts[e.entry_id] ?? ''}
                onChange={(ev) =>
                  setDrafts({ ...drafts, [e.entry_id]: ev.currentTarget.value })
                }
              />
              <Button
                size="xs"
                onClick={async () => {
                  const txt = drafts[e.entry_id]?.trim();
                  if (!txt) return;
                  await addNote(e.entry_id, txt);
                  setDrafts({ ...drafts, [e.entry_id]: '' });
                  setEntries(await fetchToday());      // refresh list
                }}
              >
                Save
              </Button>
            </Group>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
