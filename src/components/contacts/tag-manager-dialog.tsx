'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Tag as TagIcon, Loader2 } from 'lucide-react';
import { createTag, deleteTag, getTags } from '@/app/actions/tag-actions';
import { useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { Tag } from '@/lib/types';

interface TagManagerDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
}

const COLORS = [
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#22c55e', // green
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#a855f7', // purple
    '#ec4899', // pink
    '#64748b', // slate
];

export function TagManagerDialog({ isOpen, onOpenChange }: TagManagerDialogProps) {
    const { user } = useUser();
    const { toast } = useToast();
    const [tags, setTags] = useState<Tag[]>([]);
    const [loading, setLoading] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [selectedColor, setSelectedColor] = useState(COLORS[0]);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (isOpen && user) {
            loadTags();
        }
    }, [isOpen, user]);

    const loadTags = async () => {
        if (!user) return;
        setLoading(true);
        const res = await getTags(user.uid);
        if (res.success && res.data) {
            setTags(res.data);
        }
        setLoading(false);
    };

    const handleCreateTag = async () => {
        if (!user || !newTagName.trim()) return;
        setCreating(true);
        const res = await createTag(user.uid, newTagName.trim(), selectedColor);
        if (res.success && res.data) {
            setTags([...tags, res.data]);
            setNewTagName('');
            toast({ title: 'Etiqueta criada', description: 'A etiqueta foi criada com sucesso.' });
        } else {
            toast({ title: 'Erro', description: 'Erro ao criar etiqueta.', variant: 'destructive' });
        }
        setCreating(false);
    };

    const handleDeleteTag = async (tagId: string) => {
        if (!user) return;
        
        // Confirm deletion
        if (!confirm('Tem certeza que deseja excluir esta etiqueta? Ela será removida de todos os contatos.')) return;

        // Optimistic update
        const originalTags = [...tags];
        setTags(tags.filter(t => t.id !== tagId));
        
        const res = await deleteTag(user.uid, tagId);
        if (!res.success) {
            setTags(originalTags);
            toast({ title: 'Erro', description: 'Erro ao excluir etiqueta.', variant: 'destructive' });
        } else {
            toast({ title: 'Etiqueta removida', description: 'A etiqueta foi excluída com sucesso.' });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Gerenciar Etiquetas</DialogTitle>
                    <DialogDescription>
                        Crie e gerencie etiquetas para organizar seus contatos.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-6">
                    <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
                        <Label className="text-sm font-medium">Nova Etiqueta</Label>
                        <div className="flex gap-2">
                            <Input 
                                placeholder="Nome da etiqueta..." 
                                value={newTagName}
                                onChange={(e) => setNewTagName(e.target.value)}
                                className="bg-background"
                            />
                            <Button onClick={handleCreateTag} disabled={creating || !newTagName.trim()}>
                                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            </Button>
                        </div>
                        <div className="flex gap-2 mt-1">
                            {COLORS.map(color => (
                                <button
                                    key={color}
                                    className={`w-6 h-6 rounded-full border-2 transition-all ${selectedColor === color ? 'border-primary scale-110 shadow-sm' : 'border-transparent hover:scale-110'}`}
                                    style={{ backgroundColor: color }}
                                    onClick={() => setSelectedColor(color)}
                                    type="button"
                                    title="Selecionar cor"
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Etiquetas Existentes ({tags.length})</Label>
                        <ScrollArea className="h-[250px] border rounded-lg p-2 bg-background">
                            {loading ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : tags.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 py-8">
                                    <TagIcon className="w-8 h-8 opacity-20" />
                                    <span className="text-sm">Nenhuma etiqueta criada</span>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {tags.map(tag => (
                                        <div key={tag.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 border border-transparent hover:border-border transition-colors group">
                                            <div className="flex items-center gap-3">
                                                <div 
                                                    className="w-3 h-3 rounded-full ring-1 ring-offset-1 ring-offset-background ring-black/10" 
                                                    style={{ backgroundColor: tag.color }}
                                                />
                                                <span className="font-medium">{tag.name}</span>
                                            </div>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                                                onClick={() => handleDeleteTag(tag.id)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
