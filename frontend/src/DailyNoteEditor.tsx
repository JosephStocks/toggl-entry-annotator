import { useState, useEffect } from 'react';
import {
    Card,
    Box,
    Group,
    Title,
    ActionIcon,
    Collapse,
    Text,
    Button,
    Textarea,
    ScrollArea,
    Tooltip,
} from '@mantine/core';
import {
    IconChevronDown,
    IconChevronUp,
    IconNotes,
    IconEye,
    IconEdit,
    IconDownload,
    IconDeviceFloppy,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { marked } from 'marked';
import { fetchDailyNote, upsertDailyNote } from './api';

interface DailyNoteEditorProps {
    date: Date;
}

export function DailyNoteEditor({ date }: DailyNoteEditorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isPreview, setIsPreview] = useState(false);
    const [content, setContent] = useState('');
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const queryClient = useQueryClient();
    const dateStr = format(date, 'yyyy-MM-dd');

    // Query for existing note
    const { data: dailyNote, isLoading } = useQuery({
        queryKey: ['dailyNote', dateStr],
        queryFn: () => fetchDailyNote(dateStr),
    });

    // Update local content when data changes
    useEffect(() => {
        if (dailyNote) {
            setContent(dailyNote.note_content);
            setHasUnsavedChanges(false);
        } else {
            // Default template for new notes
            const template = `# Daily Notes - ${format(date, 'MMMM d, yyyy')}\n\n## Tasks\n- \n\n## Notes\n\n`;
            setContent(template);
            setHasUnsavedChanges(false);
        }
    }, [dailyNote, date]);

    // Save mutation
    const saveMutation = useMutation({
        mutationFn: (content: string) => upsertDailyNote(dateStr, content),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dailyNote', dateStr] });
            setHasUnsavedChanges(false);
        },
    });

    const handleSave = () => {
        if (content.trim()) {
            saveMutation.mutate(content);
        }
    };

    const handleExport = () => {
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `daily-note-${dateStr}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleContentChange = (value: string) => {
        setContent(value);
        setHasUnsavedChanges(true);
    };

    // Keyboard shortcut for save
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's' && isOpen && !isPreview) {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, isPreview, content]);

    return (
        <Card withBorder shadow="sm" className="mb-4" p={0}>
            <Box
                onClick={() => setIsOpen(o => !o)}
                style={{ cursor: 'pointer' }}
                py="sm"
                px="md"
            >
                <Group justify="space-between">
                    <Group>
                        <IconNotes size={20} />
                        <Title order={4} m={0}>Daily Notes</Title>
                        {dailyNote && !hasUnsavedChanges && (
                            <Text size="xs" c="dimmed">
                                Saved {format(new Date(dailyNote.updated_at), 'h:mm a')}
                            </Text>
                        )}
                        {hasUnsavedChanges && (
                            <Text size="xs" c="orange">
                                Unsaved changes
                            </Text>
                        )}
                    </Group>
                    <ActionIcon variant="subtle" color="gray">
                        {isOpen ? <IconChevronUp size={20} /> : <IconChevronDown size={20} />}
                    </ActionIcon>
                </Group>
            </Box>

            <Collapse in={isOpen}>
                <Box px="md" pb="md">
                    <Group justify="space-between" mb="sm">
                        <Group>
                            <Button
                                variant={isPreview ? 'light' : 'filled'}
                                size="xs"
                                leftSection={<IconEdit size={16} />}
                                onClick={() => setIsPreview(false)}
                            >
                                Edit
                            </Button>
                            <Button
                                variant={isPreview ? 'filled' : 'light'}
                                size="xs"
                                leftSection={<IconEye size={16} />}
                                onClick={() => setIsPreview(true)}
                            >
                                Preview
                            </Button>
                        </Group>
                        <Text size="xs" c="dimmed">
                            Markdown supported • Cmd/Ctrl+S to save
                        </Text>
                    </Group>

                    {!isPreview ? (
                        <Textarea
                            value={content}
                            onChange={(e) => handleContentChange(e.currentTarget.value)}
                            placeholder="Write your daily notes in markdown..."
                            minRows={15}
                            maxRows={30}
                            autosize
                            styles={{
                                input: {
                                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                                    fontSize: '14px',
                                    lineHeight: '1.6',
                                },
                            }}
                            disabled={isLoading}
                        />
                    ) : (
                        <ScrollArea h={400} className="border rounded p-4">
                            <Box
                                className="prose"
                                dangerouslySetInnerHTML={{
                                    __html: marked(content) || '<p><em>Nothing to preview</em></p>'
                                }}
                                style={{
                                    maxWidth: 'none',
                                    '& h1': { fontSize: '1.875rem', marginTop: '0' },
                                    '& h2': { fontSize: '1.5rem' },
                                    '& h3': { fontSize: '1.25rem' },
                                    '& ul, & ol': { paddingLeft: '1.5rem' },
                                    '& code': {
                                        backgroundColor: '#f3f4f6',
                                        padding: '0.125rem 0.25rem',
                                        borderRadius: '0.25rem',
                                    },
                                    '& pre': {
                                        backgroundColor: '#f3f4f6',
                                        padding: '1rem',
                                        borderRadius: '0.5rem',
                                        overflow: 'auto',
                                    },
                                    '& blockquote': {
                                        borderLeft: '4px solid #e5e7eb',
                                        paddingLeft: '1rem',
                                        marginLeft: '0',
                                        fontStyle: 'italic',
                                    },
                                }}
                            />
                        </ScrollArea>
                    )}

                    <Group mt="md" justify="space-between">
                        <Group>
                            <Button
                                onClick={handleSave}
                                loading={saveMutation.isPending}
                                disabled={!content.trim() || !hasUnsavedChanges}
                                leftSection={<IconDeviceFloppy size={16} />}
                            >
                                Save
                            </Button>
                            <Tooltip label="Download as .md file">
                                <Button
                                    variant="light"
                                    onClick={handleExport}
                                    leftSection={<IconDownload size={16} />}
                                >
                                    Export
                                </Button>
                            </Tooltip>
                        </Group>
                        <Text size="xs" c="dimmed">
                            {content.length} characters
                        </Text>
                    </Group>
                </Box>
            </Collapse>
        </Card>
    );
}