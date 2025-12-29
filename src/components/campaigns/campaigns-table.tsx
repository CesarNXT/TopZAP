'use client';
import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getPaginationRowModel,
    SortingState,
    getSortedRowModel,
    ColumnFiltersState,
    getFilteredRowModel,
  } from "@tanstack/react-table"
import type { Campaign } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { MoreHorizontal, Loader2, Search, PlusCircle, Play, Pause, Trash2, Check, Eye, X } from 'lucide-react';
import Link from 'next/link';
import { useCollection } from '@/firebase';
import { useUser } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { deleteCampaignAction } from '@/app/actions/campaign-actions';
import { controlCampaign } from '@/app/actions/whatsapp-actions';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { getCampaignsFromProvider } from '@/app/actions/whatsapp-actions';

const CampaignActionsCell = ({ campaign }: { campaign: Campaign }) => {
    const { user } = useUser();
    const { toast } = useToast();
    const [isDeleting, setIsDeleting] = useState(false);
    const [isControlling, setIsControlling] = useState(false);

    const handleDelete = async () => {
        if (!user) return;
        
        if (!confirm('Tem certeza que deseja excluir esta campanha? O histórico local será apagado e os envios pendentes cancelados.')) return;

        setIsDeleting(true);
        const result = await deleteCampaignAction(user.uid, campaign.id);
        setIsDeleting(false);

        if (result.success) {
            toast({ title: "Campanha excluída com sucesso" });
        } else {
            toast({ variant: "destructive", title: "Erro ao excluir", description: result.error });
        }
    };

    const handleControl = async (action: 'stop' | 'continue') => {
        if (!user) return;
        setIsControlling(true);
        
        const result = await controlCampaign(user.uid, campaign.id, action);
        
        setIsControlling(false);

        if (result.success) {
            toast({ 
                title: action === 'stop' ? "Campanha pausada" : "Campanha retomada",
                description: "O status será atualizado em breve."
            });
        } else {
            toast({ variant: "destructive", title: "Erro na ação", description: result.error });
        }
    }

    const status = campaign.status?.toLowerCase() || '';
    const canStart = status === 'scheduled' || status === 'draft' || status === 'paused' || status === 'stopped';
    const canStop = status === 'sending';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Abrir menu</span>
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild className="text-green-600 focus:text-green-700 focus:bg-green-50 cursor-pointer font-medium">
                    <Link href={`/campaigns/${campaign.id}`}>
                        <Eye className="mr-2 h-4 w-4" />
                        Ver Detalhes
                    </Link>
                </DropdownMenuItem>
                
                {canStart && (
                    <DropdownMenuItem onClick={() => handleControl('continue')} disabled={isControlling} className="cursor-pointer">
                        <Play className="mr-2 h-4 w-4" />
                        <span>Iniciar Agora</span>
                    </DropdownMenuItem>
                )}

                {canStop && (
                    <DropdownMenuItem onClick={() => handleControl('stop')} disabled={isControlling} className="cursor-pointer">
                        <X className="mr-2 h-4 w-4" />
                        <span>Parar Envio</span>
                    </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem 
                    className="text-red-500 focus:text-red-600 focus:bg-red-50 cursor-pointer" 
                    onClick={handleDelete}
                    disabled={isDeleting}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>{isDeleting ? 'Excluindo...' : 'Excluir'}</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

const CampaignProgressCell = ({ campaign }: { campaign: Campaign }) => {
    const { user } = useUser();
    const [stats, setStats] = useState(campaign.stats || { sent: 0, delivered: 0, read: 0, failed: 0 });
    
    // Sync with prop updates
    useEffect(() => {
        if (campaign.stats) {
            setStats(campaign.stats);
        }
    }, [campaign.stats]);

    useEffect(() => {
        if (!user || !campaign.uazapiId) return;
        
        const fetchStats = async () => {
            const res = await getCampaignsFromProvider(user.uid);
            if (res.success && Array.isArray(res.data)) {
                // Find by UAZAPI ID (folderId)
                const remote = res.data.find((c: any) => c.id === campaign.uazapiId || c.folderId === campaign.uazapiId);
                if (remote) {
                    // Map UAZAPI stats to our format
                    // Prioritize log_sent (sent to provider) over log_total (total recipients)
                    const newStats = {
                        sent: remote.log_sent || remote.log_success || 0,
                        delivered: remote.log_delivered || 0,
                        read: remote.log_read || 0,
                        failed: remote.log_failed || 0,
                    };
                    setStats(newStats);
                }
            }
        };

        // Always fetch on mount/update to ensure fresh data
        fetchStats();
        
        const status = (campaign.status || '').toLowerCase();
        
        // Poll if active or recently finished to catch late delivery reports
        // Polling every 5s for better responsiveness
        if (status === 'sending' || status === 'scheduled' || status === 'sent' || status === 'completed') {
            const interval = setInterval(fetchStats, 5000);
            return () => clearInterval(interval);
        }
    }, [user, campaign.uazapiId, campaign.status]);

    const delivered = stats?.delivered || 0;
    const read = stats?.read || 0;
    const failed = stats?.failed || 0;
    const sent = stats?.sent || 0;
    
    // Calculate total processed (attempted)
    const countFromStats = sent + delivered + read + failed;
    const hasStats = countFromStats > 0;
    
    // Use stats count if available, otherwise campaign count
    const count = hasStats ? countFromStats : (campaign.count || 0);
    const recipients = campaign.recipients || 1;
    
    // Calculate percentage (clamp to 100)
    const percentage = recipients > 0 ? Math.min(100, Math.round((count / recipients) * 100)) : 0;
    
    // Success count (successfully processed)
    const successCount = sent + delivered + read;

    return (
        <div className="flex flex-col gap-2 w-[180px]">
            <div className="flex justify-between text-xs text-muted-foreground">
                <Progress value={percentage} className="h-2 w-20" />
                <span className="ml-2">{count}/{recipients}</span>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground">
                 <div className="flex items-center gap-1 text-green-600" title="Enviado/Entregue">
                     <Check className="w-3 h-3" />
                     <span>{successCount}</span>
                 </div>
                 <div className="flex items-center gap-1 text-blue-600" title="Lido">
                     <Eye className="w-3 h-3" />
                     <span>{read}</span>
                 </div>
                 <div className="flex items-center gap-1 text-red-600" title="Falhou">
                     <X className="w-3 h-3" />
                     <span>{failed}</span>
                 </div>
            </div>
        </div>
    );
};

export const columns: ColumnDef<Campaign>[] = [
    {
      accessorKey: "name",
      header: "Campanha",
      cell: ({ row }) => {
          const recipients = row.original.recipients || 0;
          return (
            <div className="flex flex-col">
                <span className="font-semibold text-base">{row.getValue("name")}</span>
                <span className="text-xs text-muted-foreground">text • {recipients} contatos</span>
            </div>
          )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const rawStatus = row.getValue("status") as string;
        const status = rawStatus ? rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase() : '';
        
        const statusMap: Record<string, string> = {
            Sent: 'Concluído',
            Sending: 'Executando',
            Scheduled: 'Agendada',
            Draft: 'Rascunho',
            Failed: 'Falhou',
            Completed: 'Concluído',
            Done: 'Concluído',
            Stopped: 'Parada',
        }

        const label = statusMap[status] || status;
        
        // Styles based on badge design in image
        let badgeClass = "font-medium border-0 px-3 py-1 rounded-full text-xs ";
        let icon = null;

        if (status === 'Sending' || status === 'Sent' || status === 'Completed') {
            badgeClass += "bg-green-500 text-white hover:bg-green-600";
            if (status === 'Sending') icon = <Play className="w-3 h-3 mr-1 fill-current" />;
        } else if (status === 'Draft') {
            badgeClass += "bg-gray-100 text-gray-600 hover:bg-gray-200";
             icon = <span className="mr-1">🕒</span>; // Or specific icon
        } else if (status === 'Scheduled') {
            badgeClass += "bg-blue-100 text-blue-600 hover:bg-blue-200";
        } else if (status === 'Stopped') {
            badgeClass += "bg-red-100 text-red-700 hover:bg-red-200";
        } else {
             badgeClass += "bg-gray-100 text-gray-600";
        }

        return (
            <Badge className={badgeClass}>
                {icon}
                {label}
            </Badge>
        );
      },
    },
    {
        accessorKey: "progress",
        header: "Progresso",
        cell: ({ row }) => <CampaignProgressCell campaign={row.original} />
    },
    {
      accessorKey: "startDate",
      header: "Agendamento",
      cell: ({ row }) => {
        const val = row.getValue("startDate") || row.original.sentDate;
        if (!val) return "-";
        
        let date = new Date(val as string | number | Date);
        if (date.getFullYear() > 3000) {
            const ms = date.getTime();
            date = new Date(ms / 1000);
        }

        return (
            <div className="text-sm">
                {date.toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}
            </div>
        );
      },
    },
    {
        accessorKey: "sentDate",
        header: "Criada em",
        cell: ({ row }) => {
            // Fallback to sentDate if createdAt is not available
            const val = row.original.sentDate;
             if (!val) return "-";
        
            let date = new Date(val as string | number | Date);
            if (date.getFullYear() > 3000) {
                const ms = date.getTime();
                date = new Date(ms / 1000);
            }
            
            return (
                <div className="text-sm text-muted-foreground">
                    {date.toLocaleDateString('pt-BR')}
                </div>
            )
        }
    },
    {
        id: "actions",
        cell: ({ row }) => <CampaignActionsCell campaign={row.original} />,
      },
  ];

export function CampaignsTable() {
    const { user } = useUser();
    const firestore = useFirestore();
    
    const campaignsQuery = useMemoFirebase(() => {
        if (!user) return null;
        // Optimization: Limit to 100 most recent campaigns to save reads
        return query(collection(firestore, 'users', user.uid, 'campaigns'), orderBy('sentDate', 'desc'), limit(100));
    }, [firestore, user]);

    const { data: campaigns, isLoading } = useCollection<Campaign>(campaignsQuery);
    
    const sortedCampaigns = React.useMemo(() => {
        if (!campaigns) return [];
        return [...campaigns].sort((a, b) => {
            const statusA = a.status?.toLowerCase() || '';
            const statusB = b.status?.toLowerCase() || '';
            
            const activeStatuses = ['scheduled', 'sending', 'paused', 'queued'];
            const isActiveA = activeStatuses.includes(statusA);
            const isActiveB = activeStatuses.includes(statusB);

            if (isActiveA && !isActiveB) return -1;
            if (!isActiveA && isActiveB) return 1;

            const getTime = (dateVal: any) => {
                if (!dateVal) return 0;
                if (dateVal.toDate && typeof dateVal.toDate === 'function') {
                    return dateVal.toDate().getTime();
                }
                if (dateVal.seconds) {
                    return dateVal.seconds * 1000;
                }
                return new Date(dateVal).getTime();
            };

            const dateA = getTime(a.sentDate);
            const dateB = getTime(b.sentDate);

            if (isActiveA && isActiveB) {
                 return dateA - dateB;
            }

            return dateB - dateA;
        });
    }, [campaigns]);

    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])

    const table = useReactTable({
      data: sortedCampaigns,
      columns,
      getCoreRowModel: getCoreRowModel(),
      getPaginationRowModel: getPaginationRowModel(),
      onSortingChange: setSorting,
      getSortedRowModel: getSortedRowModel(),
      onColumnFiltersChange: setColumnFilters,
      getFilteredRowModel: getFilteredRowModel(),
      state: {
        sorting,
        columnFilters,
      },
    });

    if (isLoading) {
        return (
          <div className="flex items-center justify-center rounded-md border h-96">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
            <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">Campanhas</h1>
                <p className="text-muted-foreground">
                    {campaigns?.length || 0} campanhas criadas
                </p>
            </div>
            <Button asChild className="bg-green-500 hover:bg-green-600 text-white">
                <Link href="/campaigns/new">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Nova Campanha
                </Link>
            </Button>
        </div>

        <div className="flex items-center py-2 px-3 bg-white rounded-md border shadow-sm">
            <Search className="w-5 h-5 text-muted-foreground mr-2" />
            <Input
              placeholder="Buscar campanhas..."
              value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
              onChange={(event) =>
                  table.getColumn("name")?.setFilterValue(event.target.value)
              }
              className="border-0 focus-visible:ring-0 px-0 h-9"
            />
        </div>

        <div className="rounded-md border bg-white shadow-sm">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-gray-50/50 hover:bg-gray-50/50">
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} className="font-semibold text-gray-600">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-4">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    Nenhuma campanha encontrada.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        
        {/* Pagination - Keeping it simple/hidden if not needed but useful for large lists */}
        {table.getPageCount() > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4">
            <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
            >
                Anterior
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
            >
                Próximo
            </Button>
            </div>
        )}
      </div>
    );
}
