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
  CalendarDays,
  BadgeDollarSign
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area
} from 'recharts';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { Campaign } from '@/lib/types';
import { subDays, format, isToday, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useUser, useCollection, useFirestore } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { collection, query, orderBy, limit, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useMemo } from 'react';


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
        
        // Fetching all campaigns to calculate lifetime stats
        // Limit set to 1000 to prevent performance issues with massive accounts
        return query(
            collection(firestore, 'users', user.uid, 'campaigns'), 
            orderBy('createdAt', 'desc'),
            limit(1000)
        );
    }, [firestore, user]);

    const { data: allCampaigns } = useCollection<Campaign>(campaignsQuery);

    const stats = useMemo(() => {
        let sentToday = 0;
        let sentMonth = 0;
        let pending = 0;
        let totalSentAllTime = 0;
        let totalFailedAllTime = 0;
        let totalReplies = 0;
        
        const dailyData: Record<string, { success: number, fails: number, savings: number }> = {};
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const currentMonthStr = format(new Date(), 'yyyy-MM');

        // Initialize dailyData for last 7 days
        for(let i=0; i<7; i++) {
             const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
             dailyData[d] = { success: 0, fails: 0, savings: 0 };
        }

        const campaigns = allCampaigns || [];
        const totalCampaigns = campaigns.length;

        campaigns.forEach(campaign => {
            // 1. Process Batches (Preferred for granularity)
            if (campaign.batches) {
                Object.values(campaign.batches).forEach((batch: any) => {
                    let batchDate: Date | null = null;
                    if (batch.scheduledAt) batchDate = new Date(batch.scheduledAt);
                    else if (campaign.sentDate) batchDate = new Date(campaign.sentDate);
                    
                    if (!batchDate) return;

                    const dateKey = format(batchDate, 'yyyy-MM-dd');
                    const monthKey = format(batchDate, 'yyyy-MM');
                    
                    const sent = batch.stats?.sent || 0;
                    const failed = batch.stats?.failed || 0;
                    const count = batch.count || 0;
                    
                    // Pending logic
                    const batchPending = Math.max(0, count - sent - failed);
                    if (['Scheduled', 'Running', 'Paused', 'Sending'].includes(campaign.status) && batch.status !== 'completed') {
                         pending += batchPending;
                    }

                    if (dateKey === todayStr) sentToday += sent;
                    if (monthKey === currentMonthStr) sentMonth += sent;
                    
                    totalSentAllTime += sent;
                    totalFailedAllTime += failed;

                    // Chart Data
                    if (dailyData[dateKey]) {
                        dailyData[dateKey].success += sent;
                        dailyData[dateKey].fails += failed;
                        dailyData[dateKey].savings += (sent * 0.33);
                    }
                });
            } else {
                // Fallback for legacy campaigns without batches
                const dateStr = campaign.sentDate || campaign.createdAt;
                if (dateStr) {
                    const date = new Date(dateStr);
                    const sent = campaign.stats?.sent || campaign.recipients || 0;
                    const failed = campaign.stats?.failed || 0;
                    
                    const dateKey = format(date, 'yyyy-MM-dd');
                    const monthKey = format(date, 'yyyy-MM');

                    if (dateKey === todayStr) sentToday += sent;
                    if (monthKey === currentMonthStr) sentMonth += sent;
                    
                    totalSentAllTime += sent;
                    totalFailedAllTime += failed;
                    
                    if (['Scheduled', 'Draft', 'Paused'].includes(campaign.status)) {
                        pending += campaign.recipients || 0;
                    }

                    if (dailyData[dateKey]) {
                        dailyData[dateKey].success += sent;
                        dailyData[dateKey].fails += failed;
                        dailyData[dateKey].savings += (sent * 0.33);
                    }
                }
            }
            
            // Engagement
             const replies = campaign.stats?.replied || 0; 
             totalReplies += replies;
        });
        
        // Savings
        const savings = totalSentAllTime * 0.33;
        const engagementRate = totalSentAllTime > 0 ? (totalReplies / totalSentAllTime) * 100 : 0;
        const successRate = (totalSentAllTime + totalFailedAllTime) > 0 
            ? (totalSentAllTime / (totalSentAllTime + totalFailedAllTime)) * 100 
            : 0;

        // Weekly Chart Array
        const weeklyChart = Object.entries(dailyData)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, val]) => ({
                day: format(new Date(date), 'dd/MM'), // Use date directly since it's yyyy-MM-dd
                success: val.success,
                fails: val.fails,
                savings: Number(val.savings.toFixed(2))
            }));

        return { 
            sentToday, 
            sentMonth, 
            pending, 
            savings, 
            weeklyChart, 
            totalSentAllTime, 
            totalFailedAllTime,
            totalCampaigns,
            engagementRate,
            successRate
        };
    }, [allCampaigns]);

    const getEngagementLabel = (rate: number) => {
        if (rate >= 30) return { label: "Excelente", color: "text-green-600" };
        if (rate >= 15) return { label: "Muito Bom", color: "text-blue-600" };
        if (rate >= 5) return { label: "Bom", color: "text-yellow-600" };
        return { label: "Abaixo da Média", color: "text-red-600" };
    };

    const engagementLabel = getEngagementLabel(stats.engagementRate);

  return (
    <div className="container relative">
      <PageHeader className='pb-4'>
            <Greeting />
      </PageHeader>
      
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Row 1: Daily & Realtime Activity */}
        <StatCard
            id="tour-stats-card"
            title="Envios Hoje"
            value={stats.sentToday}
            description="Mensagens nas últimas 24h"
            icon={<MessageSquareText />}
            gradient="from-blue-400 to-green-300"
        />

        <StatCard
            title="Fila de Espera"
            value={stats.pending}
            description="Aguardando envio"
            icon={<Clock />}
            gradient="from-yellow-400 to-orange-400"
        />

        <StatCard
            title="Taxa de Engajamento"
            value={
                <div className="flex flex-col items-start">
                    <span>{stats.engagementRate.toFixed(1)}%</span>
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
            value={stats.sentMonth}
            description="Total de envios este mês"
            icon={<CalendarDays />}
            gradient="from-pink-400 to-rose-400"
        />

        {/* Row 2: Lifetime Stats & Value */}
        <StatCard
            title="Total de Envios"
            value={stats.totalSentAllTime}
            description="Desde o início"
            icon={<MessageSquareText />}
            gradient="from-cyan-400 to-blue-400"
        />

        <StatCard
            title="Total de Campanhas"
            value={stats.totalCampaigns}
            description="Campanhas criadas"
            icon={<CalendarDays />}
            gradient="from-indigo-400 to-violet-400"
        />

        <StatCard
            title="Taxa de Sucesso"
            value={`${stats.successRate.toFixed(1)}%`}
            description="Mensagens entregues vs falhas"
            icon={<TrendingUp />}
            gradient={stats.successRate >= 90 ? "from-emerald-400 to-green-400" : "from-orange-400 to-red-400"}
        />

        <StatCard
            title="Economia Total"
            value={`R$ ${stats.savings.toFixed(2).replace('.', ',')}`}
            description="Economia vs API Oficial (R$ 0,33/msg)"
            icon={<BadgeDollarSign />}
            gradient="from-emerald-400 to-teal-400"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card className="shadow-sm">
                <CardHeader>
                    <CardTitle>Desempenho da Semana</CardTitle>
                    <CardDescription>Envios bem-sucedidos vs. falhas nos últimos 7 dias.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={stats.weeklyChart}>
                            <XAxis dataKey="day" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}/>
                            <Bar dataKey="success" name="Sucesso" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="fails" name="Falhas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            <Card className="shadow-sm">
                <CardHeader>
                    <CardTitle>Economia Diária</CardTitle>
                    <CardDescription>Valor economizado por dia (vs API Oficial)</CardDescription>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={stats.weeklyChart}>
                            <defs>
                                <linearGradient id="colorSavings" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="day" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} unit="R$" />
                            <Tooltip 
                                contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                                formatter={(value: number) => [`R$ ${value.toFixed(2)}`, 'Economia']}
                            />
                            <Area type="monotone" dataKey="savings" stroke="#10b981" fillOpacity={1} fill="url(#colorSavings)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
      </div>
    </div>
  );
}
