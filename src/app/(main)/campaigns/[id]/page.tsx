'use client';
import {
  Download,
  CheckCircle,
  XCircle,
  MessageSquareText,
  TrendingUp,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { campaigns, contacts } from '@/lib/data';
import type { Campaign } from '@/lib/types';
import { PageHeader, PageHeaderHeading, PageHeaderActions } from '@/components/page-header';

export default function CampaignReportPage({
  params,
}: {
  params: { id: string };
}) {
  const [isClient, setIsClient] = useState(false);
  const campaign = campaigns.find(c => c.id === params.id) as Campaign; // Mock

  const reportData = {
    campaignName: campaign.name,
    date: new Date(campaign.sentDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
    stats: {
      total: campaign.recipients,
      success: Math.floor(campaign.recipients * (campaign.engagement / 100)),
      failed: Math.floor(campaign.recipients * (1 - campaign.engagement / 100)),
      economySaved: (campaign.recipients * 0.3).toFixed(2).replace('.', ','),
    },
    contacts: contacts.slice(0, 10).map(c => ({
      name: c.name,
      phone: c.phone,
      status: Math.random() > 0.2 ? 'Sucesso' : 'Falha',
    })),
  };

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <div className="container px-4 py-6 md:px-6 lg:py-8">
      <PageHeader className="mb-6">
        <div>
          <PageHeaderHeading>Relatório: {reportData.campaignName}</PageHeaderHeading>
          <p className="text-muted-foreground mt-2">
            Relatório detalhado da campanha enviada em {reportData.date}.
          </p>
        </div>
        <PageHeaderActions>
          {isClient && (
            <Button>
              <Download className="mr-2 h-4 w-4" />
              Baixar PDF
            </Button>
          )}
        </PageHeaderActions>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Envios</CardTitle>
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reportData.stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sucesso</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reportData.stats.success}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Falhas</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reportData.stats.failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Abertura</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaign.engagement}%</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Detalhes por Contato</CardTitle>
          <CardDescription>
            Status de entrega para cada contato na campanha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportData.contacts.map((contact, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell>{contact.phone}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        contact.status === 'Sucesso' ? 'default' : 'destructive'
                      }
                      className={
                        contact.status === 'Sucesso'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }
                    >
                      {contact.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
