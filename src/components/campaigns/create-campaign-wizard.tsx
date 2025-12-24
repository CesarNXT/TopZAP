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
import { contacts as defaultContacts } from '@/lib/data';
import { MessageComposer } from './message-composer';
import { SpeedSelector } from './speed-selector';
import { v4 as uuidv4 } from 'uuid';
import type { Contact, Campaign } from '@/lib/types';

const formSchema = z.object({
  name: z.string().min(5, { message: 'O nome da campanha deve ter pelo menos 5 caracteres.' }),
  contactSegment: z.string().min(1, { message: 'Por favor, selecione um grupo de destinatários.' }),
  message: z.string().optional(),
  sendSpeed: z.string().default('safe'),
  liabilityAccepted: z.boolean().refine((val) => val === true, {
    message: 'Você deve aceitar os termos de responsabilidade para continuar.',
  }),
  media: z.any().optional(),
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
    const [currentStep, setCurrentStep] = useState(0);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizationResult, setOptimizationResult] = useState<OptimizeMessageContentOutput | null>(null);
    const [submitError, setSubmitError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [contacts, setContacts] = useState<Contact[]>([]);

    useEffect(() => {
        try {
            const storedContacts = localStorage.getItem('contacts');
            setContacts(storedContacts ? JSON.parse(storedContacts) : defaultContacts);
        } catch (error) {
            console.error("Failed to parse contacts from localStorage", error);
            setContacts(defaultContacts);
        }
    }, []);

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

    const { watch, setValue, trigger, reset, handleSubmit, formState: { errors } } = form;
    const messageValue = watch('message');
    const mediaFile = watch('media');
    const sendSpeed = watch('sendSpeed');
    const contactSegment = watch('contactSegment');

    const next = async () => {
        const fields = steps[currentStep].fields;
        const output = await trigger(fields as any, { shouldFocus: true });
        if (!output) return;
        if (currentStep < steps.length - 1) setCurrentStep(step => step + 1);
    }
    const prev = () => {
        if (currentStep > 0) setCurrentStep(step => step - 1);
    }

    const processSubmit = (values: z.infer<typeof formSchema>) => {
        setIsSubmitting(true);
        console.log(values);

        const newCampaign: Campaign = {
            id: uuidv4(),
            name: values.name,
            status: 'Sent',
            sentDate: new Date().toISOString(),
            recipients: recipientCount,
            engagement: Math.floor(Math.random() * (95 - 60 + 1) + 60), // Mock engagement
        };

        // Simulate API call
        setTimeout(() => {
            toast({
                title: "Campanha Enviada para a Fila!",
                description: `A campanha "${values.name}" foi iniciada com sucesso.`
            });
            
            try {
                const existingCampaigns: Campaign[] = JSON.parse(localStorage.getItem('campaigns') || '[]');
                localStorage.setItem('campaigns', JSON.stringify([newCampaign, ...existingCampaigns]));
                sessionStorage.setItem('newlyCreatedCampaignId', newCampaign.id);
            } catch (error) {
                 console.error("Failed to save campaign to localStorage", error);
            }
            
            router.push('/campaigns');

        }, 1500);
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

    const recipientCount = useMemo(() => {
        const activeContacts = contacts.filter(c => c.segment !== 'Inactive');
        switch (contactSegment) {
            case 'common':
                return activeContacts.filter(c => c.segment !== 'VIP').length;
            case 'vip':
                return activeContacts.filter(c => c.segment === 'VIP').length;
            case 'birthday':
                const currentMonth = new Date().getMonth();
                return activeContacts.filter(c => c.birthday && new Date(c.birthday).getMonth() === currentMonth).length;
            default:
                return 0;
        }
    }, [contactSegment, contacts]);

    const blockedCount = useMemo(() => contacts.filter(c => c.segment === 'Inactive').length, [contacts]);

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
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                            <Label onClick={() => setValue('contactSegment', 'common', {shouldValidate: true})} className={cn("border-2 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary transition-all h-32", field.value === 'common' && 'border-primary ring-2 ring-primary')}>
                                                <Users className="w-8 h-8"/>
                                                <span className="font-bold text-center">Clientes Comuns</span>
                                            </Label>
                                            <Label onClick={() => setValue('contactSegment', 'vip', {shouldValidate: true})} className={cn("border-2 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-yellow-500 transition-all h-32", field.value === 'vip' && 'border-yellow-500 ring-2 ring-yellow-500 text-yellow-600')}>
                                                <Star className="w-8 h-8"/>
                                                <span className="font-bold text-center">Clientes VIP</span>
                                            </Label>
                                            <Label onClick={() => setValue('contactSegment', 'birthday', {shouldValidate: true})} className={cn("border-2 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-pink-500 transition-all h-32", field.value === 'birthday' && 'border-pink-500 ring-2 ring-pink-500 text-pink-600')}>
                                                <Cake className="w-8 h-8"/>
                                                <span className="font-bold text-center">Aniversariantes do Mês</span>
                                            </Label>
                                            <div className="border-2 rounded-lg p-4 flex flex-col items-center justify-center gap-2 bg-muted/50 text-muted-foreground h-32">
                                                <ShieldX className="w-8 h-8"/>
                                                <span className="font-bold text-center">{blockedCount} Contatos Bloqueados</span>
                                                <span className="text-xs text-center">Estes contatos são ignorados automaticamente.</span>
                                            </div>
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
                    <Button type="button" variant="ghost" onClick={prev} disabled={currentStep === 0 || isSubmitting}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Anterior
                    </Button>
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
                <CardContent><PhonePreview message={messageValue} media={mediaFile} /></CardContent>
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
