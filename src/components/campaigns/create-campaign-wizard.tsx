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
import { useUser, useFirestore, useCollection } from '@/firebase';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { collection, addDoc, doc, getDoc, writeBatch } from 'firebase/firestore';
import { useMemoFirebase } from '@/firebase/provider';

import { createSimpleCampaignForUser, createAdvancedCampaignForUser, createSimpleCampaignProviderOnly, createAdvancedCampaignProviderOnly } from '@/app/actions/whatsapp-actions';
import { createTag, getTags, batchAssignTagToContacts } from '@/app/actions/tag-actions';
import { standardizeContactStatuses } from '@/app/actions/migration-actions';
import { uploadToCatbox } from '@/app/actions/upload-actions';

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
    message: "O horário de início não pode ser no passado. Ajuste para um horário futuro.",
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
            startHour: "08:00",
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

    // Calculate Estimations
    const estimation = useMemo(() => {
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
        let avgSecondsPerMsg = 110; // Slow (100-120s)
        if (sendSpeed === 'medium') avgSecondsPerMsg = 90; // Normal (80-100s)
        if (sendSpeed === 'fast') avgSecondsPerMsg = 70; // Fast (60-80s)

        // Parse Start/End Hours
        const parseTime = (time: string) => {
             const [h, m] = (time || "08:00").split(':').map(Number);
             return [h || 0, m || 0];
        };
        const [startH, startM] = parseTime(startHour);
        const [endH, endM] = parseTime(endHour);

        // Calculate Daily Window in Seconds
        // Assuming same day window. If end < start, we treat as invalid or 0 for now (should validate in schema ideally)
        let dailySeconds = (endH * 3600 + endM * 60) - (startH * 3600 + startM * 60);
        if (dailySeconds <= 0) dailySeconds = 8 * 3600; // Fallback to 8 hours if invalid

        // Calculate Messages Per Day
        const msgsPerDay = Math.max(1, Math.floor(dailySeconds / avgSecondsPerMsg));

        const totalDays = Math.ceil(totalContacts / msgsPerDay);
        
        const batches = [];
        // Base date calculation
        let currentBatchDate = startDate ? new Date(startDate + 'T00:00:00') : new Date();
        
        // Adjust currentBatchDate to the correct start time for the first day
        currentBatchDate.setHours(startH, startM, 0, 0);
        
        for (let i = 0; i < totalDays; i++) {
            const batchSize = Math.min(msgsPerDay, totalContacts - (i * msgsPerDay));
            const durationSeconds = batchSize * avgSecondsPerMsg;
            
            // Determine start time for this batch
            let batchStart = new Date(currentBatchDate);
            // Always set to startHour because we increment days
            batchStart.setHours(startH, startM, 0, 0);

            const batchEnd = new Date(batchStart.getTime() + (durationSeconds * 1000));
            
            const endsNextDay = batchEnd.getDate() !== batchStart.getDate();

            batches.push({
                day: i + 1,
                date: batchStart,
                count: batchSize,
                endTime: batchEnd,
                duration: durationSeconds,
                isLate: false, // Window is enforced by math
                endsNextDay
            });
            
            // Move base date to next day for the loop
            currentBatchDate.setDate(currentBatchDate.getDate() + 1);
        }

        return batches;
    }, [contacts, contactSegment, validContacts, sendSpeed, startDate, startHour, endHour]);


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

        // Filter out empty buttons (User Request: "Se o botão ficar vazio não envie")
        if (values.buttons) {
            values.buttons = values.buttons.filter(b => b.text && b.text.trim() !== '');
        }

        // Always add "Bloquear Contato" button if not present
        // WhatsApp Button messages support up to 3 buttons.
        if (!values.buttons) values.buttons = [];
        
        const hasBlockButton = values.buttons.some(b => b.text.toLowerCase().includes('bloquear') || b.id === 'block_contact');
        
        if (!hasBlockButton) {
            // Ensure we don't exceed limit (if limit is 3, we might need to remove one or warn? For now just push)
            // Assuming UI limits to 2 custom + 1 mandatory or similar.
            values.buttons.push({
                id: 'block_contact',
                text: 'Bloquear Contato'
            });
        }

        // Prepare buttons as choices for UAZAPI
        const mapButtonsToChoices = (buttons: any[]) => {
            if (!buttons) return [];
            return buttons
                .filter(b => b.text && b.text.trim() !== '') // Filter out empty buttons
                .map(b => {
                    // If it's a simple reply button, UAZAPI expects "Text|reply:ID"
                    // If the ID already contains ':', assume it's fully formed (e.g. copy: or https:)
                    if (b.id && b.id.includes(':')) {
                         return `${b.text}|${b.id}`;
                    }
                    return `${b.text}|reply:${b.id}`;
                });
        };

        const choices = mapButtonsToChoices(values.buttons);

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
                    // Split Image + Text/Buttons to ensure compatibility (like Video/Audio)
                    messagesToSend.push({
                        image: mediaUrl, // Standard image field
                        caption: "", 
                        type: 'image'
                    });

                    // Image always followed by text with buttons
                    messagesToSend.push({
                        text: values.message || "Confira a imagem acima:",
                        choices: choices,
                        type: 'button'
                    });
                } else if (values.media.type.startsWith('video/')) {
                     // Split into Video + Text/Buttons to ensure compatibility
                     messagesToSend.push({
                        file: mediaUrl, // Changed from video to file as per UAZAPI docs
                        caption: "", 
                        type: 'video'
                    });
                    
                    // Video always followed by text with buttons
                    messagesToSend.push({
                        text: values.message || "Confira o vídeo acima:",
                        choices: choices,
                        type: 'button'
                    });

                } else if (values.media.type.startsWith('audio/')) {
                    messagesToSend.push({
                        file: mediaUrl, // Changed from audio to file as per UAZAPI docs
                        type: 'audio', // Changed from ptt to audio to match docs standard types
                        ptt: true // Add ptt flag if needed, or rely on type 'audio'
                    });
                     
                     // Audio always followed by text with buttons (mandatory block button)
                     messagesToSend.push({
                         text: values.message || "Selecione uma opção:",
                         choices: choices,
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

                     messagesToSend.push({
                        text: values.message || "Segue o documento:",
                        choices: choices,
                        type: 'button'
                    });
                }
            } catch (e: any) {
                console.error("File upload error", e);
                toast({ variant: "destructive", title: "Erro no Upload", description: e.message || "Falha ao processar arquivo de mídia." });
                isSubmittingRef.current = false;
                setIsSubmitting(false);
                return;
            }
        } else if (values.message) {
            // Text only
            // Always has buttons now
            messagesToSend.push({
                text: values.message,
                choices: choices,
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
            console.error("Error in auto-tagging:", err);
            // Don't block campaign creation if tagging fails, just log it.
        }

        // Call Server Action to Send
        // Batching Logic for Daily Limits
        const totalContacts = phones.length;
        
        // Speed Calculation (Average seconds per message)
        let avgSecondsPerMsg = 110; // Slow (100-120s)
        if (sendSpeed === 'medium') avgSecondsPerMsg = 90; // Normal (80-100s)
        if (sendSpeed === 'fast') avgSecondsPerMsg = 70; // Fast (60-80s)

        // Parse Start/End Hours
        const parseTime = (time: string) => {
             const [h, m] = (time || "08:00").split(':').map(Number);
             return [h || 0, m || 0];
        };
        const [startH, startM] = parseTime(values.startHour);
        const [endH, endM] = parseTime(values.endHour);

        // Calculate Daily Window in Seconds
        let dailySeconds = (endH * 3600 + endM * 60) - (startH * 3600 + startM * 60);
        if (dailySeconds <= 0) dailySeconds = 8 * 3600; // Fallback

        // Calculate Messages Per Day
        const msgsPerDay = Math.max(1, Math.floor(dailySeconds / avgSecondsPerMsg));
        
        const batches = [];
        for (let i = 0; i < totalContacts; i += msgsPerDay) {
            batches.push(phones.slice(i, i + msgsPerDay));
        }

        // Base date calculation
        let currentBatchDate = values.startDate ? new Date(values.startDate + 'T00:00:00') : new Date();
        
        // Adjust first day time
        currentBatchDate.setHours(startH, startM, 0, 0);

        // Validation: Ensure start time is not in the past
        if (currentBatchDate.getTime() < Date.now() - 5 * 60 * 1000) { // 5 min tolerance
            toast({ variant: "destructive", title: "Horário Inválido", description: "O horário de início não pode ser no passado. Por favor, ajuste o horário." });
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            return;
        }

        let successCount = 0;
        let lastDocRef: any = null;
        
        const batchIds: string[] = [];
        const batchesMap: Record<string, any> = {};

        for (let i = 0; i < batches.length; i++) {
            const batchPhones = batches[i];
            const batchIndex = i + 1;
            const isMultiBatch = batches.length > 1;
            
             // Set time for current batch
            let batchDate = new Date(currentBatchDate);
            // Always set to startHour because we increment days
            batchDate.setHours(startH, startM, 0, 0);
            
            // Calculate scheduled timestamp (milliseconds)
            const scheduledFor = batchDate.getTime();
            
            const batchName = isMultiBatch ? `${values.name} (Dia ${batchIndex})` : values.name;

            let sendResult;

            // Use Simple Campaign endpoint if we have a single message AND no buttons (User preference/Reliability)
            const hasButtons = values.buttons && values.buttons.length > 0;
            const isSimpleMessage = messagesToSend.length === 1 && !hasButtons && typeof messagesToSend[0] === 'string';

            if (isSimpleMessage) {
                console.log(`[Wizard] Using Simple Campaign for '${batchName}'`);
                sendResult = await createSimpleCampaignProviderOnly(
                    user.uid,
                    batchName,
                    messagesToSend[0],
                    batchPhones,
                    scheduledFor,
                    values.sendSpeed as any
                );
            } else {
                console.log(`[Wizard] Using Advanced Campaign for '${batchName}' (Messages: ${messagesToSend.length})`);
                sendResult = await createAdvancedCampaignProviderOnly(
                    user.uid,
                    batchName,
                    messagesToSend,
                    batchPhones,
                    scheduledFor,
                    values.sendSpeed as any
                );
            }

            if (sendResult.error) {
                 toast({ variant: "destructive", title: `Erro no Lote ${batchIndex}`, description: sendResult.error });
                 continue; // Continue with next batch? Or stop? Let's continue.
            }

            const uazapiId = sendResult.id || sendResult.folderId || sendResult.campaignId || sendResult.folder_id;
            
            if (uazapiId) {
                const idStr = String(uazapiId);
                batchIds.push(idStr);
                batchesMap[idStr] = {
                    id: idStr,
                    name: batchName,
                    scheduledAt: new Date(scheduledFor).toISOString(),
                    status: 'Scheduled',
                    count: batchPhones.length,
                    phones: batchPhones, // Save phones for retry/control
                    stats: { sent: 0, delivered: 0, read: 0, failed: 0 }
                };
                successCount++;
            }

            // Prepare date for next batch
            currentBatchDate.setDate(currentBatchDate.getDate() + 1);
        }
        
        if (successCount > 0) {
            try {
                const campaignCollection = collection(firestore, 'users', user.uid, 'campaigns');
                
                // Determine Start Date (First Batch)
                const firstBatchId = batchIds[0];
                const startDate = batchesMap[firstBatchId]?.scheduledAt || new Date().toISOString();

                const newCampaign: Omit<Campaign, 'id'> = {
                    name: values.name,
                    status: 'Scheduled',
                    sentDate: new Date().toISOString(), // Created At
                    startDate: startDate,
                    recipients: phones.length, // Total recipients
                    engagement: 0,
                    userId: user.uid,
                    batchIds: batchIds,
                    batches: batchesMap,
                    messages: messagesToSend, // Save messages for retry/control
                    phones: phones, // Save all phones for reference
                    stats: { sent: 0, delivered: 0, read: 0, replied: 0, blocked: 0, failed: 0 }
                };

                lastDocRef = await addDoc(campaignCollection, newCampaign);

                // Create 'dispatches' subcollection for detailed tracking
                // This ensures we have a local record of every targeted contact
                try {
                    const campaignId = lastDocRef.id;
                    const batchSize = 500;
                    const chunks = [];
                    
                    // Flatten batches to get all scheduled items with their specific batch info
                    const allDispatches = [];
                    Object.values(batchesMap).forEach((batch: any) => {
                        batch.phones.forEach((phone: string) => {
                            allDispatches.push({
                                phone,
                                batchId: batch.id,
                                status: 'scheduled', // Initial status
                                scheduledAt: batch.scheduledAt,
                                message: messagesToSend.length > 0 ? (typeof messagesToSend[0] === 'string' ? messagesToSend[0] : 'Media/Template') : '',
                                updatedAt: new Date().toISOString()
                            });
                        });
                    });

                    for (let i = 0; i < allDispatches.length; i += batchSize) {
                        chunks.push(allDispatches.slice(i, i + batchSize));
                    }

                    console.log(`[Wizard] Creating ${allDispatches.length} dispatch records in ${chunks.length} batches...`);

                    for (const chunk of chunks) {
                        const batch = writeBatch(firestore);
                        chunk.forEach((dispatch) => {
                            // Use phone as ID for easy lookup, or auto-id if duplicates allowed (but phone as ID prevents dupes per campaign)
                            const dispatchRef = doc(collection(firestore, 'users', user.uid, 'campaigns', campaignId, 'dispatches')); 
                            batch.set(dispatchRef, dispatch);
                        });
                        await batch.commit();
                    }
                    console.log(`[Wizard] All dispatch records created.`);

                } catch (err) {
                    console.error("Error creating dispatch records:", err);
                    // Don't fail the whole process, but warn
                    toast({ variant: "default", title: "Aviso", description: "Campanha criada, mas houve erro ao detalhar lista de envio." });
                }

            } catch (e) {
                console.error("Error creating campaign doc", e);
                toast({ variant: "destructive", title: `Erro ao salvar campanha`, description: "A campanha foi enviada mas houve erro ao salvar no histórico." });
            }

            // Legacy 'New' to 'Active' update block removed as per request to remove legacy statuses.
            // Only 'Active' contacts are targeted now.

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
                        
                        {estimation && estimation.length > 0 && (
                            <Card className="mt-6 border-blue-100 bg-blue-50/50">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <CalendarClock className="h-5 w-5 text-blue-600" />
                                        Cronograma Estimado de Envio
                                    </CardTitle>
                                    <CardDescription>
                                        Previsão baseada na velocidade média e janela de envio diária.
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
    </div>
  );
}
