// @ts-nocheck
'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { contacts } from '@/lib/data';
import {
  CalendarIcon, Loader2, Sparkles, AlertTriangle, Paperclip, FileText, Video, Image as ImageIcon, Music
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { handleOptimizeMessage } from '@/app/actions';
import type { OptimizeMessageContentOutput } from '@/ai/flows/optimize-message-content';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../ui/dialog';
import { Checkbox } from '../ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { PhonePreview } from './phone-preview';

const formSchema = z.object({
  name: z.string().min(5, { message: 'O nome da campanha deve ter pelo menos 5 caracteres.' }),
  contactSegment: z.string().min(1, { message: 'Por favor, selecione um segmento de contato.' }),
  message: z.string().min(10, { message: 'A mensagem deve ter pelo menos 10 caracteres.' }),
  sendSpeed: z.string().default('safe'),
  liabilityAccepted: z.boolean().refine((val) => val === true, {
    message: 'Você deve aceitar os termos de responsabilidade para continuar.',
  }),
  media: z.any().optional(),
});

export function CreateCampaignForm() {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] =
    useState<OptimizeMessageContentOutput | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      contactSegment: '',
      message: '',
      sendSpeed: 'safe',
      liabilityAccepted: false,
    },
  });

  const { watch, setValue } = form;
  const messageValue = watch('message');
  const sendSpeedValue = watch('sendSpeed');
  const mediaFile = watch('media');
  const liabilityAccepted = watch('liabilityAccepted');
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (mediaFile) {
        setFileName(mediaFile.name);
    } else {
        setFileName('');
    }
  }, [mediaFile]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    toast({
      title: "Campanha Enviada para a Fila!",
      description: `A campanha "${values.name}" foi iniciada com sucesso.`
    })
    console.log(values);
  }

  const onOptimize = async () => {
    const message = form.getValues('message');
    if (!message || message.length < 10) {
      form.setError('message', {
        type: 'manual',
        message: 'Por favor, insira uma mensagem com pelo menos 10 caracteres para otimizar.',
      });
      return;
    }
    setIsOptimizing(true);
    try {
      const result = await handleOptimizeMessage({ message });
      setOptimizationResult(result);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro na Otimização",
        description: error instanceof Error ? error.message : "Ocorreu um erro desconhecido.",
      })
    } finally {
      setIsOptimizing(false);
    }
  };

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

  const contactSegments = ['Todos', ...Array.from(new Set(contacts.map((c) => c.segment)))];
  const recipientCount = watch('contactSegment') === 'Todos' 
    ? contacts.length 
    : contacts.filter(c => c.segment === watch('contactSegment')).length;

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Coluna Esquerda e Central (Formulário) */}
          <div className="lg:col-span-2 space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>1. Identificação e Destinatários</CardTitle>
                <CardDescription>Dê um nome à sua campanha e escolha quem irá recebê-la.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da Campanha</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Lançamento de Inverno" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactSegment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Segmento de Contatos</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um segmento" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {contactSegments.map((segment) => (
                            <SelectItem key={segment} value={segment}>
                              {segment}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                      {field.value && (
                        <FormDescription>
                          Esta campanha será enviada para <strong>{recipientCount}</strong> pessoas.
                        </FormDescription>
                      )}
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2. Compositor de Mensagem</CardTitle>
                <CardDescription>Crie a mensagem perfeita e adicione mídias.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                 <FormField
                    control={form.control}
                    name="message"
                    render={({ field }) => (
                    <FormItem>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <FormLabel>Mensagem</FormLabel>
                            <div className="flex items-center gap-2">
                                <span className='text-xs text-muted-foreground'>Inserir variável:</span>
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => handleVariableInsert('Nome')}>[Nome]</Button>
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => handleVariableInsert('Telefone')}>[Telefone]</Button>
                            </div>
                        </div>
                        <FormControl>
                        <Textarea
                            placeholder="Olá [Nome], confira nossas novidades..."
                            className="min-h-[180px] resize-y"
                            {...field}
                            ref={textareaRef}
                        />
                        </FormControl>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <FormMessage />
                            <Button type="button" variant="outline" size="sm" onClick={onOptimize} disabled={isOptimizing}>
                                {isOptimizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                Otimizar com IA
                            </Button>
                        </div>
                    </FormItem>
                    )}
                />
                <FormField
                  control={form.control}
                  name="media"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Anexos de Mídia</FormLabel>
                      <FormControl>
                        <div className="relative">
                            <Input 
                                type="file" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={(e) => field.onChange(e.target.files ? e.target.files[0] : null)}
                            />
                            <div className="flex items-center justify-center w-full h-24 border-2 border-dashed rounded-md text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                                {fileName ? (
                                    <p>{fileName}</p>
                                ) : (
                                    <div className='text-center space-y-1'>
                                        <Paperclip className="mx-auto h-6 w-6" />
                                        <p className='text-sm'>Clique para anexar Imagem, Vídeo, Áudio ou PDF</p>
                                    </div>
                                )}
                            </div>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>3. Configuração de Envio e Segurança</CardTitle>
                <CardDescription>Defina a velocidade para evitar bloqueios e confirme sua responsabilidade.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="sendSpeed"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Velocidade de Envio (Delay)</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex flex-col space-y-1"
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="safe" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              🐢 Modo Seguro (20-45s / msg) - Recomendado
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="fast" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              🐇 Modo Rápido (10-20s / msg) - Risco Médio
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="turbo" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              🚀 Modo Turbo (5-10s / msg) - Alto Risco
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {sendSpeedValue === 'turbo' && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Modo de Alto Risco Ativado!</AlertTitle>
                    <AlertDescription>
                      O Modo Turbo aumenta significativamente a chance de bloqueio do seu número. Use com extrema cautela e apenas para contatos que esperam sua mensagem.
                    </AlertDescription>
                  </Alert>
                )}
                
                <FormField
                    control={form.control}
                    name="liabilityAccepted"
                    render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-background">
                        <FormControl>
                        <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                        />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                        <FormLabel>
                            Termo de Responsabilidade
                        </FormLabel>
                        <FormDescription>
                            Declaro que os contatos desta lista consentiram em receber mensagens. Entendo que o uso abusivo viola as políticas do WhatsApp e pode acarretar no bloqueio definitivo do meu número.
                        </FormDescription>
                        <FormMessage className='pt-2' />
                        </div>
                    </FormItem>
                    )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button variant="ghost">Salvar como Rascunho</Button>
              <Button type="submit" disabled={!liabilityAccepted} size="lg">
                Iniciar Disparo Agora
              </Button>
            </div>
          </div>

          {/* Coluna Direita (Preview) */}
          <div className="lg:col-span-1 sticky top-6">
             <Card>
                <CardHeader>
                    <CardTitle>Preview da Mensagem</CardTitle>
                </CardHeader>
                <CardContent>
                    <PhonePreview message={messageValue} media={mediaFile} />
                </CardContent>
             </Card>
          </div>
        </form>
      </Form>
      
      <Dialog open={!!optimizationResult} onOpenChange={(open) => !open && setOptimizationResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Otimização de Mensagem com IA</DialogTitle>
            <DialogDescription>
              Analisamos sua mensagem e aqui estão nossas sugestões para melhorar o impacto.
            </DialogDescription>
          </DialogHeader>
          {optimizationResult && (
            <div className="grid gap-6 py-4">
              <Alert>
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Mensagem Otimizada</AlertTitle>
                <AlertDescription>
                  <p className="font-mono text-sm p-4 bg-muted rounded-md">{optimizationResult.optimizedMessage}</p>
                </AlertDescription>
              </Alert>
              <div>
                <h4 className="font-semibold mb-2">Sugestões Específicas:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  {optimizationResult.suggestions.map((suggestion, index) => (
                    <li key={index}>{suggestion}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Raciocínio da IA:</h4>
                <p className="text-sm text-muted-foreground">{optimizationResult.reasoning}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
                <Button type="button" variant="secondary">Fechar</Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => {
                if (optimizationResult) {
                  form.setValue('message', optimizationResult.optimizedMessage);
                }
                setOptimizationResult(null);
                toast({ title: "Mensagem atualizada com sucesso!"})
              }}
            >
              Usar esta mensagem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
