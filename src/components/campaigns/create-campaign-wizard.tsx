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
import { format, addDays, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useState, useMemo, useEffect, useRef } from 'react';
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
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { PhonePreview } from './phone-preview';
import { cn } from '@/lib/utils';
import { MessageComposer } from './message-composer';
import { SpeedSelector } from './speed-selector';
import { v4 as uuidv4 } from 'uuid';
import type { Contact, Campaign } from '@/lib/types';
import { useUser, useFirestore, useCollection, useFirebase } from '@/firebase';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { collection, addDoc, doc, getDoc, writeBatch, query, where } from 'firebase/firestore';
import { uploadFileToStorage } from '@/lib/storage-utils';
import { useMemoFirebase } from '@/firebase/provider';

import { createSimpleCampaignForUser, createAdvancedCampaignForUser, createSimpleCampaignProviderOnly, createAdvancedCampaignProviderOnly, createManagedCampaign } from '@/app/actions/campaign-actions';
import { createTag, getTags, batchAssignTagToContacts } from '@/app/actions/tag-actions';
import { standardizeContactStatuses } from '@/app/actions/migration-actions';
import { uploadToCatbox } from '@/app/actions/upload-actions';
import { calculateCampaignSchedule } from '@/lib/campaign-schedule';

import { ScheduleManager } from './schedule-manager';
import type { ScheduleRule } from '@/lib/campaign-schedule';

const formSchema = z.object({
  name: z.string().min(1, { message: 'O nome da campanha é obrigatório.' }),
  contactSegment: z.string().optional(),
  selectedContactId: z.string().optional(),
  selectedTagId: z.string().optional(),
  message: z.string().optional(),
  sendSpeed: z.string().default('slow'),
  buttons: z.array(z.object({
    id: z.string(),
    text: z.string()
  })).max(4, { message: "Máximo de 4 botões permitidos." }).optional(),
  liabilityAccepted: z.boolean().refine((val) => val === true, {
    message: 'Você deve aceitar os termos de responsabilidade para continuar.',
  }),
  media: z.any().optional(),
  startDate: z.string().optional(),
  startHour: z.string().default("08:00"),
  endHour: z.string().default("18:00"),
}).refine(data => data.message || data.media, {
    message: "A campanha precisa ter uma mensagem ou um anexo de mídia.",
    path: ['message'],
}).refine(data => {
    if (!data.contactSegment) return false;
    if (data.contactSegment === 'tag' && !data.selectedTagId) return false;
    return true;
}, {
    message: "Selecione um segmento ou etiqueta válida.",
    path: ['contactSegment']
}).refine((data) => {
    if (!data.startDate || !data.startHour) return true;
    const start = new Date(`${data.startDate}T${data.startHour}:00`);
    if (isNaN(start.getTime())) return true;
    // Allow 2 min tolerance for "just now" processing time
    return start.getTime() > Date.now() - 2 * 60 * 1000;
}, {
    message: "O horário de início não pode ser no passado. Por favor, ajuste para um horário futuro.",
    path: ["startHour"],
});

const steps = [
    { id: '01', name: 'Destinatários', fields: ['name', 'contactSegment'] },
    { id: '02', name: 'Mensagem', fields: ['message', 'media'] },
    { id: '03', name: 'Velocidade', fields: ['sendSpeed', 'startDate', 'startHour', 'endHour'] },
    { id: '04', name: 'Confirmar e Enviar' }
]

