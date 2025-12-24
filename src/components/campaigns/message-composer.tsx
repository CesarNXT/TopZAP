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
  Loader2, Sparkles, FileText, Image as ImageIcon, Music
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

  const handleVariableInsert = (variable: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const newText = text.substring(0, start) + `[${variable}]` + text.substring(end);
        setValue('message', newText, { shouldValidate: true });
        textarea.focus();
        setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + variable.length + 2;
        }, 0)
    }
  };

  const MediaUploadSlot = ({ type }: { type: 'media' | 'audio' | 'doc' }) => (
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
                        type === 'media' ? 'image/*,video/*' :
                        type === 'audio' ? 'audio/*' :
                        type === 'doc' ? '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx' : '*'
                    }
                />
                <div className="flex items-center justify-center w-full h-32 border-2 border-dashed rounded-md text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                    {fileName ? (
                        <p>{fileName}</p>
                    ) : (
                        <div className='text-center space-y-1'>
                            { type === 'media' && <ImageIcon className="mx-auto h-8 w-8" /> }
                            { type === 'audio' && <Music className="mx-auto h-8 w-8" /> }
                            { type === 'doc' && <FileText className="mx-auto h-8 w-8" /> }
                            <p className='text-sm'>
                                {
                                    type === 'media' ? 'Clique para anexar Imagem ou Vídeo' :
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
  
  const MessageSlot = ({label = "Mensagem", placeholder = "Olá [Nome], confira nossas novidades...", isOptional=false}) => (
    <FormField
        control={form.control}
        name="message"
        render={({ field }) => (
        <FormItem>
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <FormLabel>{label} {isOptional && <span className='text-muted-foreground text-xs'>(Opcional)</span>}</FormLabel>
                <div className="flex items-center gap-2">
                    <span className='text-xs text-muted-foreground'>Inserir variável:</span>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => handleVariableInsert('Nome')}>[Nome]</Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => handleVariableInsert('Telefone')}>[Telefone]</Button>
                </div>
            </div>
            <FormControl>
            <Textarea
                placeholder={placeholder}
                className="min-h-[120px] resize-y"
                {...field}
                ref={textareaRef}
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
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Etapa 2: Compositor de Mensagem</CardTitle>
        <CardDescription>Escolha o formato e crie o conteúdo da sua campanha.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
         <Tabs defaultValue="text" className="w-full" onValueChange={setMessageType}>
            <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="text">📝 Só Texto</TabsTrigger>
                <TabsTrigger value="media">📸 Foto + Legenda</TabsTrigger>
                <TabsTrigger value="audio">🎤 Áudio</TabsTrigger>
                <TabsTrigger value="document">📄 Documento</TabsTrigger>
            </TabsList>
            <TabsContent value="text" className='pt-4'>
                <MessageSlot />
            </TabsContent>
            <TabsContent value="media" className='pt-4 space-y-4'>
                <MediaUploadSlot type="media" />
                <MessageSlot label="Legenda" placeholder="Digite uma legenda opcional..." isOptional />
            </TabsContent>
            <TabsContent value="audio" className='pt-4 space-y-4'>
                 <MediaUploadSlot type="audio" />
            </TabsContent>
            <TabsContent value="document" className='pt-4 space-y-4'>
                <MediaUploadSlot type="doc" />
                <MessageSlot label="Legenda" placeholder="Digite uma legenda opcional..." isOptional />
            </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
