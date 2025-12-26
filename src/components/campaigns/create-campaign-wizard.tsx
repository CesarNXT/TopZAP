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
  Loader2, Sparkles, AlertTriangle, Users, Star, Cake, ShieldX, ArrowLeft, Send, Zap, Rocket, CalendarClock, Clock, Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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
import { collection, addDoc, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { useMemoFirebase } from '@/firebase/provider';

import { createSimpleCampaignForUser, createAdvancedCampaignForUser } from '@/app/actions/whatsapp-actions';
import { uploadToCatbox } from '@/app/actions/upload-actions';

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
  dailyLimit: z.number().default(300),
  startDate: z.string().optional(),
  startHour: z.string().default("08:00"),
  nextDaysStartHour: z.string().default("08:00"),
}).refine(data => data.message || data.media, {
    message: "A campanha precisa ter uma mensagem ou um anexo de mídia.",
    path: ['message'],
}).refine((data) => {
    if (!data.startDate || !data.startHour) return true;
    const start = new Date(`${data.startDate}T${data.startHour}:00`);
    if (isNaN(start.getTime())) return true;
    // Allow 2 min tolerance for "just now" processing time
    return start.getTime() > Date.now() - 2 * 60 * 1000;
}, {
    message: "O horário de início não pode ser no passado. Ajuste para um horário futuro.",
    path: ["startHour"],
});

