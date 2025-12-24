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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import {
  Loader2, Sparkles, AlertTriangle, Users, Star, Cake, ShieldX, ArrowLeft, Send
} from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { Label } from '../ui/label';
import { PhonePreview } from './phone-preview';
import { cn } from '@/lib/utils';
import { MessageComposer } from './message-composer';
import { SpeedSelector } from './speed-selector';
import { v4 as uuidv4 } from 'uuid';
import type { Contact, Campaign } from '@/lib/types';
import { useUser, useFirestore, useCollection } from '@/firebase';
import { collection, addDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { useMemoFirebase } from '@/firebase/provider';

import { createAdvancedCampaignForUser } from '@/app/actions/whatsapp-actions';

const formSchema = z.object({
  name: z.string().min(5, { message: 'O nome da campanha deve ter pelo menos 5 caracteres.' }),
  contactSegment: z.string().min(1, { message: 'Por favor, selecione um grupo de destinatários.' }),
  message: z.string().optional(),
  sendSpeed: z.string().default('safe'),
  buttons: z.array(z.object({
    id: z.string(),
    text: z.string()
  })).optional(),
  liabilityAccepted: z.boolean().refine((val) => val === true, {
    message: 'Você deve aceitar os termos de responsabilidade para continuar.',
  }),
  media: z.any().optional(),
  dailyLimit: z.number().min(1, { message: 'Limite diário deve ser pelo menos 1.' }).default(300),
  startDate: z.string().optional(),
}).refine(data => data.message || data.media, {
    message: "A campanha precisa ter uma mensagem ou um anexo de mídia.",
    path: ['message'],
});

const steps = [
    { id: '01', name: 'Destinatários', fields: ['name', 'contactSegment'] },
    { id: '02', name: 'Mensagem', fields: ['message', 'media'] },
    { id: '03', name: 'Velocidade', fields: ['sendSpeed'] },
    { id: '04', name: 'Confirmar e Enviar' }
]

export function CreateCampaignWizard() {
    const router = useRouter();
    const { user } = useUser();
    const firestore = useFirestore();
    const [currentStep, setCurrentStep] = useState(0);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizationResult, setOptimizationResult] = useState<OptimizeMessageContentOutput | null>(null);
    const [submitError, setSubmitError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const contactsQuery = useMemoFirebase(() => {
        if (!user) return null;
        return collection(firestore, 'users', user.uid, 'contacts');
    }, [firestore, user]);

    const { data: contacts } = useCollection<Contact>(contactsQuery);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: '',
            contactSegment: '',
            message: '',
            sendSpeed: 'safe',
            liabilityAccepted: false,
            dailyLimit: 300,
        },
    });

    const { watch, setValue, trigger, handleSubmit, formState: { errors } } = form;
    const messageValue = watch('message');
    const mediaFile = watch('media');
    const sendSpeed = watch('sendSpeed');
    const contactSegment = watch('contactSegment');
    const buttons = watch('buttons');
    const dailyLimit = watch('dailyLimit');
    const startDate = watch('startDate');

    const next = async () => {
        const fields = steps[currentStep].fields;
        const output = await trigger(fields as any, { shouldFocus: true });
        if (!output) return;
        if (currentStep < steps.length - 1) setCurrentStep(step => step + 1);
    }
    const prev = () => {
        if (currentStep > 0) setCurrentStep(step => step - 1);
    }

    const processSubmit = async (values: z.infer<typeof formSchema>) => {
        if (!user) {
            toast({ variant: "destructive", title: "Erro", description: "Você precisa estar logado para criar uma campanha." });
            return;
        }
        try {
            const userDocRef = doc(firestore, 'users', user.uid);
            const userSnap = await getDoc(userDocRef);
            const data = userSnap.data() as any;
            const isConnected = data?.uazapi?.connected === true || data?.uazapi?.status === 'connected';
            if (!isConnected) {
                toast({ variant: "destructive", title: "Erro", description: "Você precisa estar conectado ao WhatsApp para enviar uma campanha." });
                return;
            }
        } catch (e) {
            toast({ variant: "destructive", title: "Erro", description: "Falha ao verificar conexão com o WhatsApp." });
            return;
        }
        setIsSubmitting(true);

        // Prepare messages for uazapi
        const messagesToSend: any[] = [];
        if (values.media) {
            try {
                const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                });
                const base64 = await toBase64(values.media);
                
                if (values.media.type.startsWith('image/')) {
                    messagesToSend.push({
                        image: base64,
                        caption: values.message || " ",
                        type: 'button' // Hint for whatsapp-actions
                    });
                } else if (values.media.type.startsWith('video/')) {
                     messagesToSend.push({
                        video: base64,
                        caption: values.message || " ",
                        type: 'button'
                    });
                } else if (values.media.type.startsWith('audio/')) {
                    messagesToSend.push({
                        audio: base64,
                        type: 'ptt' // Force PTT as requested
                    });
                     // If there's a text message with audio, we might need to send it separately or as caption?
                     // PTT usually doesn't have caption. 
                     // If user typed a message, we should send it as text after PTT.
                     if (values.message) {
                         messagesToSend.push(values.message);
                     }
                } else {
                    // Document or other
                    // Documents usually don't support buttons in the same message in some APIs
                    // But we'll try to send it as text + button if we can't attach
                    // or just send document. 
                    // Let's try sending as object and let whatsapp-actions handle it
                    messagesToSend.push({
                        document: base64,
                        fileName: values.media.name,
                        caption: values.message || " "
                    });
                }
            } catch (e) {
                console.error("File read error", e);
                toast({ variant: "destructive", title: "Erro", description: "Falha ao processar arquivo de mídia." });
                setIsSubmitting(false);
                return;
            }
        } else if (values.message) {
            messagesToSend.push(values.message);
        }

        // Get active phones
        const activeContacts = validContacts.filter(c => c.segment !== 'Inactive');
        const phones = activeContacts.map(c => c.phone).filter(Boolean);

        if (phones.length === 0) {
            toast({ variant: "destructive", title: "Erro", description: "Nenhum contato válido encontrado para enviar." });
            setIsSubmitting(false);
            return;
        }

        // Call Server Action to Send
        // Batching Logic for Daily Limits
        const limit = values.dailyLimit || 300;
        const totalContacts = phones.length;
        const batches = [];
        
        for (let i = 0; i < totalContacts; i += limit) {
            batches.push(phones.slice(i, i + limit));
        }

        const baseDate = values.startDate ? new Date(values.startDate + 'T00:00:00') : new Date();
        const endDateLimit = values.endDate ? new Date(values.endDate + 'T23:59:59') : null;

        // If user didn't pick a time, assume start as soon as possible (subject to window)
        // If user picked a date but no time, we might default to 08:00 or now.
        // For simplicity, let's assume startDate includes time if provided, or we construct it.
        // But the input type="date" only gives YYYY-MM-DD. We should default to 08:00 if future, or max(08:00, now) if today.
        
        let currentDate = new Date(baseDate);
        
        // Helper to adjust date to next valid window (08:00 - 19:00)
        const adjustToWindow = (date: Date) => {
            const startHour = 8;
            const endHour = 19;
            
            // If it's past 19:00, move to tomorrow 08:00
            if (date.getHours() >= endHour) {
                date.setDate(date.getDate() + 1);
                date.setHours(startHour, 0, 0, 0);
            }
            // If it's before 08:00, move to today 08:00
            else if (date.getHours() < startHour) {
                date.setHours(startHour, 0, 0, 0);
            }
            
            return date;
        };

        currentDate = adjustToWindow(currentDate);

        let successCount = 0;
        let lastDocRef = null;

        for (let i = 0; i < batches.length; i++) {
            // Check End Date Limit
            if (endDateLimit && currentDate > endDateLimit) {
                toast({ 
                    title: "Limite de Data Atingido", 
                    description: `Os lotes restantes foram ignorados pois excedem a data limite de ${endDateLimit.toLocaleDateString()}.` 
                });
                break;
            }

            const batchPhones = batches[i];
            const batchIndex = i + 1;
            const isMultiBatch = batches.length > 1;
            
            // Calculate scheduled timestamp (seconds)
            const scheduledFor = Math.floor(currentDate.getTime() / 1000);
            
            const batchName = isMultiBatch ? `${values.name} (Dia ${batchIndex})` : values.name;

            const sendResult = await createAdvancedCampaignForUser(
                user.uid, 
                values.sendSpeed as any, 
                messagesToSend, 
                batchPhones, 
                undefined, 
                scheduledFor, 
                values.buttons
            );

            if (sendResult.error) {
                 toast({ variant: "destructive", title: `Erro no Lote ${batchIndex}`, description: sendResult.error });
                 continue; // Continue with next batch? Or stop? Let's continue.
            }

            const newCampaign: Omit<Campaign, 'id'> = {
                name: batchName,
                status: 'Scheduled', // Since we are scheduling
                sentDate: currentDate.toISOString(),
                recipients: batchPhones.length,
                engagement: 0,
                userId: user.uid,
            };

            try {
                const campaignCollection = collection(firestore, 'users', user.uid, 'campaigns');
                
                const uazapiId = sendResult.id || sendResult.folderId || sendResult.campaignId;
                let docRef;
    
                if (uazapiId) {
                    docRef = doc(campaignCollection, String(uazapiId));
                    await setDoc(docRef, newCampaign);
                } else {
                    docRef = await addDoc(campaignCollection, newCampaign);
                }
                
                lastDocRef = docRef;
                successCount++;

            } catch (error) {
                console.error("Failed to save campaign to Firestore", error);
            }

            // Advance date for next batch (Next Day 08:00)
            currentDate.setDate(currentDate.getDate() + 1);
            currentDate.setHours(8, 0, 0, 0);
        }
        
        if (successCount > 0) {
            toast({
                title: "Campanha Agendada!",
                description: `${successCount} lote(s) agendado(s) com sucesso.`
            });
            
            if (lastDocRef) {
                sessionStorage.setItem('newlyCreatedCampaignId', lastDocRef.id);
            }
            router.push('/campaigns');
        } else {
            toast({ variant: "destructive", title: "Erro", description: "Falha ao criar campanha." });
            setIsSubmitting(false);
        }
    }

    const handleFinalSubmit = () => {
        if (!watch('liabilityAccepted')) {
            trigger('liabilityAccepted');
            setSubmitError(true);
            setTimeout(() => setSubmitError(false), 500);
            return;
        }
        handleSubmit(processSubmit)();
    };


    const onOptimize = async () => {
        const message = form.getValues('message');
        if (!message || message.length < 10) {
            form.setError('message', { type: 'manual', message: 'Por favor, insira uma mensagem com pelo menos 10 caracteres para otimizar.' });
            return;
        }
        setIsOptimizing(true);
        try {
            const result = await handleOptimizeMessage({ message });
            setOptimizationResult(result);
        } catch (error) {
            toast({ variant: "destructive", title: "Erro na Otimização", description: error instanceof Error ? error.message : "Ocorreu um erro desconhecido." });
        } finally {
            setIsOptimizing(false);
        }
    };
    
    const validContacts = contacts || [];

    const recipientCount = useMemo(() => {
        const activeContacts = validContacts.filter(c => c.segment !== 'Inactive');
        switch (contactSegment) {
            case 'all':
                return activeContacts.length;
            default:
                return 0;
        }
    }, [contactSegment, validContacts]);

    const blockedCount = useMemo(() => validContacts.filter(c => c.segment === 'Inactive').length, [validContacts]);

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2">
            <nav aria-label="Progress" className="mb-8">
                <ol role="list" className="space-y-4 md:flex md:space-x-8 md:space-y-0">
                    {steps.map((step, index) => (
                    <li key={step.name} className="md:flex-1">
                        {currentStep > index ? (
                        <div className="group flex w-full flex-col border-l-4 border-primary py-2 pl-4 transition-colors md:border-l-0 md:border-t-4 md:pb-0 md:pl-0 md:pt-4">
                            <span className="text-sm font-medium text-primary transition-colors ">{step.id}</span>
                            <span className="text-sm font-medium">{step.name}</span>
                        </div>
                        ) : currentStep === index ? (
                        <div className="flex w-full flex-col border-l-4 border-primary py-2 pl-4 md:border-l-0 md:border-t-4 md:pb-0 md:pl-0 md:pt-4" aria-current="step">
                            <span className="text-sm font-medium text-primary">{step.id}</span>
                            <span className="text-sm font-medium">{step.name}</span>
                        </div>
                        ) : (
                        <div className="group flex w-full flex-col border-l-4 border-gray-200 py-2 pl-4 transition-colors md:border-l-0 md:border-t-4 md:pb-0 md:pl-0 md:pt-4">
                            <span className="text-sm font-medium text-gray-500 transition-colors">{step.id}</span>
                            <span className="text-sm font-medium">{step.name}</span>
                        </div>
                        )}
                    </li>
                    ))}
                </ol>
            </nav>

            <Form {...form}>
            <form onSubmit={(e) => e.preventDefault()} className="space-y-8">
                
                {/* Step 1: Recipients */}
                <div className={cn(currentStep !== 0 && "hidden")}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Etapa 1: Para quem vamos mandar?</CardTitle>
                            <CardDescription>Escolha o grupo de pessoas que receberá sua mensagem.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nome da Campanha</FormLabel>
                                    <FormControl><Input placeholder="Ex: Lançamento de Inverno" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            
                            <FormField control={form.control} name="contactSegment" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Grupo de Destinatários</FormLabel>
                                    <FormControl>
                                        <div className="grid grid-cols-1 gap-4 pt-2">
                                            <Label onClick={() => setValue('contactSegment', 'all', {shouldValidate: true})} className={cn("border-2 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary transition-all h-32", field.value === 'all' && 'border-primary ring-2 ring-primary')}>
                                                <Users className="w-8 h-8"/>
                                                <span className="font-bold text-center">Todos os Contatos</span>
                                            </Label>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                    {contactSegment && (
                                        <div className='pt-2'>
                                            <FormDescription>Esta campanha será enviada para <strong>{recipientCount}</strong> pessoas.</FormDescription>
                                        </div>
                                    )}
                                </FormItem>
                            )} />
                        </CardContent>
                    </Card>
                </div>
                
                {/* Step 2: Message */}
                <div className={cn(currentStep !== 1 && "hidden")}>
                    <MessageComposer form={form} onOptimize={onOptimize} isOptimizing={isOptimizing} />
                </div>
                
                {/* Step 3: Speed */}
                <div className={cn(currentStep !== 2 && "hidden")}>
                    <SpeedSelector form={form} />
                </div>
                
                {/* Step 4: Summary and Confirmation */}
                <div className={cn(currentStep !== 3 && "hidden")}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Etapa 4: Resumo e Confirmação</CardTitle>
                            <CardDescription>Revise os detalhes da sua campanha antes de iniciar o envio.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div>
                                <h3 className="font-medium">Resumo do Envio</h3>
                                <div className="mt-2 text-sm text-muted-foreground space-y-1">
                                    <p><strong>Campanha:</strong> {watch('name')}</p>
                                    <p><strong>Destinatários:</strong> {recipientCount} pessoas ({watch('contactSegment')})</p>
                                    <p><strong>Velocidade:</strong> {watch('sendSpeed') === 'safe' ? '🐢 Segura' : watch('sendSpeed') === 'fast' ? '🐇 Rápida' : '🚀 Turbo'}</p>
                                </div>
                            </div>

                             {sendSpeed === 'turbo' && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Modo de Alto Risco Ativado!</AlertTitle>
                                    <AlertDescription>
                                    O Modo Turbo aumenta significativamente a chance de bloqueio do seu número. Use com extrema cautela e apenas para contatos que esperam sua mensagem.
                                    </AlertDescription>
                                </Alert>
                            )}

                             <FormField control={form.control} name="liabilityAccepted" render={({ field }) => (
                                <FormItem className={cn("flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 transition-colors", submitError && !field.value ? "border-destructive ring-2 ring-destructive/50" : "")}>
                                    <FormControl>
                                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                    <div className="space-y-1 leading-none">
                                        <FormLabel>Prometo que esta lista de contatos me conhece e aceitou receber mensagens. Entendo o risco de bloqueio se abusar.</FormLabel>
                                         {submitError && !field.value && (
                                            <p className="text-sm font-medium text-destructive pt-2">Você deve aceitar os termos para continuar.</p>
                                        )}
                                        <FormMessage className='pt-2' />
                                    </div>
                                </FormItem>
                             )} />

                        </CardContent>
                    </Card>
                </div>
                
                {/* Navigation Buttons */}
                <div className="flex justify-between">
                    {currentStep === 0 ? (
                        <Button type="button" variant="ghost" onClick={() => router.push('/campaigns')} disabled={isSubmitting}>
                            Cancelar
                        </Button>
                    ) : (
                        <Button type="button" variant="ghost" onClick={prev} disabled={isSubmitting}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Anterior
                        </Button>
                    )}
                    
                    {currentStep < steps.length - 1 ? (
                        <Button type="button" onClick={next}>Próximo</Button>
                    ) : (
                        <Button 
                            type="button" 
                            onClick={handleFinalSubmit} 
                            size="lg"
                            disabled={isSubmitting}
                            className={cn(submitError && "animate-shake")}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Enviando...
                                </>
                            ) : (
                                <>
                                    <Send className="mr-2 h-4 w-4" /> Iniciar Disparo Agora
                                </>
                            )}
                        </Button>
                    )}
                </div>
            </form>
            </Form>
        </div>
        <div className="lg:col-span-1 sticky top-6">
            <Card>
                <CardHeader><CardTitle>Preview da Mensagem</CardTitle></CardHeader>
                <CardContent><PhonePreview message={messageValue || ''} media={mediaFile} buttons={buttons} /></CardContent>
            </Card>
        </div>
    </div>
    <Dialog open={!!optimizationResult} onOpenChange={(open) => !open && setOptimizationResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>✨ Correção Mágica com IA</DialogTitle>
            <DialogDescription>
              Analisamos sua mensagem e aqui estão nossas sugestões para melhorar o impacto.
            </DialogDescription>
          </DialogHeader>
          {optimizationResult && (
            <div className="grid gap-6 py-4">
              <Alert>
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Mensagem Corrigida e Otimizada</AlertTitle>
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
