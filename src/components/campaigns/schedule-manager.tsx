
'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon, Clock, AlertTriangle, Edit2, Ban, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { 
    calculateCampaignSchedule, 
    ScheduleRule, 
    BatchPreview, 
    WorkingHours, 
    SpeedConfig 
} from '@/lib/campaign-schedule';

interface ScheduleManagerProps {
    totalContacts: number;
    speedConfig: SpeedConfig;
    startDate: Date;
    defaultWorkingHours: WorkingHours;
    onRulesChange: (rules: ScheduleRule[]) => void;
}

export function ScheduleManager({
    totalContacts,
    speedConfig,
    startDate,
    defaultWorkingHours,
    onRulesChange
}: ScheduleManagerProps) {
    const [rules, setRules] = useState<ScheduleRule[]>([]);
    const [batches, setBatches] = useState<BatchPreview[]>([]);
    const [editingBatch, setEditingBatch] = useState<BatchPreview | null>(null);
    
    // Temporary state for the edit dialog
    const [editStart, setEditStart] = useState('');
    const [editEnd, setEditEnd] = useState('');
    const [editActive, setEditActive] = useState(true);

    // Recalculate schedule whenever inputs change
    useEffect(() => {
        const newBatches = calculateCampaignSchedule(
            totalContacts,
            speedConfig,
            startDate,
            defaultWorkingHours,
            rules
        );
        setBatches(newBatches);
        onRulesChange(rules);
    }, [totalContacts, speedConfig, startDate, defaultWorkingHours, rules]);

    const handleEditClick = (batch: BatchPreview) => {
        setEditingBatch(batch);
        
        // Find existing rule or use defaults
        const dateStr = format(batch.date, 'yyyy-MM-dd');
        const rule = rules.find(r => r.date === dateStr);
        
        if (rule) {
            setEditStart(rule.start || defaultWorkingHours.start);
            setEditEnd(rule.end || defaultWorkingHours.end);
            setEditActive(rule.active);
        } else {
            // Default to current batch planned times? 
            // Better to default to the Working Hours, as the batch might be partial.
            setEditStart(defaultWorkingHours.start);
            setEditEnd(defaultWorkingHours.end);
            setEditActive(true);
        }
    };

    const handleSaveRule = () => {
        if (!editingBatch) return;

        const dateStr = format(editingBatch.date, 'yyyy-MM-dd');
        
        // Create new rule
        const newRule: ScheduleRule = {
            date: dateStr,
            start: editStart,
            end: editEnd,
            active: editActive
        };

        // Update rules array
        setRules(prev => {
            const filtered = prev.filter(r => r.date !== dateStr);
            return [...filtered, newRule];
        });

        setEditingBatch(null);
    };

    const handleClearRule = (dateStr: string) => {
        setRules(prev => prev.filter(r => r.date !== dateStr));
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    Cronograma de Envio ({batches.length} dias estimados)
                </h3>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {batches.map((batch, index) => (
                    <div 
                        key={batch.id} 
                        className={cn(
                            "group flex items-center justify-between p-3 rounded-lg border text-sm transition-all hover:border-primary/50 cursor-pointer",
                            batch.isCustom ? "bg-primary/5 border-primary/20" : "bg-white border-slate-100"
                        )}
                        onClick={() => handleEditClick(batch)}
                    >
                        <div className="flex items-center gap-3 mb-2 sm:mb-0">
                            <div className={cn(
                                "font-bold px-2 py-1 rounded text-xs w-16 text-center flex flex-col items-center justify-center",
                                index === 0 ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                            )}>
                                <span className="text-[10px] uppercase">{format(batch.date, 'MMM', { locale: ptBR })}</span>
                                <span className="text-lg leading-none">{format(batch.date, 'dd')}</span>
                            </div>
                            
                            <div className="flex flex-col">
                                <span className="font-medium text-slate-900 flex items-center gap-2">
                                    {format(batch.date, 'EEEE', { locale: ptBR })}
                                    {index === 0 && (
                                        <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 h-4 flex items-center rounded">
                                            Início
                                        </span>
                                    )}
                                    {batch.isCustom && <Badge variant="secondary" className="text-[10px] h-4 px-1">Personalizado</Badge>}
                                </span>
                                <span className="text-xs text-slate-500">
                                    {batch.count} contatos
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex flex-col items-end text-xs text-slate-600">
                                <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-slate-400" />
                                    <span>{format(batch.startTime, 'HH:mm')} - {format(batch.endTime, 'HH:mm')}</span>
                                </div>
                                {batch.isCustom && (
                                    <span className="text-primary text-[10px]">Horário manual</span>
                                )}
                            </div>
                            <Edit2 className="w-4 h-4 text-slate-300 group-hover:text-primary transition-colors" />
                        </div>
                    </div>
                ))}
                
                {batches.length === 0 && (
                     <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed rounded-lg">
                        Nenhum envio agendado. Verifique a data de início ou regras.
                    </div>
                )}
            </div>

            <Dialog open={!!editingBatch} onOpenChange={(open) => !open && setEditingBatch(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar Agendamento</DialogTitle>
                        <DialogDescription>
                            Personalize o horário de envio para {editingBatch && format(editingBatch.date, "dd 'de' MMMM", { locale: ptBR })}.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="flex items-center justify-between border p-3 rounded-md">
                            <div className="space-y-0.5">
                                <Label className="text-base">Enviar neste dia?</Label>
                                <p className="text-sm text-muted-foreground">Desative para pular este dia e mover os contatos para o próximo.</p>
                            </div>
                            <Switch checked={editActive} onCheckedChange={setEditActive} />
                        </div>

                        {editActive && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Início</Label>
                                    <Input 
                                        type="time" 
                                        value={editStart} 
                                        onChange={(e) => setEditStart(e.target.value)} 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Fim</Label>
                                    <Input 
                                        type="time" 
                                        value={editEnd} 
                                        onChange={(e) => setEditEnd(e.target.value)} 
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        {editingBatch && rules.some(r => r.date === format(editingBatch.date, 'yyyy-MM-dd')) && (
                             <Button 
                                type="button" 
                                variant="destructive" 
                                onClick={() => {
                                    handleClearRule(format(editingBatch.date, 'yyyy-MM-dd'));
                                    setEditingBatch(null);
                                }}
                                className="mr-auto"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Restaurar Padrão
                            </Button>
                        )}
                        <Button type="button" variant="outline" onClick={() => setEditingBatch(null)}>Cancelar</Button>
                        <Button type="button" onClick={handleSaveRule}>Salvar Alterações</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