export function CreateCampaignWizard() {
    const router = useRouter();
    const { user } = useUser();
    const { storage } = useFirebase();
    const firestore = useFirestore();

    // Auto-migration
    useEffect(() => {
        if (user?.uid) {
            standardizeContactStatuses(user.uid);
        }
    }, [user?.uid]);

    const [currentStep, setCurrentStep] = useState(0);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizationResult, setOptimizationResult] = useState<OptimizeMessageContentOutput | null>(null);
    const [submitError, setSubmitError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isSubmittingRef = useRef(false);
    const [tags, setTags] = useState<any[]>([]);
    const [selectedTagId, setSelectedTagId] = useState<string>('');
    const [scheduleRules, setScheduleRules] = useState<ScheduleRule[]>([]);

    useEffect(() => {
        if (user) {
            getTags(user.uid).then(res => {
                if (res.success && res.data) setTags(res.data);
            });
        }
    }, [user]);

    const contactsQuery = useMemoFirebase(() => {
        if (!user) return null;
        return collection(firestore, 'users', user.uid, 'contacts');
    }, [firestore, user]);

    const { data: contacts, loading: contactsLoading } = useCollection<Contact>(contactsQuery);
    const validContacts = contacts || [];

    // Query active campaigns for overlap check
    const activeCampaignsQuery = useMemoFirebase(() => {
        if (!user) return null;
        return query(
            collection(firestore, 'users', user.uid, 'campaigns'),
            where('status', 'in', ['Scheduled', 'Sending'])
        );
    }, [firestore, user]);

    const { data: activeCampaigns, loading: checkingSchedule } = useCollection<Campaign>(activeCampaignsQuery);
    
    // Fallback: If contacts array is empty but loading is true, we should wait.
    // If loading is false and contacts is empty, maybe we should try to fetch via batch if we suspect an issue?
    // But usually simple collection fetch works. The main issue is likely the UI showing 0 during load.
    
    // Add effect to toast loading state if it takes too long
    useEffect(() => {
        if (contactsLoading) {
            // Optional: could show a toast or just rely on the UI spinner we will add
        }
    }, [contactsLoading]);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: '',
            contactSegment: 'all',
            message: '',
            sendSpeed: 'slow',
            liabilityAccepted: false,
            startDate: format(new Date(), 'yyyy-MM-dd'),
            startHour: (() => {
                const now = new Date();
                // Set to 5 minutes in the future to allow time for creation
                const targetTime = new Date(now.getTime() + 5 * 60 * 1000);
                return format(targetTime, 'HH:mm');
            })(),
            endHour: "18:00",
        },
    });

    const { watch, setValue, trigger, handleSubmit, formState: { errors } } = form;
    const messageValue = watch('message');
    const mediaFile = watch('media');
    const sendSpeed = watch('sendSpeed');
    const contactSegment = watch('contactSegment');
    const selectedContactId = watch('selectedContactId');
    const selectedTagIdForm = watch('selectedTagId');
    const buttons = watch('buttons');
    const startDate = watch('startDate');
    const startHour = watch('startHour');
    const endHour = watch('endHour');

    // Calculate props for ScheduleManager
    const scheduleProps = useMemo(() => {
        if (!contacts || !contactSegment) return null;
        
        let targetContacts: Contact[] = [];
        if (contactSegment === 'individual') {
            if (selectedContactId) {
                const contact = validContacts.find(c => c.id === selectedContactId);
                if (contact) targetContacts = [contact];
            }
        } else if (contactSegment === 'all') {
            targetContacts = validContacts.filter(c => c.segment === 'Active');
        } else if (contactSegment === 'tag') {
            targetContacts = validContacts.filter(c => c.segment === 'Active' && c.tags?.includes(selectedTagIdForm || ''));
        } else {
            targetContacts = validContacts.filter(c => c.segment === contactSegment);
        }
        
        const totalContacts = targetContacts.length;
        if (totalContacts === 0) return null;

        // Speed Calculation (Average seconds per message)
        let speedConfig = { minDelay: 170, maxDelay: 190 }; // Slow
        if (sendSpeed === 'medium') speedConfig = { minDelay: 110, maxDelay: 130 };
        if (sendSpeed === 'fast') speedConfig = { minDelay: 50, maxDelay: 70 };

        // Parse Start/End Hours
        let startDateTime = startDate ? new Date(startDate + 'T00:00:00') : new Date();
        const [h, m] = (startHour || "08:00").split(':').map(Number);
        startDateTime.setHours(h || 8, m || 0, 0, 0);

        return {
            totalContacts,
            speedConfig,
            startDate: startDateTime,
            defaultWorkingHours: {
                start: startHour || "08:00",
                end: endHour || "18:00"
            }
        };
    }, [contacts, contactSegment, validContacts, sendSpeed, startDate, startHour, endHour, selectedTagIdForm, selectedContactId]);


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
        if (isSubmitting || isSubmittingRef.current) return;
        
        isSubmittingRef.current = true;
        setIsSubmitting(true);
        
        if (!user) {
            toast({ variant: "destructive", title: "Erro", description: "Você precisa estar logado para criar uma campanha." });
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            return;
        }
        try {
            const userDocRef = doc(firestore, 'users', user.uid);
            const userSnap = await getDoc(userDocRef);
            const data = userSnap.data() as any;
            const isConnected = data?.uazapi?.connected === true || data?.uazapi?.status === 'connected';
            if (!isConnected) {
                toast({ variant: "destructive", title: "Erro", description: "Você precisa estar conectado ao WhatsApp para enviar uma campanha." });
                isSubmittingRef.current = false;
                setIsSubmitting(false);
                return;
            }
        } catch (e) {
            toast({ variant: "destructive", title: "Erro", description: "Falha ao verificar conexão com o WhatsApp." });
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            return;
        }

        if (checkingSchedule) {
             toast({ title: "Verificando agenda...", description: "Aguarde enquanto verificamos a disponibilidade de horário." });
             isSubmittingRef.current = false;
             setIsSubmitting(false);
             return;
        }

        try {
        // --- FRONTEND OVERLAP VALIDATION ---
        if (scheduleProps && activeCampaigns && activeCampaigns.length > 0) {
            
            // ADJUST FOR START NOW
            let effectiveStartDate = scheduleProps.startDate;
            const effectiveRules = scheduleRules ? [...scheduleRules] : [];

            // 1. Calculate NEW campaign range
            const simulatedBatches = calculateCampaignSchedule(
                scheduleProps.totalContacts,
                scheduleProps.speedConfig,
                effectiveStartDate,
                scheduleProps.defaultWorkingHours,
                effectiveRules
            );

            if (simulatedBatches.length > 0) {
                const newStart = simulatedBatches[0].startTime.getTime();
                const newEnd = simulatedBatches[simulatedBatches.length - 1].endTime.getTime();

                // 2. Check against Active Campaigns
                for (const campaign of activeCampaigns) {
                    const existingStart = campaign.scheduledAt ? new Date(campaign.scheduledAt).getTime() : 0;
                    let existingEnd = existingStart;

                    if (campaign.batches) {
                        const batchKeys = Object.keys(campaign.batches);
                        if (batchKeys.length > 0) {
                            for (const key of batchKeys) {
                                const b = campaign.batches[key];
                                if (b.endTime) {
                                    const t = new Date(b.endTime).getTime();
                                    if (t > existingEnd) existingEnd = t;
                                }
                            }
                        } else {
                            existingEnd = existingStart + (1000 * 60 * 60); // 1h fallback
                        }
                    } else {
                        // Fallback for legacy campaigns
                        existingEnd = existingStart + (1000 * 60 * 60); 
                    }

                    // Check Overlap
                    // (StartA < EndB) and (EndA > StartB)
                    if (newStart < existingEnd && newEnd > existingStart) {
                        const existingName = campaign.name || 'Sem nome';
                        const startStr = new Date(existingStart).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                        const endStr = new Date(existingEnd).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                        
                        toast({
                            variant: "destructive",
                            title: "Conflito de Horário",
                            description: `A campanha "${existingName}" já está agendada de ${startStr} até ${endStr}. O sistema não permite campanhas simultâneas para garantir a segurança da conta.`
                        });
                        
                        isSubmittingRef.current = false;
                        setIsSubmitting(false);
                        return;
                    }
                }
            }
        }

        // Filter out empty buttons (User Request: "Se o botão ficar vazio não envie")
        if (values.buttons) {
            values.buttons = values.buttons.filter(b => b.text && b.text.trim() !== '');
        }

        // Prepare buttons as choices for UAZAPI
        const mapButtonsToChoices = (buttons: any[]) => {
            if (!buttons) return [];
            return buttons
                .filter(b => b.text && b.text.trim() !== '') // Filter out empty buttons
                .map(b => {
                    // UAZAPI expects "Text|id" for reply buttons
                    // "Text|copy:code", "Text|call:number", "Text|url:link" for others
                    if (b.id && b.id.includes(':')) {
                         return `${b.text}|${b.id}`;
                    }
                    return `${b.text}|${b.id}`;
                });
        };

        const choices = mapButtonsToChoices(values.buttons);

        // Prepare messages for uazapi
        const messagesToSend: any[] = [];
        if (values.media) {
            try {
                let mediaUrl = '';
                
                // Strategy: Prioritize Firebase Storage (Client Side) for reliability
                // Fallback to Catbox (Server Action) only if Storage is unavailable or fails
                
                let uploadSuccess = false;

                // 1. Upload to Firebase Storage
                if (storage && user) {
                    try {
                        console.log("Starting upload to Firebase Storage...");
                        // Sanitize filename
                        const safeName = values.media.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                        const path = `campaigns/${user.uid}/${Date.now()}_${safeName}`;
                        
                        mediaUrl = await uploadFileToStorage(storage, values.media, path);
                        
                        if (mediaUrl) {
                            uploadSuccess = true;
                            console.log("Firebase Storage upload successful:", mediaUrl);
                        }
                    } catch (storageError) {
                        console.error("Firebase Storage upload failed:", storageError);
                        throw new Error("Falha no upload do arquivo para o Storage. Tente novamente.");
                    }
                } else {
                    throw new Error("Serviço de armazenamento não disponível.");
                }

                if (!uploadSuccess || !mediaUrl) {
                     throw new Error("Falha ao obter URL da mídia após upload.");
                }

                if (values.media.type.startsWith('image/')) {
                    // Combine Image + Text + Buttons into a single message
                    // UAZAPI supports imageButton in /send/menu
                    messagesToSend.push({
                         file: mediaUrl,
                         text: values.message || " ", 
                         choices: choices || [],
                         type: 'image' // Cron job will convert to button+imageButton if choices exist
                     });

                } else if (values.media.type.startsWith('video/')) {
                     // Split into Video + Text/Buttons to ensure compatibility
                     messagesToSend.push({
                        file: mediaUrl, // Changed from video to file as per UAZAPI docs
                        caption: "", 
                        type: 'video'
                    });
                    
                    // Video followed by text/buttons ONLY if they exist
                    // FIX: Always send button message to ensure Block button is included
                    messagesToSend.push({
                        text: values.message || "Confira o vídeo acima:",
                        choices: choices || [],
                        type: 'button'
                    });

                } else if (values.media.type.startsWith('audio/')) {
                    messagesToSend.push({
                        file: mediaUrl, // Changed from audio to file as per UAZAPI docs
                        type: 'audio', // Changed from ptt to audio to match docs standard types
                        ptt: true // Add ptt flag if needed, or rely on type 'audio'
                    });
                     
                     // Audio followed by text/buttons ONLY if they exist
                     // FIX: Always send button message to ensure Block button is included
                     messagesToSend.push({
                         text: values.message || "Áudio recebido",
                         choices: choices || [],
                         type: 'button'
                     });

                } else {
                    // Document or other
                    // Split Document + Text/Buttons
                    messagesToSend.push({
                        file: mediaUrl, // Changed from document to file as per UAZAPI docs
                        docName: values.media.name, // Ensure docName is correct key
                        fileName: values.media.name, // Keep fileName just in case, but docName is in docs
                        caption: "", 
                        type: 'document' 
                    });

                     // FIX: Always send button message to ensure Block button is included
                    messagesToSend.push({
                        text: values.message || "Segue o documento:",
                        choices: choices || [],
                        type: 'button'
                    });
                }
            } catch (e: any) {
                console.error("File upload error", e);
                
                // Safe error message extraction
                let errorMessage = "Falha ao processar arquivo de mídia.";
                if (e) {
                    if (typeof e === 'string') errorMessage = e;
                    else if (e.message) errorMessage = e.message;
                    else if (e.error) errorMessage = e.error; 
                }

                toast({
                    variant: "destructive",
                    title: "Erro no Upload",
                    description: errorMessage
                });
                setIsSubmitting(false);
                return;
            }
        } else if (values.message) {
            // Text only
            // FIX: Always use 'button' type to allow backend to inject Mandatory Block button
            messagesToSend.push({
                text: values.message,
                choices: choices || [],
                type: 'button'
            });
        }

        // Get active phones
        let targetContacts: Contact[] = [];
        if (values.contactSegment === 'individual') {
            if (values.selectedContactId) {
                const contact = validContacts.find(c => c.id === values.selectedContactId);
                if (contact) targetContacts = [contact];
            }
        } else if (values.contactSegment === 'all') {
            targetContacts = validContacts.filter(c => c.segment === 'Active');
        } else if (values.contactSegment === 'tag') {
            targetContacts = validContacts.filter(c => c.segment === 'Active' && c.tags?.includes(values.selectedTagId || ''));
        } else {
            targetContacts = validContacts.filter(c => c.segment === values.contactSegment);
        }

        const phones = targetContacts.map(c => c.phone).filter(Boolean);

        if (phones.length === 0) {
            toast({ variant: "destructive", title: "Erro", description: "Nenhum contato válido encontrado para enviar." });
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            return;
        }

        // Auto-Tag Logic: Create/Assign Tag for this Campaign
        try {
            const campaignTagName = values.name;
            const existingTagsRes = await getTags(user.uid);
            let tagId = '';
            
            if (existingTagsRes.success && existingTagsRes.data) {
                const existingTag = existingTagsRes.data.find((t: any) => t.name.toLowerCase() === campaignTagName.toLowerCase());
                if (existingTag) {
                    tagId = existingTag.id;
                }
            }
            
            if (!tagId) {
                const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#64748b'];
                const randomColor = colors[Math.floor(Math.random() * colors.length)];
                const createRes = await createTag(user.uid, campaignTagName, randomColor);
                if (createRes.success && createRes.data) {
                    tagId = createRes.data.id;
                }
            }

            if (tagId) {
                 const contactIds = targetContacts.map(c => c.id);
                 await batchAssignTagToContacts(user.uid, tagId, contactIds);
                 console.log(`Assigned tag '${campaignTagName}' to ${contactIds.length} contacts.`);
            }
        } catch (err) {
            console.error("Error auto-tagging contacts:", err);
            // Continue even if tagging fails
        }

        // --- NEW MANAGED CAMPAIGN LOGIC ---
        
        // Determine Speed Config
        let speedConfig = {
            mode: 'slow' as 'slow' | 'normal' | 'fast',
            minDelay: 170,
            maxDelay: 190
        };

        if (values.sendSpeed === 'fast') {
            speedConfig = { mode: 'fast', minDelay: 50, maxDelay: 70 };
        } else if (values.sendSpeed === 'medium') { // 'medium' in form maps to 'normal' logic
            speedConfig = { mode: 'normal', minDelay: 110, maxDelay: 130 };
        } else {
            // Slow
            speedConfig = { mode: 'slow', minDelay: 170, maxDelay: 190 };
        }

        // Prepare Recipients
        const recipients = targetContacts.map(c => ({
            name: c.name || '',
            phone: c.phone || '',
            // Add other fields if needed for personalization
        }));

        // Determine Schedule Time
        let scheduledAt = new Date().toISOString();
        if (values.startDate && values.startHour) {
             // Force Brasilia Time Zone (-03:00) as per user requirement "horario de brasilia"
             const startDateTime = new Date(`${values.startDate}T${values.startHour}:00-03:00`);
             if (!isNaN(startDateTime.getTime())) {
                 scheduledAt = startDateTime.toISOString();
             }
        }

        const result = await createManagedCampaign({
            userId: user.uid,
            name: values.name,
            messageTemplate: messagesToSend,
            recipients,
            speedConfig,
            scheduledAt,
            startNow: false,
            workingHours: {
                start: values.startHour || "08:00",
                end: values.endHour || "18:00"
            },
            scheduleRules: scheduleRules
        });

        console.log("Managed Campaign Creation Result:", result);

        if (result.success) {
            toast({ title: "Campanha Criada!", description: `Campanha agendada com sucesso. ID: ${result.campaignId}` });
            router.push('/campaigns');
        } else {
            console.error("Campaign Creation Failed:", result.error);
            toast({ variant: "destructive", title: "Erro", description: result.error || "Erro ao criar campanha." });
            isSubmittingRef.current = false;
            setIsSubmitting(false);
        }

    } catch (globalError: any) {
        console.error("Critical error in processSubmit:", globalError);
        toast({ 
            variant: "destructive", 
            title: "Erro Crítico", 
            description: globalError.message || "Ocorreu um erro inesperado ao criar a campanha." 
        });
        isSubmittingRef.current = false;
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
        // Only allow 'New' segment to be selectable individually as per user request
        return Array.from(segments).filter(s => s === 'New' || s === 'new');
    }, [validContacts]);

    const recipientCount = useMemo(() => {
        if (contactSegment === 'individual') {
            return selectedContactId ? 1 : 0;
        }
        if (contactSegment === 'all') {
            return validContacts.filter(c => c.segment === 'Active').length;
        }
        if (contactSegment === 'tag') {
            return validContacts.filter(c => c.segment === 'Active' && c.tags?.includes(selectedTagId || '')).length;
        }
        return validContacts.filter(c => c.segment === contactSegment).length;
    }, [contactSegment, validContacts, selectedContactId, selectedTagId]);

    const blockedCount = useMemo(() => validContacts.filter(c => c.segment === 'Blocked').length, [validContacts]);

  return (
    <div className="relative">
        {isSubmitting && (
            <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center flex-col gap-4 h-full min-h-[500px] rounded-lg">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <div className="text-lg font-semibold">Criando sua campanha...</div>
                <p className="text-sm text-muted-foreground">Isso pode levar alguns segundos. Não feche a página.</p>
            </div>
        )}
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
                                    <FormLabel>Quem receberá esta campanha?</FormLabel>
                                    <FormControl>
                                        <RadioGroup
                                            onValueChange={field.onChange}
                                            defaultValue={field.value}
                                            value={field.value}
                                            className="pt-2 flex flex-col gap-4"
                                        >
                                            {/* All Contacts Option */}
                                            <div>
                                                <RadioGroupItem value="all" id="segment-all" className="peer sr-only" />
                                                <Label
                                                    htmlFor="segment-all"
                                                    className={cn(
                                                        "border-2 rounded-lg p-4 flex items-center gap-4 h-24 cursor-pointer hover:bg-muted transition-colors",
                                                        field.value === 'all' ? "border-primary ring-2 ring-primary bg-primary/5" : "border-muted"
                                                    )}
                                                >
                                                    <div className="bg-primary/10 p-3 rounded-full">
                                                        <Users className="w-6 h-6 text-primary"/>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-lg">Todos os Contatos</span>
                                                        <span className="text-sm text-muted-foreground">
                                                            Sua campanha será enviada para toda a base de contatos ativos.
                                                        </span>
                                                    </div>
                                                    <div className="ml-auto font-medium text-primary bg-white px-3 py-1 rounded-full border border-primary/20 shadow-sm">
                                                        {contactsLoading ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            `${validContacts.filter(c => c.segment === 'Active').length} contatos`
                                                        )}
                                                    </div>
                                                </Label>
                                            </div>

                                            {/* Tag Option */}
                                            <div>
                                                <RadioGroupItem value="tag" id="segment-tag" className="peer sr-only" />
                                                <Label
                                                    htmlFor="segment-tag"
                                                    className={cn(
                                                        "border-2 rounded-lg p-4 flex flex-col justify-center gap-2 min-h-24 cursor-pointer hover:bg-muted transition-colors",
                                                        field.value === 'tag' ? "border-primary ring-2 ring-primary bg-primary/5" : "border-muted"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className="bg-primary/10 p-3 rounded-full">
                                                            <Sparkles className="w-6 h-6 text-primary"/>
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-lg">Por Etiqueta</span>
                                                            <span className="text-sm text-muted-foreground">
                                                                Selecione contatos com uma etiqueta específica.
                                                            </span>
                                                        </div>
                                                        <div className="ml-auto font-medium text-primary bg-white px-3 py-1 rounded-full border border-primary/20 shadow-sm">
                                                            {field.value === 'tag' && selectedTagId ? (
                                                                `${validContacts.filter(c => c.segment === 'Active' && c.tags?.includes(selectedTagId)).length} contatos`
                                                            ) : (
                                                                'Selecionar'
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    {field.value === 'tag' && (
                                                        <div className="mt-2 w-full" onClick={(e) => e.stopPropagation()}>
                                                             <Select value={selectedTagId} onValueChange={(val) => {
                                                                 setValue('selectedTagId', val);
                                                                 setSelectedTagId(val);
                                                             }}>
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Selecione uma etiqueta..." />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {tags.map(tag => (
                                                                        <SelectItem key={tag.id} value={tag.id}>
                                                                            {tag.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    )}
                                                </Label>
                                            </div>

                                        </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            {contactSegment && (
                                <div className='pt-2'>
                                    <FormDescription>Esta campanha será enviada para <strong>{recipientCount}</strong> pessoas.</FormDescription>
                                </div>
                            )}
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
                        
                        {scheduleProps && (
                            <div className="mt-6 space-y-6">
                                <ScheduleManager 
                                    {...scheduleProps}
                                    onRulesChange={setScheduleRules} 
                                />
                            </div>
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
                                    <p><strong>Velocidade:</strong> {watch('sendSpeed') === 'slow' ? '🐢 Lenta' : watch('sendSpeed') === 'medium' ? '🐇 Normal' : '🚀 Rápida'}</p>
                                </div>
                            </div>

                             {sendSpeed === 'fast' && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Modo de Alto Risco Ativado!</AlertTitle>
                                    <AlertDescription>
                                    O Modo Rápido aumenta significativamente a chance de bloqueio do seu número. Use com extrema cautela e apenas para contatos que esperam sua mensagem.
                                    </AlertDescription>
                                </Alert>
                            )}

                             <FormField control={form.control} name="liabilityAccepted" render={({ field }) => (
                                <FormItem className={cn("flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 transition-colors", submitError && !field.value ? "border-destructive ring-2 ring-destructive/50" : "")}>
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
                                    Agendando...
                                </>
                            ) : (
                                <>
                                    <CalendarClock className="mr-2 h-4 w-4" /> Agendar Campanha
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
    </div>
  );
}
