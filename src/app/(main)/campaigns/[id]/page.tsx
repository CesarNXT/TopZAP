'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useFirestore } from '@/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Campaign } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MessageSquare, ShieldAlert, CheckCircle2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function CampaignReportPage() {
    const { id } = useParams();
    const { user } = useUser();
    const firestore = useFirestore();
    const router = useRouter();
    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user || !id) return;
        
        const docRef = doc(firestore, 'users', user.uid, 'campaigns', id as string);
        const unsubscribe = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                setCampaign({ id: snap.id, ...snap.data() } as Campaign);
            } else {
                setCampaign(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, id, firestore]);

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

    const stats = campaign.stats || {};
    const sent = stats.sent || (campaign as any).count || 0;
    const recipients = campaign.recipients || 1;
    const progress = Math.min(100, Math.round((sent / recipients) * 100));
    
    // Derived stats
    const replied = stats.replied || 0;
    const blocked = stats.blocked || 0;
    const delivered = stats.delivered || 0;

    return (
        <div className="container mx-auto py-8 space-y-8">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => router.back()}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">{campaign.name}</h1>
                    <div className="flex items-center gap-2 text-muted-foreground mt-1">
                        <span>Enviada em {new Date(campaign.sentDate).toLocaleDateString()}</span>
                        <Badge variant={campaign.status === 'Completed' ? 'default' : 'secondary'}>
                            {campaign.status}
                        </Badge>
                    </div>
                </div>
            </div>

            {/* Progress Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Progresso do Envio</CardTitle>
                    <CardDescription>Status atual da execução da campanha.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span>{sent} de {recipients} enviados</span>
                            <span className="font-bold">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-4" />
                        <p className="text-xs text-muted-foreground pt-2">
                            {campaign.status === 'Scheduled' && 'O envio está agendado e será processado automaticamente.'}
                            {campaign.status === 'Sent' && 'O envio está em andamento.'}
                            {campaign.status === 'Completed' && 'O envio foi concluído.'}
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de Respostas</CardTitle>
                        <MessageSquare className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{replied}</div>
                        <p className="text-xs text-muted-foreground">Contatos que responderam</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Bloqueios Solicitados</CardTitle>
                        <ShieldAlert className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{blocked}</div>
                        <p className="text-xs text-muted-foreground">Contatos que pediram bloqueio</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Entregues</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{delivered || '-'}</div>
                        <p className="text-xs text-muted-foreground">Mensagens confirmadas</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Público Alvo</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{recipients}</div>
                        <p className="text-xs text-muted-foreground">Total de destinatários</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
