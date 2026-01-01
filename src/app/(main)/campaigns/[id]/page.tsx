'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useFirestore, useCollection } from '@/firebase';
import { doc, onSnapshot, collection, query, orderBy, updateDoc, limit, getDocs, startAfter, where } from 'firebase/firestore';
import { Campaign } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MessageSquare, ShieldAlert, CheckCircle2, Users, Play, Pause, Trash2, RefreshCw, Square, Loader2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getCampaignMessagesFromProvider, getCampaignsFromProvider, controlCampaign } from '@/app/actions/whatsapp-actions';
import { deleteCampaignAction, getCampaignInteractionsAction, getCampaignDispatchesAction, ensureCampaignOwnership, generateCampaignBatchesAction } from '@/app/actions/campaign-actions';
import { fixCampaignTimezoneAction } from '@/app/actions/campaign-fix-actions';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function CampaignReportPage() {
    const { id } = useParams();
    const { user } = useUser();
    const firestore = useFirestore();
    const router = useRouter();
    const { toast } = useToast();
    
    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [loading, setLoading] = useState(true);
    const [messages, setMessages] = useState<any[]>([]);
    const [providerStats, setProviderStats] = useState<any>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [isControlling, setIsControlling] = useState(false);
    const [interactions, setInteractions] = useState<any[]>([]);
    
    // Pagination for Messages
    const [page, setPage] = useState(1);
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);

    // Dispatches State (Detailed Tracking)
    const [dispatches, setDispatches] = useState<any[]>([]);
    const [loadingDispatches, setLoadingDispatches] = useState(false);
    const [hasMoreDispatches, setHasMoreDispatches] = useState(true);
    const [lastDispatchScheduledAt, setLastDispatchScheduledAt] = useState<string | null>(null);
    const [generatingBatches, setGeneratingBatches] = useState(false);
    
    // Batch Filtering State
    const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("batches");

    const uid = user?.uid;

    const handleGenerateBatches = async () => {
        if (!uid || !id) return;
        setGeneratingBatches(true);
        const res = await generateCampaignBatchesAction(uid, id as string);
        setGeneratingBatches(false);
        if (res.success) {
            toast({ title: "Lotes gerados", description: `${res.count} lotes identificados.` });
        } else {
             toast({ variant: "destructive", title: "Erro", description: res.error });
        }
    };


    // Reset dispatches when filter changes
    useEffect(() => {
        setDispatches([]);
        setLastDispatchScheduledAt(null);
        setHasMoreDispatches(true);
        setLoadingDispatches(true);
    }, [selectedBatchId]);

    // Realtime Dispatches Listener (Optimized for Cost)
    // Replaces polling/re-fetching. Costs 1 read per change instead of 50 reads per change.
    useEffect(() => {
        if (!uid || !id || !firestore) return;

        // Determine collection name based on campaign type or fallback
        // We can't easily know 'managed' vs 'legacy' before campaign loads, 
        // but we can try 'queue' first as it's the new standard.
        const collectionName = campaign?.type === 'managed' ? 'queue' : 'dispatches';
        
        // Only set up listener if we are on the first page to save resources
        // If user scrolls down, we fallback to manual pagination (loadDispatches)
        // If filtering by batch, we always listen to the filtered set
        if (dispatches.length > 50 && !loadingDispatches && !selectedBatchId) return;

        let q = query(
            collection(firestore, 'users', uid, 'campaigns', id as string, collectionName),
            orderBy('scheduledAt', 'asc')
        );

        if (selectedBatchId) {
             // Derive range from selectedBatchId (YYYY-MM-DD) to avoid dependency on changing campaign.batches
             // We assume batch ID corresponds to the date.
             // Even if the batch starts at 10:00, searching from 00:00 is safe as there are no items before.
             const start = `${selectedBatchId}T00:00:00.000`;
             const end = `${selectedBatchId}T23:59:59.999`;
             
             // Note: Strings comparison works for ISO dates.
             q = query(q, where('scheduledAt', '>=', start), where('scheduledAt', '<=', end));
        }

        q = query(q, limit(50));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Merge with existing dispatches if we have more than 50 (pagination)
            // But for the "Head" (first 50), we keep them realtime.
            setDispatches(prev => {
                if (selectedBatchId) return items; // If filtering, replace entirely to show accurate filtered view
                
                if (prev.length <= 50) return items;
                // If we have more, replace the first 50 and keep the rest
                // This might be tricky if sort order changes, but for 'scheduledAt' it's stable-ish.
                // Simpler: Just update the view for the first 50.
                const newItems = [...items];
                // Append the rest of the previous items that are NOT in the new set
                const existingIds = new Set(newItems.map(i => i.id));
                prev.forEach(p => {
                    if (!existingIds.has(p.id)) {
                        newItems.push(p);
                    }
                });
                return newItems.sort((a: any, b: any) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
            });
            
            if (snapshot.docs.length > 0) {
                 const lastDoc = snapshot.docs[snapshot.docs.length - 1];
                 const data = lastDoc.data();
                 // Store the scheduledAt string for pagination
                 setLastDispatchScheduledAt(data.scheduledAt);
            }
            
            setLoadingDispatches(false);
        }, (error) => {
            console.error("Error in dispatches listener:", error);
        });

        return () => unsubscribe();
    }, [uid, id, firestore, campaign?.type, selectedBatchId]);

    // Load Dispatches (Detailed List) - Manual Pagination
    const loadDispatches = useCallback(async (isInitial = false, silent = false) => {
        if (!id || !user) return;
        if (loadingDispatches && !isInitial) return;
        
        if (!silent) setLoadingDispatches(true);
        
        try {
            // If initial, we don't need to load because realtime listener does it
            // BUT if we are paginating, we use the last doc from state
            
            // Ensure we have a string for pagination
            const startAfterVal = !isInitial && lastDispatchScheduledAt ? lastDispatchScheduledAt : undefined;
            
            // Construct Filter
            let filter = undefined;
            if (selectedBatchId) {
                filter = {
                    start: `${selectedBatchId}T00:00:00`,
                    end: `${selectedBatchId}T23:59:59`
                };
            }

            const result = await getCampaignDispatchesAction(user.uid, id as string, 50, startAfterVal, filter);
            
            if (result.success && result.data) {
                const newItems = result.data;
                
                if (newItems.length < 50) {
                    setHasMoreDispatches(false);
                }
                
                if (newItems.length > 0) {
                    // Update pagination cursor
                    const lastItem = newItems[newItems.length - 1];
                    setLastDispatchScheduledAt(lastItem.scheduledAt);
                    
                    setDispatches(prev => {
                        const newMap = new Map(prev.map(i => [i.id, i]));
                        newItems.forEach((item: any) => newMap.set(item.id, item));
                         return Array.from(newMap.values()).sort((a: any, b: any) => 
                            (a.scheduledAt || '').localeCompare(b.scheduledAt || '')
                        );
                    });
                } else {
                     setHasMoreDispatches(false);
                }
            }
        } catch (error) {
            console.error("Error loading dispatches:", error);
            toast({
                title: "Erro ao carregar lista",
                description: "Não foi possível carregar mais itens.",
                variant: "destructive"
            });
        } finally {
            setLoadingDispatches(false);
        }
    }, [id, user, lastDispatchScheduledAt, loadingDispatches, selectedBatchId]);
    useEffect(() => {
        if (!uid || !id) return;
        
        async function loadInteractions() {
             const result = await getCampaignInteractionsAction(uid!, id as string);
             if (result.success && result.data) {
                 setInteractions(result.data);
             }
        }
        
        // Load initially
        loadInteractions();
        
        // Reload when stats change (e.g. new reply received via webhook)
        if (campaign?.stats?.replied || campaign?.stats?.blocked) {
             loadInteractions();
        }

    }, [uid, id, campaign?.stats?.replied, campaign?.stats?.blocked]);

    // Ensure campaign integrity (fix missing userId if needed)
    useEffect(() => {
        if (uid && id) {
            ensureCampaignOwnership(uid, id as string).then(res => {
                if (res.fixed) {
                    console.log("Fixed campaign ownership.");
                }
            });
        }
    }, [uid, id]);

    // Use empty array fallback for derived states
    // Filter by selected batch date if active
    const filteredInteractions = useMemo(() => {
        if (!interactions) return [];
        if (!selectedBatchId) return interactions;
        
        return interactions.filter((i: any) => {
             const ts = i.timestamp;
             if (!ts) return false;
             let d: Date;
             // Handle various timestamp formats (string or Firestore Timestamp)
             if (typeof ts === 'string') d = new Date(ts);
             else if (typeof ts === 'object' && ts.toDate) d = ts.toDate();
             else d = new Date(ts); 
             
             // selectedBatchId is YYYY-MM-DD
             const dateKey = d.toISOString().split('T')[0];
             return dateKey === selectedBatchId;
        });
    }, [interactions, selectedBatchId]);

    const replies = filteredInteractions.filter((i: any) => i.type === 'reply');
    const blocks = filteredInteractions.filter((i: any) => i.type === 'block');

    // Calculate stats from messages list if provider stats are zero or missing but messages exist
    // This fixes the issue where provider stats lag behind the message list
    const hasLocalMessages = messages && messages.length > 0;
    const localStats = useMemo(() => {
        if (!hasLocalMessages) return { sent: 0, delivered: 0, read: 0, failed: 0 };
        return messages.reduce((acc, msg) => {
            const s = (msg.status || '').toLowerCase();
            if (s === 'sent') acc.sent++;
            if (s === 'delivered') acc.delivered++;
            if (s === 'read') acc.read++;
            if (s === 'failed') acc.failed++;
            return acc;
        }, { sent: 0, delivered: 0, read: 0, failed: 0 });
    }, [messages, hasLocalMessages]);

    // Fetch initial data from Firestore
    useEffect(() => {
        if (!uid || !id) return;
        
        const docRef = doc(firestore, 'users', uid, 'campaigns', id as string);
        const unsubscribe = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                setCampaign({ id: snap.id, ...snap.data() } as Campaign);
            } else {
                setCampaign(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [uid, id, firestore]);

    // Function to sync with Provider
    const refreshData = useCallback(async () => {
        if (!uid || !id) return;
        setRefreshing(true);

        try {
            // 1. Fetch Campaign Stats from Provider
            const campaignsResult = await getCampaignsFromProvider(uid);
            if (!campaignsResult.error && Array.isArray(campaignsResult)) {
                const remoteCampaign = campaignsResult.find((c: any) => c.id === id);
                if (remoteCampaign) {
                    setProviderStats(remoteCampaign);
                }
            }

            // 2. Fetch Messages
            // We fetch the first page or 'all' if we implement pagination logic. For now, first 50.
            const messagesResult = await getCampaignMessagesFromProvider(uid, id as string, undefined, 1, 50);
            if (!messagesResult.error && messagesResult.messages && messagesResult.messages.length > 0) {
                setMessages(messagesResult.messages);
                setPage(1);
                setHasMoreMessages(messagesResult.messages.length === 50);

                // Sync stats to Firestore to ensure list view is updated
                const msgs = messagesResult.messages;
                const newStats = msgs.reduce((acc: any, msg: any) => {
                    const s = (msg.status || '').toLowerCase();
                    if (s === 'sent') acc.sent++;
                    if (s === 'delivered') acc.delivered++;
                    if (s === 'read') acc.read++;
                    if (s === 'failed') acc.failed++;
                    return acc;
                }, { sent: 0, delivered: 0, read: 0, failed: 0 });

                // ONLY update if we actually got messages back.
                // If the provider returns empty (which it does for managed campaigns now), we DO NOT want to overwrite our DB stats.
                 try {
                    const campaignRef = doc(firestore, 'users', uid, 'campaigns', id as string);
                    // Check if current stats are better/different before overwriting?
                    // For now, let's just Log it. Overwriting with partial data is dangerous.
                    // If we are using Managed Campaigns, Firestore is the Source of Truth, not the Provider's list (which might be empty).
                    // So we skip this update for Managed Campaigns.
                    // await updateDoc(campaignRef, {
                    //    stats: newStats,
                    // });
                    console.log('Provider stats (ignored):', newStats);
                } catch (e) {
                    console.error("Failed to sync stats to Firestore:", e);
                }
            } else {
                // If no messages returned, do NOT clear existing stats.
                console.log("No messages returned from provider sync. Keeping local stats.");
            }
        } catch (error) {
            console.error('Failed to refresh data:', error);
            toast({ variant: 'destructive', title: 'Erro ao atualizar dados', description: 'Não foi possível sincronizar com o provedor.' });
        } finally {
            setRefreshing(false);
        }
    }, [uid, id, toast, firestore]);



    // Initial load from provider
    useEffect(() => {
        if (uid && id) {
            refreshData();
        }
    }, [uid, id, refreshData]);

    const batchesList = useMemo(() => {
        if (!campaign || !campaign.batches) return [];
        return Object.values(campaign.batches).sort((a: any, b: any) => 
            new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        );
    }, [campaign]);

    const handleControl = async (action: 'stop' | 'continue' | 'delete') => {
        if (!uid || !id) return;
        
        if (action === 'delete') {
             if (!confirm('Tem certeza que deseja excluir esta campanha? Esta ação é irreversível.')) return;
             
             setIsControlling(true);
             const result = await deleteCampaignAction(uid, id as string);
             setIsControlling(false);

             if (result.success) {
                toast({ title: "Campanha excluída", description: "Você será redirecionado." });
                router.push('/campaigns');
             } else {
                toast({ variant: "destructive", title: "Erro ao excluir", description: result.error });
             }
             return;
        }

        setIsControlling(true);
        // Use campaign.uazapiId if available, otherwise fall back to id (which likely fails on provider but allows local delete)
        const uazapiId = campaign?.uazapiId || (campaign as any)?.folderId || undefined;
        const result = await controlCampaign(uid, id as string, action, uazapiId);
        setIsControlling(false);

        if (result.success) {
            toast({ 
                title: action === 'stop' ? "Campanha parada" : "Campanha iniciada",
                description: action === 'stop' ? "O envio foi interrompido." : "O envio foi iniciado com sucesso."
            });
            refreshData();
        } else {
            toast({ variant: "destructive", title: "Erro na ação", description: result.error });
        }
    };

    const handleFixTimezone = async () => {
        if (!uid || !id) return;
        setIsControlling(true);
        
        // 1. Fix Timezone
        const resultTimezone = await fixCampaignTimezoneAction(uid, id as string);
        
        // 2. Regenerate Batches (Fix "Lote 1, Lote 2" order)
        const resultBatches = await generateCampaignBatchesAction(uid, id as string);

        setIsControlling(false);
        
        if (resultTimezone.success && resultBatches.success) {
            toast({ 
                title: "Correção Concluída", 
                description: `Fuso horário ajustado (${resultTimezone.count || 0} itens) e Lotes reorganizados.` 
            });
            refreshData();
        } else {
            toast({ 
                variant: "destructive", 
                title: "Erro na Correção", 
                description: resultTimezone.error || resultBatches.error 
            });
        }
    };

    if (loading) {
        return (
            <div className="container mx-auto py-8 flex items-center justify-center">
                <div className="text-muted-foreground">Carregando relatório...</div>
            </div>
        );
    }
    
    if (!campaign) {
        return (
            <div className="container mx-auto py-8">
                <Card>
                    <CardContent className="py-8 text-center">
                        <p className="text-muted-foreground">Campanha não encontrada.</p>
                        <Button variant="link" onClick={() => router.push('/campaigns')}>
                            Voltar para Campanhas
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Merge stats: Provider stats take precedence if available
    const stats = providerStats || (campaign?.stats) || {};

    // Provider specific fields
    // Use provider stats if they have non-zero values, otherwise fallback to local calculation
    // This prefers the aggregated stats from server but falls back to client-side count if server returns 0s
    const useLocalStats = (providerStats?.log_delivered || 0) === 0 && localStats.delivered > 0;

    // RAW COUNTS (Strict Status)
    const countSent = useLocalStats ? localStats.sent : (providerStats ? (providerStats.log_total || 0) : (campaign.stats?.sent || (campaign as any).count || 0));
    const countDelivered = useLocalStats ? localStats.delivered : (providerStats ? (providerStats.log_delivered || 0) : (campaign.stats?.delivered || 0));
    const countRead = useLocalStats ? localStats.read : (providerStats ? (providerStats.log_read || 0) : (campaign.stats?.read || 0));
    const countFailed = useLocalStats ? localStats.failed : (providerStats ? (providerStats.log_failed || 0) : (campaign.stats?.failed || 0));
    
    // User Perception Adjustment: "If it's sent, it's delivered unless failed"
    // We treat 'Sent' status as implied delivery for the UI metrics
    const sent = countSent; // This is actually "Sent/Processed" count
    const delivered = countDelivered + countRead + countSent; // Include 'sent' in delivered count for UI
    const read = countRead;
    const failed = countFailed;

    const replied = campaign.stats?.replied || replies.length || 0;
    const blocked = campaign.stats?.blocked || blocks.length || 0;
    
    const recipients = campaign.stats?.total || (Array.isArray(campaign.recipients) ? campaign.recipients.length : campaign.recipients) || 1;
    
    // Calculate actual completed count (delivered + read + failed + sent)
    // Here 'sent' means items in 'sent' status, 'delivered' means items in 'delivered' status etc.
    // So we use the RAW counts for progress to avoid double counting
    const completedCount = countDelivered + countRead + countFailed + countSent;
    const progress = Math.min(100, Math.round((completedCount / recipients) * 100));

    // ROI Metrics
    // Denominator should be total successfully processed
    const totalSuccessful = countSent + countDelivered + countRead;
    
    const replyRate = totalSuccessful > 0 ? (replied / totalSuccessful) * 100 : 0;
    const blockRate = totalSuccessful > 0 ? (blocked / totalSuccessful) * 100 : 0;
    // Delivery Rate: (Confirmed Delivered + Read + Sent) / (Total Processed)
    // If we assume Sent is Delivered, then Delivery Rate is roughly (Total Processed - Failed) / Total Processed
    const deliveryRate = completedCount > 0 ? ((completedCount - countFailed) / completedCount) * 100 : 0;

    let verdict = { label: "Aguardando dados...", color: "text-gray-500", description: "Ainda não há dados suficientes para análise." };
    if (completedCount > 0) {
        if (blockRate > 3) {
            verdict = { label: "Crítico", color: "text-red-600", description: "Taxa de bloqueio muito alta! Revise sua lista e conteúdo." };
        } else if (replyRate > 15) {
            verdict = { label: "Excelente!", color: "text-green-600", description: "Alto engajamento. O público adorou a campanha." };
        } else if (replyRate > 5) {
            verdict = { label: "Muito Bom", color: "text-blue-600", description: "Resultados sólidos e dentro da média esperada." };
        } else if (replyRate > 1) {
            verdict = { label: "Regular", color: "text-yellow-600", description: "Engajamento baixo. Tente melhorar o Call to Action." };
        } else {
            verdict = { label: "Baixo Desempenho", color: "text-orange-600", description: "Poucas respostas até agora." };
        }
    }

    const statusRaw = campaign.status || 'Draft';
    // Normalize status for display logic
    const status = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1).toLowerCase();
    const isCompleted = status === 'Completed' || status === 'Done';

    const displayStatus = isCompleted ? 'Concluído' : 
                          status === 'Paused' ? 'Pausado' : 
                          status === 'Stopped' ? 'Parada' :
                          status === 'Scheduled' ? 'Agendado' :
                          status === 'Sending' ? 'Enviando' : status;

    // Check if campaign is scheduled for the future
    const scheduledDate = campaign.scheduledAt ? new Date(campaign.scheduledAt) : new Date();
    // Allow a small buffer (e.g., 30s) to avoid flickering
    const isFuture = scheduledDate.getTime() > Date.now() + 30000;

    // A campaign can be started if it's Stopped, Paused, or Scheduled (force start).
    const canStart = status === 'Scheduled' || status === 'Paused' || status === 'Stopped' || status === 'Draft';

    // A campaign can be stopped only if it's currently sending.
    const canStop = status === 'Sending';



    const translateStatus = (status: string) => {
        const s = status?.toLowerCase() || '';
        if (s === 'read') return 'Engajado';
        if (s === 'delivered') return 'Entregue';
        if (s === 'sent') return 'Enviado';
        if (s === 'failed') return 'Falhou';
        if (s === 'scheduled') return 'Agendado';
        if (s === 'sending') return 'Enviando';
        if (s === 'pending') return 'Pendente';
        if (s === 'completed') return 'Concluído';
        if (s === 'paused') return 'Pausado';
        if (s === 'queued') return 'Na Fila';
        return status;
    };

    return (
        <div className="container mx-auto py-8 px-4 md:px-6 space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => router.back()}>
                        <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">{campaign.name}</h1>
                        <div className="flex items-center gap-2 text-muted-foreground mt-1">
                            <span>Criada em {new Date(campaign.sentDate).toLocaleDateString()}</span>
                            <Badge variant={status === 'Completed' ? 'default' : status === 'Paused' ? 'destructive' : 'secondary'}>
                                {displayStatus}
                            </Badge>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={refreshData} disabled={refreshing}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        Atualizar
                    </Button>
                    {canStart && (
                        <Button variant="outline" size="sm" onClick={() => handleControl('continue')} disabled={isControlling} className="text-green-600 hover:text-green-700 hover:bg-green-50">
                            <Play className="w-4 h-4 mr-2" /> Iniciar Agora
                        </Button>
                    )}
                    {canStop && (
                        <Button variant="outline" size="sm" onClick={() => handleControl('stop')} disabled={isControlling} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                            <Square className="w-4 h-4 mr-2 fill-current" /> Parar Envio
                        </Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => handleControl('delete')} disabled={isControlling}>
                        <Trash2 className="w-4 h-4 mr-2" /> Excluir
                    </Button>
                </div>
            </div>

            {/* Progress Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Progresso do Envio</CardTitle>
                    <CardDescription>Dados sincronizados com o provedor.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span>{completedCount} finalizados de {recipients} total</span>
                            <span className="font-bold">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-4" />
                        <p className="text-xs text-muted-foreground pt-2">
                            Status: {displayStatus}
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Verdict Section */}
            <Card className="border-l-4">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <span className={verdict.color}>{verdict.label}</span>
                        <span className="text-sm font-normal text-muted-foreground ml-auto">Análise de Performance</span>
                    </CardTitle>
                    <CardDescription>{verdict.description}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                        <div className="flex flex-col items-center p-2 rounded-lg bg-secondary/10">
                            <div className="text-2xl font-bold">{replyRate.toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground font-medium">Taxa de Resposta</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Metas: &gt;5% (Bom)</div>
                        </div>
                        <div className="flex flex-col items-center p-2 rounded-lg bg-secondary/10">
                            <div className="text-2xl font-bold">{deliveryRate.toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground font-medium">Taxa de Entrega</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Metas: &gt;90% (Ideal)</div>
                        </div>
                        <div className="flex flex-col items-center p-2 rounded-lg bg-secondary/10">
                            <div className={`text-2xl font-bold ${blockRate > 3 ? 'text-red-500' : ''}`}>{blockRate.toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground font-medium">Taxa de Bloqueio</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Metas: &lt;1% (Seguro)</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Interação</CardTitle>
                        <MessageSquare className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{replied}</div>
                        <p className="text-xs text-muted-foreground">Mensagens respondidas</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Bloqueados</CardTitle>
                        <ShieldAlert className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{blocked}</div>
                        <p className="text-xs text-muted-foreground">Solicitações de bloqueio</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Entregues</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{delivered}</div>
                        <p className="text-xs text-muted-foreground">Entregues no dispositivo</p>
                    </CardContent>
                </Card>
            </div>

            {/* Interactions Tabs */}
            {selectedBatchId && campaign?.batches?.[selectedBatchId] && (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-md flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Clock className="w-4 h-4" />
                        <span className="font-semibold">Filtro Ativo: {campaign.batches[selectedBatchId].name}</span>
                        <span className="text-sm opacity-80">
                            ({new Date(campaign.batches[selectedBatchId].scheduledAt).toLocaleDateString('pt-BR')})
                        </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedBatchId(null)} className="text-blue-800 hover:bg-blue-100 h-8 self-end sm:self-auto">
                        Limpar Filtro
                    </Button>
                </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-4 w-full flex-wrap h-auto">
                    {batchesList.length > 0 && <TabsTrigger value="batches">Lotes (Dias)</TabsTrigger>}
                    <TabsTrigger value="dispatches">
                        Lista de Envio {selectedBatchId ? '(Filtrado)' : '(Detalhada)'}
                    </TabsTrigger>
                    <TabsTrigger value="replies">
                        Respostas
                        {replies.length > 0 && <Badge variant="secondary" className="ml-2">{replies.length}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="blocks">
                        Bloqueios
                        {blocks.length > 0 && <Badge variant="destructive" className="ml-2">{blocks.length}</Badge>}
                    </TabsTrigger>
                </TabsList>

                {batchesList.length === 0 && (campaign as any).type === 'managed' && (
                     <div className="mb-4 p-4 border rounded-md bg-yellow-50 text-yellow-800 flex items-center justify-between">
                        <span className="text-sm">Os lotes de envio não foram gerados para esta campanha.</span>
                        <Button size="sm" variant="outline" onClick={handleGenerateBatches} disabled={generatingBatches}>
                            {generatingBatches ? <Loader2 className="w-3 h-3 animate-spin mr-2"/> : <RefreshCw className="w-3 h-3 mr-2"/>}
                            Gerar Lotes
                        </Button>
                     </div>
                )}

                {batchesList.length > 0 && (
                    <TabsContent value="batches">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle>Lotes de Envio</CardTitle>
                                    <CardDescription>Progresso individual por dia/lote</CardDescription>
                                </div>
                                <Button size="sm" variant="outline" onClick={handleGenerateBatches} disabled={generatingBatches}>
                                    <RefreshCw className={`h-4 w-4 mr-2 ${generatingBatches ? 'animate-spin' : ''}`} />
                                    Atualizar
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {/* Desktop View */}
                                <div className="hidden md:block overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Nome</TableHead>
                                                <TableHead>Agendado Para</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Progresso</TableHead>
                                                <TableHead>Métricas</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {batchesList.map((batch: any) => {
                                                const isBatchDone = (batch.count > 0 && ((batch.stats?.sent || 0) + (batch.stats?.failed || 0)) >= batch.count) || isCompleted;
                                                
                                                // Fallback progress: if campaign is completed, force 100% even if stats are missing
                                                const progress = isBatchDone ? 100 : (batch.count > 0 ? Math.min(100, Math.round(((batch.stats?.sent || 0) / batch.count) * 100)) : 0);
                                                
                                                const isSelected = selectedBatchId === batch.id;

                                                return (
                                                <TableRow 
                                                    key={batch.id}
                                                    className={`cursor-pointer transition-colors ${isSelected ? "bg-blue-50 hover:bg-blue-100 border-l-4 border-blue-500" : "hover:bg-muted/50"}`}
                                                    onClick={() => {
                                                        if (isSelected) {
                                                            setSelectedBatchId(null);
                                                        } else {
                                                            setSelectedBatchId(batch.id);
                                                            setActiveTab("dispatches");
                                                            toast({ title: `Filtrando por ${batch.name}`, description: "Exibindo envios e interações deste lote." });
                                                        }
                                                    }}
                                                >
                                                    <TableCell className="font-medium whitespace-nowrap">
                                                        {batch.name}
                                                        {isSelected && <Badge variant="secondary" className="ml-2 text-[10px]">Ativo</Badge>}
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">
                                                                {new Date(batch.scheduledAt).toLocaleDateString('pt-BR')}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {new Date(batch.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                                {batch.endTime && ` - ${new Date(batch.endTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant={isBatchDone ? "default" : "outline"} className={isBatchDone ? "bg-green-500 hover:bg-green-600" : ""}>
                                                            {isBatchDone ? 'Concluído' : 
                                                                (batch.stats?.sent > 0) ? 'Enviando' :
                                                                (new Date(batch.scheduledAt) > new Date()) ? 'Agendado' :
                                                                translateStatus(batch.status)
                                                            }
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="min-w-[120px]">
                                                        <div className="flex items-center gap-2">
                                                            <Progress value={progress} className="h-2 w-[60px]" />
                                                            <span className="text-xs text-muted-foreground">
                                                                {progress}%
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">
                                                        <div className="flex flex-col text-xs">
                                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Total: {batch.count}</span>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                 <span className="text-green-600 font-medium" title="Enviados">
                                                                     {batch.stats?.sent || (isBatchDone ? Math.max(0, batch.count - (batch.stats?.failed || 0)) : 0)} env
                                                                 </span>
                                                                 <span className="text-gray-300">|</span>
                                                                 <span className="text-red-500 font-medium" title="Falhas">
                                                                     {batch.stats?.failed || 0} falha
                                                                 </span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                                )})}
                                        </TableBody>
                                    </Table>
                                </div>

                                {/* Mobile View (Cards) */}
                                <div className="md:hidden space-y-4">
                                    {batchesList.map((batch: any) => {
                                        const isBatchDone = (batch.count > 0 && ((batch.stats?.sent || 0) + (batch.stats?.failed || 0)) >= batch.count) || isCompleted;
                                        const progress = isBatchDone ? 100 : (batch.count > 0 ? Math.min(100, Math.round(((batch.stats?.sent || 0) / batch.count) * 100)) : 0);
                                        const isSelected = selectedBatchId === batch.id;
                                        
                                        return (
                                            <div 
                                                key={batch.id} 
                                                className={`p-4 border rounded-lg space-y-3 cursor-pointer transition-colors ${isSelected ? "bg-blue-50 border-blue-500" : "bg-card hover:bg-muted/50"}`}
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setSelectedBatchId(null);
                                                    } else {
                                                        setSelectedBatchId(batch.id);
                                                        setActiveTab("dispatches");
                                                        toast({ title: `Filtrando por ${batch.name}`, description: "Exibindo envios e interações deste lote." });
                                                    }
                                                }}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="font-medium flex items-center gap-2">
                                                        {batch.name}
                                                        {isSelected && <Badge variant="secondary" className="text-[10px]">Ativo</Badge>}
                                                    </div>
                                                    <Badge variant={isBatchDone ? "default" : "outline"} className={isBatchDone ? "bg-green-500" : ""}>
                                                        {isBatchDone ? 'Concluído' : (batch.stats?.sent > 0) ? 'Enviando' : (new Date(batch.scheduledAt) > new Date()) ? 'Agendado' : translateStatus(batch.status)}
                                                    </Badge>
                                                </div>
                                                
                                                <div className="text-sm text-muted-foreground">
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="w-3 h-3" />
                                                        {new Date(batch.scheduledAt).toLocaleDateString('pt-BR')} às {new Date(batch.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>

                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-xs text-muted-foreground">
                                                        <span>Progresso</span>
                                                        <span>{progress}%</span>
                                                    </div>
                                                    <Progress value={progress} className="h-2" />
                                                </div>

                                                <div className="flex items-center justify-between text-xs pt-2 border-t">
                                                    <span className="font-semibold">Total: {batch.count}</span>
                                                    <div className="flex items-center gap-2">
                                                         <span className="text-green-600 font-medium">
                                                             {batch.stats?.sent || (isBatchDone ? Math.max(0, batch.count - (batch.stats?.failed || 0)) : 0)} env
                                                         </span>
                                                         <span className="text-gray-300">|</span>
                                                         <span className="text-red-500 font-medium">
                                                             {batch.stats?.failed || 0} falha
                                                         </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
                
                <TabsContent value="dispatches">
                    <Card>
                        <CardHeader>
                            <CardTitle>Lista de Envio Detalhada</CardTitle>
                            <CardDescription>Status de todos os contatos da campanha (Agendados e Enviados)</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Desktop View */}
                            <div className="hidden md:block overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="whitespace-nowrap">Nome</TableHead>
                                            <TableHead className="whitespace-nowrap">Telefone</TableHead>
                                            <TableHead className="whitespace-nowrap">Agendado Para</TableHead>
                                            <TableHead className="whitespace-nowrap">Enviado Em</TableHead>
                                            <TableHead className="whitespace-nowrap">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {dispatches.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                                    {loadingDispatches ? 'Carregando lista de envio...' : 'Nenhum registro encontrado (Campanha antiga ou vazia).'}
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            dispatches.map((dispatch: any) => (
                                                <TableRow key={dispatch.id}>
                                                    <TableCell className="font-medium whitespace-nowrap">{dispatch.name || 'Sem nome'}</TableCell>
                                                    <TableCell className="whitespace-nowrap">{dispatch.phone}</TableCell>
                                                    <TableCell className="whitespace-nowrap">
                                                        {dispatch.scheduledAt ? new Date(dispatch.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : (campaign?.scheduledAt ? new Date(campaign.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')}
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">
                                                        {dispatch.sentAt ? new Date(dispatch.sentAt).toLocaleString('pt-BR') : '-'}
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">
                                                    <Badge 
                                                        title={dispatch.status === 'failed' ? (dispatch.error || 'Erro desconhecido') : undefined}
                                                        className={
                                                        dispatch.status === 'sent' || dispatch.status === 'delivered' || dispatch.status === 'read' ? 'bg-green-500 hover:bg-green-600' : 
                                                        dispatch.status === 'failed' ? 'bg-red-500 hover:bg-red-600 cursor-help' : 
                                                        'bg-slate-500 hover:bg-slate-600' // pending/scheduled
                                                    }>
                                                        {translateStatus(dispatch.status)}
                                                    </Badge>
                                                    {dispatch.status === 'failed' && dispatch.error && (
                                                        <div className="text-[10px] text-red-500 mt-1 max-w-[150px] truncate" title={dispatch.error}>
                                                            Número sem WhatsApp
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                            </div>

                            {/* Mobile View (Cards) */}
                            <div className="md:hidden space-y-4">
                                {dispatches.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/20">
                                        {loadingDispatches ? 'Carregando...' : 'Nenhum registro encontrado.'}
                                    </div>
                                ) : (
                                    dispatches.map((dispatch: any) => (
                                        <div key={dispatch.id} className="p-4 border rounded-lg space-y-2 bg-card">
                                            <div className="flex items-center justify-between">
                                                <span className="font-medium">{dispatch.name || 'Sem nome'}</span>
                                                <Badge 
                                                    className={
                                                        dispatch.status === 'sent' || dispatch.status === 'delivered' || dispatch.status === 'read' ? 'bg-green-500' : 
                                                        dispatch.status === 'failed' ? 'bg-red-500' : 
                                                        'bg-slate-500'
                                                    }
                                                >
                                                    {translateStatus(dispatch.status)}
                                                </Badge>
                                            </div>
                                            
                                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                                <Users className="w-3 h-3" />
                                                {dispatch.phone}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t">
                                                <div>
                                                    <span className="text-muted-foreground block">Agendado</span>
                                                    <span>
                                                        {dispatch.scheduledAt ? new Date(dispatch.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground block">Enviado</span>
                                                    <span>
                                                        {dispatch.sentAt ? new Date(dispatch.sentAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                                                    </span>
                                                </div>
                                            </div>

                                            {dispatch.status === 'failed' && dispatch.error && (
                                                <div className="text-xs text-red-500 bg-red-50 p-2 rounded mt-2">
                                                    Erro: {dispatch.error}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>

                            {hasMoreDispatches && (
                                <div className="mt-4 flex justify-center">
                                    <Button variant="outline" onClick={() => loadDispatches(false)} disabled={loadingDispatches}>
                                        {loadingDispatches ? (
                                            <>
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                Carregando...
                                            </>
                                        ) : (
                                            'Carregar Mais'
                                        )}
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
                

                
                <TabsContent value="replies">
                    <Card>
                        <CardHeader>
                            <CardTitle>Respostas Recebidas</CardTitle>
                            <CardDescription>Interações diretas com a campanha</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Desktop View */}
                            <div className="hidden md:block overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="whitespace-nowrap">Contato</TableHead>
                                            <TableHead className="min-w-[200px]">Mensagem</TableHead>
                                            <TableHead className="whitespace-nowrap">Data</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {replies.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                                                    Nenhuma resposta registrada ainda.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            replies.map((reply: any) => (
                                                <TableRow key={reply.id}>
                                                    <TableCell className="whitespace-nowrap">
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{reply.name}</span>
                                                            <span className="text-xs text-muted-foreground">{reply.phone}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="min-w-[200px]">{reply.message || reply.content}</TableCell>
                                                    <TableCell className="whitespace-nowrap">{new Date(reply.timestamp || reply.createdAt).toLocaleString()}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Mobile View (Cards) */}
                            <div className="md:hidden space-y-4">
                                {replies.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/20">
                                        Nenhuma resposta registrada ainda.
                                    </div>
                                ) : (
                                    replies.map((reply: any) => (
                                        <div key={reply.id} className="p-4 border rounded-lg space-y-3 bg-card">
                                            <div className="flex items-center justify-between">
                                                 <div className="font-medium">{reply.name}</div>
                                                 <span className="text-xs text-muted-foreground">{new Date(reply.timestamp || reply.createdAt).toLocaleDateString('pt-BR')}</span>
                                            </div>
                                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                                 <Users className="w-3 h-3" />
                                                 {reply.phone}
                                            </div>
                                            <div className="bg-muted p-3 rounded-md text-sm italic">
                                                &quot;{reply.message || reply.content}&quot;
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="blocks">
                    <Card>
                        <CardHeader>
                            <CardTitle>Solicitações de Bloqueio</CardTitle>
                            <CardDescription>Contatos que pediram para não receber mais mensagens</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Desktop View */}
                            <div className="hidden md:block overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="whitespace-nowrap">Contato</TableHead>
                                            <TableHead className="whitespace-nowrap">Data do Bloqueio</TableHead>
                                            <TableHead className="whitespace-nowrap">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {blocks.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                                                    Nenhum bloqueio registrado.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            blocks.map((block: any) => (
                                                <TableRow key={block.id}>
                                                    <TableCell className="whitespace-nowrap">
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{block.name}</span>
                                                            <span className="text-xs text-muted-foreground">{block.phone}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">{new Date(block.timestamp || block.createdAt).toLocaleString()}</TableCell>
                                                    <TableCell className="whitespace-nowrap">
                                                        <Badge variant="destructive">Bloqueado</Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Mobile View (Cards) */}
                            <div className="md:hidden space-y-4">
                                {blocks.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/20">
                                        Nenhum bloqueio registrado.
                                    </div>
                                ) : (
                                    blocks.map((block: any) => (
                                        <div key={block.id} className="p-4 border rounded-lg space-y-3 bg-card border-red-100 dark:border-red-900/30">
                                            <div className="flex items-center justify-between">
                                                 <div className="font-medium">{block.name}</div>
                                                 <Badge variant="destructive">Bloqueado</Badge>
                                            </div>
                                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                                 <Users className="w-3 h-3" />
                                                 {block.phone}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                Data: {new Date(block.timestamp || block.createdAt).toLocaleString()}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
