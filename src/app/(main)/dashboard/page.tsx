'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader, PageHeaderHeading } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Clock,
  MessageSquareText,
  PlusCircle,
  TrendingUp,
  TriangleAlert,
  XCircle,
  Power,
  ServerCrash,
  MessageSquareQuote
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import type { Campaign } from '@/lib/types';
import { campaigns as defaultCampaigns } from '@/lib/data';
import { subDays, format, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const Greeting = () => {
    // Hardcoded user name for now.
    const userName = "Usuário";
    return <PageHeaderHeading>Olá, {userName}.</PageHeaderHeading>;
}

const ConnectionStatus = () => {
    const status = 'disconnected'; 

    const statusConfig = {
        connected: {
            icon: <CheckCircle2 className="h-10 w-10 text-green-500" />,
            title: 'Online e pronto para envio',
            description: 'A conexão com o WhatsApp está ativa e operando normalmente.',
            button: null,
            cardClass: 'bg-green-500/10 border-green-500/50'
        },
        disconnected: {
            icon: <ServerCrash className="h-10 w-10 text-destructive" />,
            title: 'Conexão perdida',
            description: 'Não foi possível conectar ao WhatsApp. Suas campanhas estão pausadas.',
            button: <Button asChild><Link href="/whatsapp-connect"><Power className="mr-2" /> Conectar Agora</Link></Button>,
            cardClass: 'bg-destructive/10 border-destructive/50'
        },
        waiting: {
            icon: <Clock className="h-10 w-10 text-yellow-500 animate-spin" />,
            title: 'Aguardando conexão...',
            description: 'Tentando restabelecer a conexão com o WhatsApp. Por favor, aguarde.',
            button: null,
            cardClass: 'bg-yellow-500/10 border-yellow-500/50'
        }
    }

    const currentStatus = statusConfig[status];

  return (
    <Card className={currentStatus.cardClass}>
      <CardHeader className="flex flex-row items-center gap-4 space-y-0">
        {currentStatus.icon}
        <div className='flex-1'>
          <CardTitle>{currentStatus.title}</CardTitle>
          <CardDescription>{currentStatus.description}</CardDescription>
        </div>
        {currentStatus.button}
      </CardHeader>
    </Card>
  );
};


export default function DashboardPage() {
    const [isMounted, setIsMounted] = useState(false);
    const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);

    useEffect(() => {
        setIsMounted(true);
        try {
            const storedCampaigns = localStorage.getItem('campaigns');
            if (storedCampaigns) {
                setAllCampaigns(JSON.parse(storedCampaigns));
            } else {
                localStorage.setItem('campaigns', JSON.stringify(defaultCampaigns));
                setAllCampaigns(defaultCampaigns);
            }
        } catch (error) {
            console.error("Failed to access localStorage", error);
            setAllCampaigns(defaultCampaigns);
        }
    }, []);

    const dailyStats = {
        sentToday: allCampaigns.filter(c => c.status === 'Sent' && isToday(parseISO(c.sentDate))).length,
        inQueue: allCampaigns.filter(c => c.status === 'Scheduled').length,
        errorRate: allCampaigns.filter(c => isToday(parseISO(c.sentDate)) && c.status !== 'Sent').length > 0 ?
            (allCampaigns.filter(c => isToday(parseISO(c.sentDate)) && c.status !== 'Sent').length / allCampaigns.filter(c => isToday(parseISO(c.sentDate))).length) * 100
            : 0,
        dailyLimit: 300,
    };

    const weeklyPerformance = Array.from({ length: 7 }).map((_, i) => {
        const date = subDays(new Date(), i);
        const sentOnDay = allCampaigns.filter(c => c.sentDate.startsWith(format(date, 'yyyy-MM-dd')));
        return {
            day: format(date, 'EEE', { locale: ptBR }),
            success: sentOnDay.filter(c => c.status === 'Sent').length,
            fails: sentOnDay.filter(c => c.status === 'Failed').length,
        };
    }).reverse();

    const lastSentMessages = allCampaigns
        .filter(c => c.status === 'Sent' || c.status === 'Failed' || c.status === 'Scheduled')
        .sort((a, b) => parseISO(b.sentDate).getTime() - parseISO(a.sentDate).getTime())
        .slice(0, 5)
        .map(c => ({
            id: c.id,
            to: `Campanha para ${c.recipients} contatos`,
            status: c.status === 'Scheduled' ? 'Waiting' : c.status,
            campaign: c.name,
        }));

    if (!isMounted) {
        return null;
    }

  return (
    <div className="container relative">
      <PageHeader className='pb-4'>
            <Greeting />
      </PageHeader>
      
      <ConnectionStatus />

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Button size="lg" className="h-20 text-lg" asChild>
            <Link href="/campaigns/new">
                <PlusCircle className="mr-4 h-8 w-8" /> Enviar Nova Mensagem
            </Link>
        </Button>
        <Button size="lg" variant="secondary" className="h-20 text-lg" asChild>
            <Link href="/campaigns">
                <MessageSquareQuote className="mr-4 h-8 w-8" /> Ver Campanhas
            </Link>
        </Button>
      </div>


      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
            <CardHeader>
                <CardTitle className='flex items-center justify-between text-base'>
                    <span>Envios Hoje</span>
                    <MessageSquareText className="h-5 w-5 text-muted-foreground" />
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-4xl font-bold">{dailyStats.sentToday}</p>
                <p className='text-sm text-muted-foreground'>Mensagens nas últimas 24h</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle className='flex items-center justify-between text-base'>
                    <span>Fila de Espera</span>
                    <Clock className="h-5 w-5 text-muted-foreground" />
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-4xl font-bold">{dailyStats.inQueue}</p>
                 <p className='text-sm text-muted-foreground'>Aguardando envio</p>
            </CardContent>
        </Card>
        <Card className={dailyStats.errorRate > 5 ? 'border-destructive/50 bg-destructive/10' : ''}>
            <CardHeader>
                <CardTitle className='flex items-center justify-between text-base'>
                    <span>Taxa de Erro</span>
                    <XCircle className={`h-5 w-5 ${dailyStats.errorRate > 5 ? 'text-destructive' : 'text-muted-foreground'}`} />
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className={`text-4xl font-bold ${dailyStats.errorRate > 5 ? 'text-destructive' : ''}`}>{dailyStats.errorRate.toFixed(1)}%</p>
                <p className='text-sm text-muted-foreground'>Falhas de envio hoje</p>
            </CardContent>
        </Card>
        <Card>
             <CardHeader>
                <CardTitle className='flex items-center justify-between text-base'>
                    <span>Limite de Segurança</span>
                    <TriangleAlert className="h-5 w-5 text-muted-foreground" />
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-2xl font-bold mb-2">{`${dailyStats.sentToday}/${dailyStats.dailyLimit}`}</p>
                <Progress value={(dailyStats.sentToday / dailyStats.dailyLimit) * 100} className='h-3' />
                 <p className='text-sm text-muted-foreground mt-2'>Cota de envios diária</p>
            </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Desempenho da Semana</CardTitle>
                    <CardDescription>Envios bem-sucedidos vs. falhas nos últimos 7 dias.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={weeklyPerformance}>
                            <XAxis dataKey="day" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}/>
                            <Bar dataKey="success" name="Sucesso" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="fails" name="Falhas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
        <div className="lg:col-span-1">
          <Card>
              <CardHeader>
                <CardTitle>Últimos Envios</CardTitle>
                <CardDescription>Mini-histórico das últimas 5 mensagens processadas.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {lastSentMessages.map(msg => (
                          <div key={msg.id} className="flex items-center justify-between">
                            <div className='space-y-1'>
                                <p className="font-medium">{msg.to}</p>
                                <p className="text-sm text-muted-foreground">{msg.campaign}</p>
                            </div>
                            <Badge variant={
                                msg.status === 'Sent' ? 'default' : 
                                msg.status === 'Failed' ? 'destructive' : 'secondary'
                            }
                            className={
                                msg.status === 'Sent' ? 'bg-primary/20 text-primary-foreground dark:text-primary' :
                                msg.status === 'Waiting' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : ''
                            }
                            >{msg.status}</Badge>
                        </div>
                    ))}
                </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
