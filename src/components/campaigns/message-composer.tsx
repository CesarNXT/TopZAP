'use client';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  FormField,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  Loader2, Sparkles, FileText, Image as ImageIcon, Music, Plus, Trash, Lock, Video
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { UseFormReturn } from 'react-hook-form';

interface MessageComposerProps {
    form: UseFormReturn<any>;
    onOptimize: () => Promise<void>;
    isOptimizing: boolean;
}

export function MessageComposer({ form, onOptimize, isOptimizing }: MessageComposerProps) {
  const { watch, setValue } = form;
  const messageValue = watch('message');
  const [messageType, setMessageType] = useState('text');
  const [fileName, setFileName] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaFile = watch('media');
  
  useEffect(() => {
    if (mediaFile) {
        setFileName(mediaFile.name);
    } else {
        setFileName('');
    }
  }, [mediaFile]);
  
  useEffect(() => {
    // Clear media when switching back to text tab and vice-versa
    if (messageType === 'text') {
      setValue('media', null);
    } else {
        // You might want to clear the message when a media file is uploaded
        // but for now, we'll allow a caption by default.
    }
  }, [messageType, setValue]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Etapa 2: Compositor de Mensagem</CardTitle>
        <CardDescription>Escolha o formato e crie o conteúdo da sua campanha.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
         <Tabs defaultValue="text" className="w-full" onValueChange={setMessageType}>
            <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="text">📝 Só Texto</TabsTrigger>
                <TabsTrigger value="image">📸 Imagem</TabsTrigger>
                <TabsTrigger value="video">🎥 Vídeo</TabsTrigger>
                <TabsTrigger value="audio">🎤 Áudio</TabsTrigger>
                <TabsTrigger value="document">📄 Documento</TabsTrigger>
            </TabsList>
            <TabsContent value="text" className='pt-4'>
                <MessageSlot 
                    form={form} 
                    textareaRef={textareaRef} 
                    onOptimize={onOptimize}
                    isOptimizing={isOptimizing}
                    messageValue={messageValue}
                />
                <ButtonManager form={form} />
            </TabsContent>
            <TabsContent value="image" className='pt-4 space-y-4'>
                <MediaUploadSlot form={form} type="image" fileName={fileName} />
                <MessageSlot 
                    form={form} 
                    label="Legenda" 
                    placeholder="Digite uma legenda opcional..." 
                    isOptional 
                    textareaRef={textareaRef}
                    onOptimize={onOptimize}
                    isOptimizing={isOptimizing}
                    messageValue={messageValue}
                />
                <ButtonManager form={form} />
            </TabsContent>
            <TabsContent value="video" className='pt-4 space-y-4'>
                <MediaUploadSlot form={form} type="video" fileName={fileName} />
                <MessageSlot 
                    form={form} 
                    label="Legenda" 
                    placeholder="Digite uma legenda opcional..." 
                    isOptional 
                    textareaRef={textareaRef}
                    onOptimize={onOptimize}
                    isOptimizing={isOptimizing}
                    messageValue={messageValue}
                />
                <ButtonManager form={form} />
            </TabsContent>
            <TabsContent value="audio" className='pt-4 space-y-4'>
                 <MediaUploadSlot form={form} type="audio" fileName={fileName} />
                 <MessageSlot 
                    form={form} 
                    label="Mensagem de Texto (Enviada junto com o áudio)" 
                    placeholder="Digite uma mensagem opcional..." 
                    isOptional 
                    textareaRef={textareaRef}
                    onOptimize={onOptimize}
                    isOptimizing={isOptimizing}
                    messageValue={messageValue}
                />
                <ButtonManager form={form} />
            </TabsContent>
            <TabsContent value="document" className='pt-4 space-y-4'>
                <MediaUploadSlot form={form} type="doc" fileName={fileName} />
                <MessageSlot 
                    form={form} 
                    label="Legenda" 
                    placeholder="Digite uma legenda opcional..." 
                    isOptional 
                    textareaRef={textareaRef}
                    onOptimize={onOptimize}
                    isOptimizing={isOptimizing}
                    messageValue={messageValue}
                />
                <ButtonManager form={form} />
            </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface MediaUploadSlotProps {
    form: UseFormReturn<any>;
    type: 'image' | 'video' | 'audio' | 'doc';
    fileName: string;
}

function MediaUploadSlot({ form, type, fileName }: MediaUploadSlotProps) {
    return (
    <FormField
      control={form.control}
      name="media"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Anexo</FormLabel>
          <FormControl>
            <div className="relative">
                <Input 
                    type="file" 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={(e) => field.onChange(e.target.files ? e.target.files[0] : null)}
                    accept={
                        type === 'image' ? 'image/*' :
                        type === 'video' ? 'video/*' :
                        type === 'audio' ? 'audio/*' :
                        type === 'doc' ? '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx' : '*'
                    }
                />
                <div className="flex items-center justify-center w-full h-32 border-2 border-dashed rounded-md text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                    {fileName ? (
                        <p>{fileName}</p>
                    ) : (
                        <div className='text-center space-y-1'>
                            { type === 'image' && <ImageIcon className="mx-auto h-8 w-8" /> }
                            { type === 'video' && <Video className="mx-auto h-8 w-8" /> }
                            { type === 'audio' && <Music className="mx-auto h-8 w-8" /> }
                            { type === 'doc' && <FileText className="mx-auto h-8 w-8" /> }
                            <p className='text-sm'>
                                {
                                    type === 'image' ? 'Clique para anexar uma Imagem' :
                                    type === 'video' ? 'Clique para anexar um Vídeo' :
                                    type === 'audio' ? 'Clique para anexar um Áudio' :
                                    'Clique para anexar um Documento'
                                }
                            </p>
                        </div>
                    )}
                </div>
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

interface MessageSlotProps {
    form: UseFormReturn<any>;
    label?: string;
    placeholder?: string;
    isOptional?: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement>;
    onOptimize: () => Promise<void>;
    isOptimizing: boolean;
    messageValue: string;
}

function MessageSlot({
    form, 
    label = "Mensagem", 
    placeholder = "Olá, confira nossas novidades...", 
    isOptional=false,
    textareaRef,
    onOptimize,
    isOptimizing,
    messageValue
}: MessageSlotProps) {
    return (
    <FormField
        control={form.control}
        name="message"
        render={({ field }) => (
        <FormItem>
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <FormLabel>{label} {isOptional && <span className='text-muted-foreground text-xs'>(Opcional)</span>}</FormLabel>

            </div>
            <FormControl>
            <Textarea
                placeholder={placeholder}
                className="min-h-[120px] resize-y"
                {...field}
                ref={(e) => {
                    field.ref(e);
                    if (textareaRef) {
                        (textareaRef as any).current = e;
                    }
                }}
            />
            </FormControl>
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <FormMessage />
                <Button type="button" variant="outline" size="sm" onClick={onOptimize} disabled={isOptimizing || !messageValue}>
                    {isOptimizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Corrigir meu Texto
                </Button>
            </div>
        </FormItem>
        )}
    />
  );
}

function ButtonManager({ form }: { form: UseFormReturn<any> }) {
    const { watch, setValue } = form;
    // We watch 'buttons' but need to handle undefined
    const buttons = watch('buttons') || [];

    const handleAddButton = () => {
        // Limit to 4 custom buttons (plus 1 mandatory = 5 total)
        if (buttons.length >= 4) return;
        
        // Generate a simple ID
        const newId = 'btn_' + Math.random().toString(36).substring(2, 9);
        const newButtons = [...buttons, { id: newId, text: '' }];
        setValue('buttons', newButtons);
    };

    const handleRemoveButton = (index: number) => {
        const newButtons = [...buttons];
        newButtons.splice(index, 1);
        setValue('buttons', newButtons);
    };

    const handleTextChange = (index: number, text: string) => {
        const newButtons = [...buttons];
        newButtons[index].text = text;
        setValue('buttons', newButtons);
    };

    return (
        <div className="space-y-3 pt-4 border-t mt-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Botões de Resposta Rápida</h4>
                <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleAddButton} 
                    disabled={buttons.length >= 4}
                    className="text-primary hover:text-primary/80"
                >
                    <Plus className="h-4 w-4 mr-1" /> Adicionar Botão
                </Button>
            </div>
            
            <div className="space-y-3">
                 {/* Mandatory Button */}
                 <div className="flex items-center gap-2 opacity-80 cursor-not-allowed" title="Este botão é obrigatório para segurança da campanha">
                    <Button type="button" variant="outline" className="w-full justify-start text-muted-foreground bg-muted/50" disabled>
                        <Lock className="h-4 w-4 mr-2" /> 
                        Bloquear Contato (Obrigatório)
                    </Button>
                </div>

                {/* Custom Buttons */}
                {buttons.map((btn: any, index: number) => (
                    <div key={btn.id || index} className="flex items-center gap-2">
                        <Input 
                            placeholder="Texto do Botão (Ex: Sim, eu quero)" 
                            value={btn.text} 
                            onChange={(e) => handleTextChange(index, e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddButton();
                                }
                            }}
                            className="flex-1"
                            maxLength={20}
                            autoFocus={index === buttons.length - 1 && index > 0}
                        />
                         <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveButton(index)} className="text-muted-foreground hover:text-destructive">
                            <Trash className="h-4 w-4" />
                        </Button>
                    </div>
                ))}
            </div>
             <p className="text-xs text-muted-foreground">
                Adicione até 4 botões personalizados. O botão &quot;Bloquear Contato&quot; será sempre enviado.
            </p>
        </div>
    );
}
