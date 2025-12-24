'use client';

import React from 'react';
import { PageHeader, PageHeaderHeading } from '@/components/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
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
  BatteryWarning,
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

// --- Mock Data ---
const dailyStats = {
  sentToday: 150,
  inQueue: 12,
  errorRate: 1.3, // percentage
  dailyLimit: 500,
};

const weeklyPerformance = [
  { day: 'Seg', success: 98, fails: 2 },
  { day: 'Ter', success: 120, fails: 5 },
  { day: 'Qua', success: 150, fails: 1 },
  { day: 'Qui', success: 135, fails: 3 },
  { day: 'Sex', success: 180, fails: 8 },
  { day: 'Sáb', success: 250, fails: 12 },
  { day: 'Dom', success: 210, fails: 4 },
];

const lastSentMessages = [
    { id: 1, to: "Ana Silva", status: "Sent", campaign: "Promo de Verão" },
    { id: 2, to: "Bruno Costa", status: "Sent", campaign: "Promo de Verão" },
    { id: 3, to: "Carla Dias", status: "Failed", campaign: "Promo de Verão" },
    { id: 4, to: "Daniel Alves", status: "Sent", campaign: "Promo de Verão" },
    { id: 5, to: "Eduarda Lima", status: "Waiting", campaign: "Lançamento Outono" },
]

const totalSentThisMonth = 3250;
const costPerMessage = 0.30;
const savingsThisMonth = (totalSentThisMonth * costPerMessage).toFixed(2).replace('.', ',');


const Greeting = () => {
    const [greeting, setGreeting] = React.useState('');

    React.useEffect(() => {
        const hour = new Date().getHours();
        if (hour < 12) {
            setGreeting('Bom dia! ☀️ Vamos vender hoje?');
        } else if (hour < 18) {
            setGreeting('Boa tarde! ☕ Vamos vender hoje?');
        } else {
            setGreeting('Boa noite! 🌙');
        }
    }, []);

    return <PageHeaderHeading>{greeting}</PageHeaderHeading>;
}


const ConnectionStatus = () => {
    const status = 'connected'; 

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
            button: <Button><Power className="mr-2" /> Reconectar Agora</Button>,
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
                <MessageSquareQuote className="mr-4 h-8 w-8" /> Ver Quem Respondeu
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
                <p className={`text-4xl font-bold ${dailyStats.errorRate > 5 ? 'text-destructive' : ''}`}>{dailyStats.errorRate}%</p>
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-6">
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

        <div className="lg:col-span-4 space-y-6">
            <Card className="bg-blue-500/10 border-blue-500/30 text-center">
                <CardHeader>
                    <CardTitle className="text-blue-800 dark:text-blue-300">Economia do Mês</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-4xl font-bold text-blue-800 dark:text-blue-300">R$ {savingsThisMonth}</p>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-2">Você economizou este valor em comparação com a API Oficial do WhatsApp.</p>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Avisos do Sistema</CardTitle>
                </CardHeader>
                <CardContent>
                     <Alert variant="destructive">
                        <BatteryWarning className="h-4 w-4" />
                        <AlertTitle>Bateria Baixa!</AlertTitle>
                        <AlertDescription>
                            A bateria do celular conectado está em 15%. Conecte-o ao carregador para garantir os envios.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>
        </div>

      </div>
    </div>
  );
}
