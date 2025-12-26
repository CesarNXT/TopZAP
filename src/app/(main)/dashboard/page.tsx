'use client';

import React from 'react';
import { PageHeader, PageHeaderHeading } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Clock,
  MessageSquareText,
  TrendingUp,
  TriangleAlert,
  XCircle,
  PlusCircle,
  CalendarDays
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
import type { Campaign } from '@/lib/types';
import { subDays, format, isToday, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useUser, useCollection, useFirestore } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import Link from 'next/link';


const Greeting = () => {
    const { user } = useUser();
    const userName = user?.displayName || "Usuário";
    return <PageHeaderHeading>Olá, {userName}.</PageHeaderHeading>;
}

const StatCard: React.FC<{ title: string; value: string | number | React.ReactNode; description: string; icon: React.ReactNode; isError?: boolean, id?: string, gradient?: string }> = ({ title, value, description, icon, isError, id, gradient }) => (
    <div id={id} className={`relative p-[2px] rounded-xl bg-gradient-to-r ${gradient || 'from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800'} shadow-sm hover:shadow-md transition-shadow duration-300`}>
        <div className={`h-full w-full bg-card rounded-lg ${isError ? 'bg-destructive/10' : ''}`}>
            <CardHeader className="pb-2">
                <CardTitle className='flex items-center justify-between text-base'>
                    <span>{title}</span>
                    <div className={`h-5 w-5 ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{icon}</div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className={`text-4xl font-bold tracking-tight ${isError ? 'text-destructive' : 'text-foreground'}`}>
                    {value}
                </div>
                <p className='text-sm text-muted-foreground'>{description}</p>
            </CardContent>
        </div>
    </div>
);

export default function DashboardPage() {
    const { user } = useUser();
    const firestore = useFirestore();

    const campaignsQuery = useMemoFirebase(() => {
        if (!user) return null;
        return query(collection(firestore, 'users', user.uid, 'campaigns'), orderBy('sentDate', 'desc'));
    }, [firestore, user]);

    const { data: allCampaigns } = useCollection<Campaign>(campaignsQuery);

    const campaignsData = allCampaigns || [];

    const currentMonthPrefix = format(new Date(), 'yyyy-MM');

    const monthlyStats = {
        sent: campaignsData
            .filter(c => c.sentDate && c.sentDate.startsWith(currentMonthPrefix))
            .reduce((acc, curr) => {
                // Sum sent messages (fallback to recipients count if stats.sent missing)
                const sent = curr.stats?.sent ?? curr.recipients ?? 0;
                return acc + sent;
            }, 0)
    };

    const engagementStats = (() => {
        const validCampaigns = campaignsData.filter(c => 
            ['Sent', 'Completed', 'Done', 'Concluído'].includes(c.status || '')
        );
        
        if (validCampaigns.length === 0) return 0;

        let totalRecipients = 0;
        let totalEngaged = 0;

        validCampaigns.forEach(c => {
            const rec = c.recipients || 0;
            if (rec > 0) {
                totalRecipients += rec;
                // Engagement: Max of replies (engagement) or read count
                // User defined: "minimo de resposta"
                const engaged = Math.max(c.engagement || 0, c.stats?.read || 0);
                totalEngaged += engaged;
            }
        });

        return totalRecipients > 0 ? (totalEngaged / totalRecipients) * 100 : 0;
    })();

    const dailyStats = {
        sentToday: campaignsData.filter(c => c.status === 'Sent' && c.sentDate && isToday(new Date(c.sentDate))).length,
        inQueue: campaignsData.filter(c => c.status === 'Scheduled').length,
        engagementRate: engagementStats,
        monthlySent: monthlyStats.sent
    };

    const getEngagementLabel = (rate: number) => {
        if (rate >= 30) return { label: "Excelente", color: "text-green-600" };
        if (rate >= 15) return { label: "Muito Bom", color: "text-blue-600" };
        if (rate >= 5) return { label: "Bom", color: "text-yellow-600" };
        return { label: "Abaixo da Média", color: "text-red-600" };
    };

    const engagementLabel = getEngagementLabel(dailyStats.engagementRate);

    const weeklyPerformance = Array.from({ length: 7 }).map((_, i) => {
        const date = subDays(new Date(), i);
        const sentOnDay = campaignsData.filter(c => c.sentDate && c.sentDate.startsWith(format(date, 'yyyy-MM-dd')));
        return {
            day: format(date, 'EEE', { locale: ptBR }),
            success: sentOnDay.filter(c => c.status === 'Sent').length,
            fails: sentOnDay.filter(c => c.status === 'Failed').length,
        };
    }).reverse();

    const lastSentMessages = campaignsData
        .filter(c => c.status === 'Sent' || c.status === 'Failed' || c.status === 'Scheduled')
        .slice(0, 5)
        .map(c => ({
            id: c.id,
            to: `Campanha para ${c.recipients} contatos`,
            status: c.status === 'Scheduled' ? 'Waiting' : c.status,
            campaign: c.name,
        }));

  return (
    <div className="container relative">
      <PageHeader className='pb-4'>
            <Greeting />
      </PageHeader>
      
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
            id="tour-stats-card"
            title="Envios Hoje"
            value={dailyStats.sentToday}
            description="Mensagens nas últimas 24h"
            icon={<MessageSquareText />}
            gradient="from-blue-400 to-green-300"
        />

        <StatCard
            title="Fila de Espera"
            value={dailyStats.inQueue}
            description="Aguardando envio"
            icon={<Clock />}
            gradient="from-yellow-400 to-orange-400"
        />

        <StatCard
            title="Taxa de Engajamento"
            value={
                <div className="flex flex-col items-start">
                    <span>{dailyStats.engagementRate.toFixed(1)}%</span>
                    <span className={`text-xs font-medium ${engagementLabel.color} mt-1`}>
                        {engagementLabel.label}
                    </span>
                </div>
            }
            description="Média de respostas/leituras"
            icon={<TrendingUp />}
            gradient="from-purple-400 to-indigo-400"
        />

        <StatCard
            title="Envios no Mês"
            value={dailyStats.monthlySent}
            description="Total de envios este mês"
            icon={<CalendarDays />}
            gradient="from-pink-400 to-rose-400"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6">
        <div className="space-y-6">
            <Card className="shadow-sm">
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
      </div>
    </div>
  );
}
