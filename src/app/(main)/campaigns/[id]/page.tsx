'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useFirestore, useCollection } from '@/firebase';
import { doc, onSnapshot, collection, query, orderBy, updateDoc } from 'firebase/firestore';
import { Campaign } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MessageSquare, ShieldAlert, CheckCircle2, Users, Play, Pause, Trash2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getCampaignMessagesFromProvider, getCampaignsFromProvider, controlCampaign } from '@/app/actions/whatsapp-actions';
import { deleteCampaignAction, getCampaignInteractionsAction } from '@/app/actions/campaign-actions';
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

    const uid = user?.uid;

    // Fetch interactions via Server Action (Bypass Security Rules)
    useEffect(() => {
        if (!uid || !id) return;
        
        async function loadInteractions() {
             const result = await getCampaignInteractionsAction(uid!, id as string);
             if (result.success && result.data) {
                 setInteractions(result.data);
             } else {
                 console.warn("Failed to load interactions via server action:", result.error);
             }
        }
        
        loadInteractions();
    }, [uid, id]);

    // Use empty array fallback for derived states
    const replies = interactions?.filter((i: any) => i.type === 'reply') || [];
    const blocks = interactions?.filter((i: any) => i.type === 'block') || [];

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
            if (!messagesResult.error && messagesResult.messages) {
                setMessages(messagesResult.messages);

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

                try {
                    const campaignRef = doc(firestore, 'users', uid, 'campaigns', id as string);
                    // Only update if stats have changed or it's been a while? 
                    // For now, update always to ensure consistency
                    await updateDoc(campaignRef, {
                        stats: newStats,
                        // Update status if it looks completed based on messages
                        // But be careful not to override 'Paused' or 'Scheduled' if not all sent
                    });
                } catch (e) {
                    console.error("Failed to sync stats to Firestore:", e);
                }
            }
        } catch (error) {
            console.error('Failed to refresh data:', error);
            toast({ variant: 'destructive', title: 'Erro ao atualizar dados', description: 'Não foi possível sincronizar com o provedor.' });
        } finally {
            setRefreshing(false);
        }
    }, [uid, id, toast]);

    // Initial load from provider
    useEffect(() => {
        if (uid && id) {
            refreshData();
        }
    }, [uid, id, refreshData]);

    const handleControl = async (action: 'stop' | 'continue' | 'delete') => {
        if (!uid || !id) return;
        
        if (action === 'delete') {
             if (!confirm('Tem certeza que deseja excluir esta campanha? Esta ação é irreversível.')) return;
        }

        setIsControlling(true);
        // Use campaign.uazapiId if available, otherwise fall back to id (which likely fails on provider but allows local delete)
        const uazapiId = campaign?.uazapiId || (campaign as any)?.folderId || undefined;
        const result = await controlCampaign(uid, id as string, action, uazapiId);
        setIsControlling(false);

        if (result.success) {
            toast({ 
                title: action === 'stop' ? "Campanha pausada" : action === 'continue' ? "Campanha retomada" : "Campanha excluída",
                description: "O status foi atualizado."
            });
            if (action === 'delete') {
                router.push('/campaigns');
            } else {
                refreshData();
            }
        } else {
            toast({ variant: "destructive", title: "Erro na ação", description: result.error });
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

    const sent = useLocalStats ? localStats.sent : (providerStats ? (providerStats.log_total || 0) : (campaign.stats?.sent || (campaign as any).count || 0));
    const delivered = useLocalStats ? localStats.delivered : (providerStats ? (providerStats.log_delivered || 0) : (campaign.stats?.delivered || 0));
    const read = useLocalStats ? localStats.read : (providerStats ? (providerStats.log_read || 0) : (campaign.stats?.read || 0));
    const failed = useLocalStats ? localStats.failed : (providerStats ? (providerStats.log_failed || 0) : (campaign.stats?.failed || 0));
    
    const recipients = campaign.recipients || 1;
    
    // Calculate actual completed count (delivered + read + failed + sent)
    // We include 'sent' because for the user, if it's sent, it's processed/done.
    // This fixes the issue where progress shows 0% even if messages are 'Sent'.
    const completedCount = delivered + read + failed + sent;
    
    // If we want to show "Processed" (including scheduled), we keep it as is.
    // But user wants "Concluded". 
    // Let's use completedCount for the progress bar percentage.
    const progress = Math.min(100, Math.round((completedCount / recipients) * 100));

    const statusRaw = campaign.status || 'Draft';
    // Normalize status for display logic
    const status = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1).toLowerCase();

    const displayStatus = (status === 'Completed' || status === 'Done') ? 'Concluído' : 
                          status === 'Paused' ? 'Pausado' : 
                          status === 'Scheduled' ? 'Agendado' :
                          status === 'Sending' ? 'Enviando' : status;

    const canPause = status === 'Scheduled' || status === 'Sending';
    const canResume = status === 'Paused';

    const formatMessageDate = (timestamp: number) => {
        if (!timestamp) return '-';
        // Check if timestamp is in seconds (Unix timestamp) or milliseconds
        // Unix timestamp for 2024 is around 1.7 billion (10 digits)
        // Milliseconds timestamp is around 1.7 trillion (13 digits)
        const isSeconds = timestamp < 100000000000; 
        return new Date(timestamp * (isSeconds ? 1000 : 1)).toLocaleString();
    };

    const translateStatus = (status: string) => {
        const s = status?.toLowerCase() || '';
        if (s === 'read') return 'Engajado';
        if (s === 'delivered') return 'Entregue';
        if (s === 'sent') return 'Enviado';
        if (s === 'failed') return 'Falhou';
        if (s === 'scheduled') return 'Agendado';
        if (s === 'sending') return 'Enviando';
        return status;
    };

    return (
        <div className="container mx-auto py-8 space-y-8">
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
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={refreshData} disabled={refreshing}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        Atualizar
                    </Button>
                    {canPause && (
                        <Button variant="outline" size="sm" onClick={() => handleControl('stop')} disabled={isControlling}>
                            <Pause className="w-4 h-4 mr-2" /> Pausar
                        </Button>
                    )}
                    {canResume && (
                        <Button variant="outline" size="sm" onClick={() => handleControl('continue')} disabled={isControlling}>
                            <Play className="w-4 h-4 mr-2" /> Retomar
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

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Interação</CardTitle>
                        <MessageSquare className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{replies.length}</div>
                        <p className="text-xs text-muted-foreground">Mensagens respondidas</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Bloqueados</CardTitle>
                        <ShieldAlert className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{blocks.length}</div>
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
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Processado</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{sent}</div>
                        <p className="text-xs text-muted-foreground">Enviadas para fila</p>
                    </CardContent>
                </Card>
            </div>

            {/* Interactions Tabs */}
            <Tabs defaultValue="messages" className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="messages">Mensagens</TabsTrigger>
                    <TabsTrigger value="replies">
                        Respostas
                        {replies.length > 0 && <Badge variant="secondary" className="ml-2">{replies.length}</Badge>}
                    </TabsTrigger>
                    <TabsTrigger value="blocks">
                        Bloqueios
                        {blocks.length > 0 && <Badge variant="destructive" className="ml-2">{blocks.length}</Badge>}
                    </TabsTrigger>
                </TabsList>
                
                <TabsContent value="messages">
                    <Card>
                        <CardHeader>
                            <CardTitle>Detalhamento de Mensagens</CardTitle>
                            <CardDescription>Status individual de cada envio (Últimas 50)</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Destinatário</TableHead>
                                        <TableHead>Mensagem</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Reação</TableHead>
                                        <TableHead>Data/Hora</TableHead>
                                        <TableHead>Erro</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {messages.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                                                Nenhuma mensagem encontrada ou carregando...
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        messages.map((msg: any) => (
                                            <TableRow key={msg.id}>
                                                <TableCell>{msg.sender_pn || msg.chatid || 'Desconhecido'}</TableCell>
                                                <TableCell className="max-w-[200px] truncate" title={typeof msg.message === 'string' ? msg.message : (msg.message?.text || JSON.stringify(msg.message))}>
                                                    {typeof msg.message === 'string' ? msg.message : (msg.message?.text || msg.message?.caption || 'Mídia/Outro')}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={
                                                        msg.status === 'read' ? 'default' :
                                                        msg.status === 'delivered' ? 'secondary' :
                                                        msg.status === 'sent' ? 'secondary' :
                                                        msg.status === 'failed' ? 'destructive' : 'outline'
                                                    }>
                                                        {translateStatus(msg.status)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    {msg.reaction ? (
                                                        <span className="text-lg">{msg.reaction}</span>
                                                    ) : (
                                                        <span className="text-muted-foreground text-sm">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {formatMessageDate(msg.messageTimestamp)}
                                                </TableCell>
                                                <TableCell className="text-red-500 text-sm truncate max-w-[200px]">
                                                    {msg.error || '-'}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
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
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Contato</TableHead>
                                        <TableHead>Mensagem</TableHead>
                                        <TableHead>Data</TableHead>
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
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{reply.name}</span>
                                                        <span className="text-xs text-muted-foreground">{reply.phone}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>{reply.content}</TableCell>
                                                <TableCell>{new Date(reply.createdAt).toLocaleString()}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
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
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Contato</TableHead>
                                        <TableHead>Data do Bloqueio</TableHead>
                                        <TableHead>Status</TableHead>
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
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{block.name}</span>
                                                        <span className="text-xs text-muted-foreground">{block.phone}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>{new Date(block.createdAt).toLocaleString()}</TableCell>
                                                <TableCell>
                                                    <Badge variant="destructive">Bloqueado</Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