const steps = [
    { id: '01', name: 'Destinatários', fields: ['name', 'contactSegment'] },
    { id: '02', name: 'Mensagem', fields: ['message', 'media'] },
    { id: '03', name: 'Velocidade', fields: ['sendSpeed', 'startDate', 'startHour', 'nextDaysStartHour'] },
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
    const validContacts = contacts || [];

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: '',
            contactSegment: '',
            message: '',
            sendSpeed: 'safe',
            liabilityAccepted: false,
            dailyLimit: 300,
            startDate: format(new Date(), 'yyyy-MM-dd'),
            startHour: "08:00",
            nextDaysStartHour: "08:00",
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
    const startHour = watch('startHour');
    const nextDaysStartHour = watch('nextDaysStartHour');

    // Calculate Estimations
    const estimation = useMemo(() => {
        if (!contacts || !contactSegment) return null;
        
        let targetContacts = [];
        if (contactSegment === 'all') {
            targetContacts = validContacts.filter(c => c.segment !== 'Inactive');
        } else {
            targetContacts = validContacts.filter(c => c.segment === contactSegment);
        }
        
        const totalContacts = targetContacts.length;
        if (totalContacts === 0) return null;

        const limit = 300;
        const totalDays = Math.ceil(totalContacts / limit);
        
        // Speed Calculation (Average seconds per message)
        let avgSecondsPerMsg = 150; // Safe (120-180s)
        if (sendSpeed === 'fast') avgSecondsPerMsg = 90; // Normal (60-120s)
        if (sendSpeed === 'turbo') avgSecondsPerMsg = 70; // Turbo (60-80s)

        const batches = [];
        // Base date calculation
        let currentBatchDate = startDate ? new Date(startDate + 'T00:00:00') : new Date();
        
        // Parse Start Hours
        const parseTime = (time: string) => {
             const [h, m] = (time || "08:00").split(':').map(Number);
             return [h || 0, m || 0];
        };
        const [startH, startM] = parseTime(startHour);
        const [nextH, nextM] = parseTime(nextDaysStartHour);

        // Adjust currentBatchDate to the correct start time for the first day
        currentBatchDate.setHours(startH, startM, 0, 0);
        
        for (let i = 0; i < totalDays; i++) {
            const isFirstDay = i === 0;
            const batchSize = Math.min(limit, totalContacts - (i * limit));
            const durationSeconds = batchSize * avgSecondsPerMsg;
            
            // Determine start time for this batch
            let batchStart = new Date(currentBatchDate);
            if (!isFirstDay) {
                // For subsequent days, force the time to nextDaysStartHour
                // currentBatchDate is already incremented by days, now set hours
                batchStart.setHours(nextH, nextM, 0, 0);
            } else {
                 batchStart.setHours(startH, startM, 0, 0);
            }

            const batchEnd = new Date(batchStart.getTime() + (durationSeconds * 1000));
            
            // Check for warning: does it end too late? (e.g. after 22:00)
            const endHour = batchEnd.getHours();
            const isLate = endHour >= 22 || endHour < 6; // Warning if ends after 10PM or before 6AM (next day)
            const endsNextDay = batchEnd.getDate() !== batchStart.getDate();

            batches.push({
                day: i + 1,
                date: batchStart,
                count: batchSize,
                endTime: batchEnd,
                duration: durationSeconds,
                isLate,
                endsNextDay
            });
            
            // Move base date to next day for the loop
            currentBatchDate.setDate(currentBatchDate.getDate() + 1);
        }

        return batches;
    }, [contacts, contactSegment, validContacts, sendSpeed, startDate, startHour, nextDaysStartHour]);


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
                // Upload to Catbox
                const formData = new FormData();
                formData.append('reqtype', 'fileupload');
                formData.append('fileToUpload', values.media);
                
                const uploadResult = await uploadToCatbox(formData);
                if (uploadResult.error) {
                    throw new Error(uploadResult.error);
                }
                
                const mediaUrl = uploadResult.url;
                
                if (values.media.type.startsWith('image/')) {
                    messagesToSend.push({
                        image: mediaUrl,
                        caption: values.message || " ",
                        type: 'button', // Hint for whatsapp-actions
                        buttons: values.buttons // Attach buttons
                    });
                } else if (values.media.type.startsWith('video/')) {
                     messagesToSend.push({
                        video: mediaUrl,
                        caption: values.message || " ",
                        type: 'button',
                        buttons: values.buttons // Attach buttons
                    });
                } else if (values.media.type.startsWith('audio/')) {
                    messagesToSend.push({
                        audio: mediaUrl,
                        type: 'ptt' // Force PTT as requested
                    });
                     // If there's a text message with audio, we might need to send it separately or as caption?
                     // PTT usually doesn't have caption. 
                     // If user typed a message OR has buttons, we should send it as text after PTT.
                     if (values.message || (values.buttons && values.buttons.length > 0)) {
                         messagesToSend.push({
                             text: values.message || "Selecione uma opção:",
                             buttons: values.buttons,
                             type: 'button'
                         });
                     }
                } else {
                    // Document or other
                    messagesToSend.push({
                        document: mediaUrl,
                        fileName: values.media.name,
                        caption: values.message || " ",
                        buttons: values.buttons // Attach buttons
                    });
                }
            } catch (e) {
                console.error("File upload error", e);
                toast({ variant: "destructive", title: "Erro", description: "Falha ao processar arquivo de mídia (Catbox)." });
                setIsSubmitting(false);
                return;
            }
        } else if (values.message) {
            // Text only
            if (values.buttons && values.buttons.length > 0) {
                 messagesToSend.push({
                     text: values.message,
                     buttons: values.buttons,
                     type: 'button'
                 });
            } else {
                messagesToSend.push(values.message);
            }
        }

        // Get active phones
        let targetContacts = validContacts;
        if (values.contactSegment === 'all') {
            targetContacts = validContacts.filter(c => c.segment !== 'Inactive');
        } else {
            targetContacts = validContacts.filter(c => c.segment === values.contactSegment);
        }

        const phones = targetContacts.map(c => c.phone).filter(Boolean);

        if (phones.length === 0) {
            toast({ variant: "destructive", title: "Erro", description: "Nenhum contato válido encontrado para enviar." });
            setIsSubmitting(false);
            return;
        }

        // Call Server Action to Send
        // Batching Logic for Daily Limits
        const limit = 300; // Fixed daily limit
        const totalContacts = phones.length;
        const batches = [];
        
        for (let i = 0; i < totalContacts; i += limit) {
            batches.push(phones.slice(i, i + limit));
        }

        // Parse Start Hours
        const parseTime = (time: string) => {
             const [h, m] = (time || "08:00").split(':').map(Number);
             return [h || 0, m || 0];
        };
        const [startH, startM] = parseTime(values.startHour);
        const [nextH, nextM] = parseTime(values.nextDaysStartHour);

        // Base date calculation
        let currentBatchDate = values.startDate ? new Date(values.startDate + 'T00:00:00') : new Date();
        
        // Adjust first day time
        currentBatchDate.setHours(startH, startM, 0, 0);

        // Validation: Ensure start time is not in the past
        if (currentBatchDate.getTime() < Date.now() - 5 * 60 * 1000) { // 5 min tolerance
            toast({ variant: "destructive", title: "Horário Inválido", description: "O horário de início não pode ser no passado. Por favor, ajuste o horário." });
            setIsSubmitting(false);
            return;
        }

        let successCount = 0;
        let lastDocRef = null;

        for (let i = 0; i < batches.length; i++) {
            const batchPhones = batches[i];
            const batchIndex = i + 1;
            const isMultiBatch = batches.length > 1;
            
             // Set time for current batch
            let batchDate = new Date(currentBatchDate);
            if (i > 0) {
                 // For subsequent batches (days), use nextDaysStartHour
                 // currentBatchDate is already incremented by days (at end of loop), now set hours
                 batchDate.setHours(nextH, nextM, 0, 0);
            } else {
                 batchDate.setHours(startH, startM, 0, 0);
            }
            
            // Calculate scheduled timestamp (milliseconds)
            const scheduledFor = batchDate.getTime();
            
            const batchName = isMultiBatch ? `${values.name} (Dia ${batchIndex})` : values.name;

            let sendResult;

            // Use Simple Campaign endpoint if we have a single message (User preference/Reliability)
            if (messagesToSend.length === 1) {
                console.log(`[Wizard] Using Simple Campaign for '${batchName}'`);
                sendResult = await createSimpleCampaignForUser(
                    user.uid,
                    batchName,
                    values.sendSpeed as any,
                    messagesToSend[0],
                    batchPhones,
                    undefined, // info
                    scheduledFor
                );
            } else {
                console.log(`[Wizard] Using Advanced Campaign for '${batchName}' (Messages: ${messagesToSend.length})`);
                sendResult = await createAdvancedCampaignForUser(
                    user.uid,
                    values.sendSpeed as any,
                    messagesToSend,
                    batchPhones,
                    undefined,
                    scheduledFor,
                    values.buttons
                );
            }

            if (sendResult.error) {
                 toast({ variant: "destructive", title: `Erro no Lote ${batchIndex}`, description: sendResult.error });
                 continue; // Continue with next batch? Or stop? Let's continue.
            }

            const newCampaign: Omit<Campaign, 'id'> = {
                name: batchName,
                status: 'Scheduled', // Since we are scheduling
                sentDate: new Date(scheduledFor).toISOString(),
                recipients: batchPhones.length,
                engagement: 0,
                userId: user.uid,
            };

            try {
                const campaignCollection = collection(firestore, 'users', user.uid, 'campaigns');
                
                const uazapiId = sendResult.id || sendResult.folderId || sendResult.campaignId || sendResult.folder_id;
                let docRef;
    
                if (uazapiId) {
                    docRef = doc(campaignCollection, String(uazapiId));
                    await setDoc(docRef, newCampaign);
                } else {
                    docRef = await addDoc(campaignCollection, newCampaign);
                }
                
                successCount++;
                lastDocRef = docRef;

            } catch (e) {
                console.error("Error creating campaign doc", e);
                toast({ variant: "destructive", title: `Erro ao salvar campanha`, description: "A campanha foi enviada mas houve erro ao salvar no histórico." });
            }

            // Prepare date for next batch
            currentBatchDate.setDate(currentBatchDate.getDate() + 1);
        }
        
        if (successCount > 0) {
            // Update 'New' contacts to 'Regular'
            const newContacts = targetContacts.filter(c => c.segment === 'New' || c.segment === 'new');
            if (newContacts.length > 0) {
                console.log(`[Wizard] Updating ${newContacts.length} contacts from New to Regular...`);
                const chunkSize = 500;
                for (let i = 0; i < newContacts.length; i += chunkSize) {
                    const chunk = newContacts.slice(i, i + chunkSize);
                    const batch = writeBatch(firestore);
                    chunk.forEach(contact => {
                        if (contact.id) {
                            const contactRef = doc(firestore, 'users', user.uid, 'contacts', contact.id);
                            batch.update(contactRef, { segment: 'Regular' });
                        }
                    });
                    await batch.commit();
                }
            }

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

    const uniqueSegments = useMemo(() => {
        const segments = new Set(validContacts.map(c => c.segment).filter(Boolean));
        return Array.from(segments).filter(s => s !== 'Inactive');
    }, [validContacts]);

    const recipientCount = useMemo(() => {
        if (contactSegment === 'all') {
            return validContacts.filter(c => c.segment !== 'Inactive').length;
        }
        return validContacts.filter(c => c.segment === contactSegment).length;
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
                            <CardDescription>Escolha o status dos contatos que receberão sua mensagem.</CardDescription>
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
                                    <FormLabel>Status dos Destinatários</FormLabel>
                                    <FormControl>
                                        <div className="grid grid-cols-2 gap-4 pt-2">
                                            <Label onClick={() => setValue('contactSegment', 'all', {shouldValidate: true})} className={cn("border-2 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary transition-all h-32", field.value === 'all' && 'border-primary ring-2 ring-primary bg-primary/5')}>
                                                <Users className="w-8 h-8"/>
                                                <span className="font-bold text-center">Todos os Contatos</span>
                                                <span className="text-xs text-muted-foreground">{validContacts.filter(c => c.segment !== 'Inactive').length} contatos</span>
                                            </Label>
                                            {uniqueSegments.map(segment => (
                                                <Label key={segment} onClick={() => setValue('contactSegment', segment, {shouldValidate: true})} className={cn("border-2 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary transition-all h-32", field.value === segment && 'border-primary ring-2 ring-primary bg-primary/5')}>
                                                    <Star className="w-6 h-6"/>
                                                    <span className="font-bold text-center">{segment}</span>
                                                    <span className="text-xs text-muted-foreground">{validContacts.filter(c => c.segment === segment).length} contatos</span>
                                                </Label>
                                            ))}
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
                        
                        {estimation && estimation.length > 0 && (
                            <Card className="mt-6 border-blue-100 bg-blue-50/50">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <CalendarClock className="h-5 w-5 text-blue-600" />
                                        Cronograma Estimado de Envio
                                    </CardTitle>
                                    <CardDescription>
                                        Previsão baseada na velocidade média e limite de 300 msg/dia.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {estimation.map((batch) => (
                                            <div key={batch.day} className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-3 rounded-md border border-blue-100 text-sm">
                                                <div className="flex items-center gap-3 mb-2 sm:mb-0">
                                                    <div className="bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded text-xs w-16 text-center">
                                                        Lote {batch.day}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-gray-700">
                                                            {format(batch.date, "dd/MM/yyyy", { locale: ptBR })}
                                                        </span>
                                                        <span className="text-gray-500 text-xs">
                                                            {batch.count} contatos
                                                        </span>
                                                    </div>
                                                </div>
                                                
                                                <div className="flex items-center gap-4 text-gray-600">
                                                    <div className="flex items-center gap-1" title="Início Estimado">
                                                        <Clock className="h-3 w-3" />
                                                        <span>{format(batch.date, "HH:mm")}</span>
                                                    </div>
                                                    <span className="text-gray-300">→</span>
                                                    <div className={`flex items-center gap-1 ${batch.isLate || batch.endsNextDay ? "text-amber-600 font-medium" : ""}`} title="Término Estimado">
                                                        <span>{format(batch.endTime, "HH:mm")}</span>
                                                        {batch.endsNextDay && <span className="text-[10px] bg-amber-100 px-1 rounded ml-1">+1 dia</span>}
                                                    </div>
                                                </div>

                                                {(batch.isLate || batch.endsNextDay) && (
                                                    <div className="w-full sm:w-auto mt-2 sm:mt-0 sm:ml-4 text-amber-600 flex items-center gap-1 text-xs">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        <span className="sm:hidden">Atenção: Termina tarde</span>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        
                                        <div className="mt-4 flex gap-2 text-xs text-gray-500 bg-white/50 p-2 rounded">
                                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                            <p>
                                                Importante: O horário de término é uma estimativa. Se o envio ultrapassar o horário comercial ou entrar na madrugada, recomendamos ajustar o horário de início ou reduzir a velocidade para evitar bloqueios.
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
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
