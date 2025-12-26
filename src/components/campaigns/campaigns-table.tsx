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
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { MoreHorizontal, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCollection } from '@/firebase';
import { useUser } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { collection, query, orderBy } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { deleteCampaignAction } from '@/app/actions/campaign-actions';
import { controlCampaign } from '@/app/actions/whatsapp-actions';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { Play, Pause, Trash2 } from 'lucide-react';

const CampaignActionsCell = ({ campaign }: { campaign: Campaign }) => {
    const { user } = useUser();
    const { toast } = useToast();
    const [isDeleting, setIsDeleting] = useState(false);
    const [isControlling, setIsControlling] = useState(false);

    const handleDelete = async () => {
        if (!user) return;
        
        if (!confirm('Tem certeza que deseja excluir esta campanha? O histórico local será apagado e os envios pendentes cancelados.')) return;

        setIsDeleting(true);
        // deleteCampaignAction calls deleteCampaignFromProvider internally
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
    const canPause = status === 'scheduled' || status === 'sending' || status === 'sent'; // 'Sent' in UI might mean 'Sending' depending on mapping
    const canResume = status === 'paused';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Abrir menu</span>
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                    <Link href={`/campaigns/${campaign.id}`}>Ver Relatório</Link>
                </DropdownMenuItem>
                
                {canPause && (
                    <DropdownMenuItem onClick={() => handleControl('stop')} disabled={isControlling}>
                        <Pause className="mr-2 h-4 w-4" />
                        <span>Pausar Envio</span>
                    </DropdownMenuItem>
                )}
                
                {canResume && (
                    <DropdownMenuItem onClick={() => handleControl('continue')} disabled={isControlling}>
                        <Play className="mr-2 h-4 w-4" />
                        <span>Retomar Envio</span>
                    </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem 
                    className="text-destructive focus:text-destructive cursor-pointer" 
                    onClick={handleDelete}
                    disabled={isDeleting}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>{isDeleting ? 'Excluindo...' : 'Excluir Campanha'}</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export const columns: ColumnDef<Campaign>[] = [
    {
      accessorKey: "name",
      header: "Nome da Campanha",
      cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const rawStatus = row.getValue("status") as string;
        // Normalize status to Capitalized to match map and logic
        const status = rawStatus ? rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase() : '';
        
        const stats = row.original.stats;
        // Calculate count from stats if available (delivered + read + failed + sent)
        // Including 'sent' as a processed state because it means the provider accepted the message
        // This ensures the table reflects the actual progress verified in the details page
        const countFromStats = stats ? ((stats.delivered || 0) + (stats.read || 0) + (stats.failed || 0) + (stats.sent || 0)) : 0;
        const hasStats = stats && ((stats.delivered || 0) > 0 || (stats.read || 0) > 0 || (stats.failed || 0) > 0 || (stats.sent || 0) > 0);
        
        const count = hasStats ? countFromStats : (row.original.count || 0);
        const recipients = row.original.recipients || 0;
        
        const statusMap = {
            Sent: 'Enviado',
            Sending: 'Enviando',
            Scheduled: 'Agendada',
            Draft: 'Rascunho',
            Failed: 'Falhou',
            Completed: 'Concluído',
            Done: 'Concluído',
            Paused: 'Pausada',
        }

        // Determine if completed
        // Only mark as completed if it's not Scheduled or Paused
        // We consider it completed if count >= recipients (meaning all messages were processed)
        const isCompleted = (count >= recipients && recipients > 0 && status !== 'Scheduled' && status !== 'Paused') || status === 'Done';
        const displayStatus = isCompleted ? 'Completed' : status;
        const label = statusMap[displayStatus as keyof typeof statusMap] || displayStatus;

        return (
          <div className="flex flex-col gap-1">
              <Badge
                variant={(displayStatus === 'Sent' || displayStatus === 'Sending') ? 'default' : displayStatus === 'Completed' ? 'default' : displayStatus === 'Scheduled' ? 'secondary' : 'destructive'}
                className={cn(
                  'font-semibold w-fit',
                  (displayStatus === 'Sent' || displayStatus === 'Sending') && 'bg-blue-500/20 text-blue-700 border-transparent hover:bg-blue-500/30 dark:text-blue-400',
                  displayStatus === 'Completed' && 'bg-green-500/20 text-green-700 border-transparent hover:bg-green-500/30 dark:text-green-400',
                  displayStatus === 'Scheduled' && 'bg-yellow-500/20 text-yellow-700 border-transparent hover:bg-yellow-500/30 dark:text-yellow-400',
                  displayStatus === 'Paused' && 'bg-orange-500/20 text-orange-700 border-transparent hover:bg-orange-500/30 dark:text-orange-400',
                  displayStatus === 'Draft' && 'bg-gray-500/20 text-gray-700 border-transparent hover:bg-gray-500/30 dark:text-gray-400',
                  displayStatus === 'Failed' && 'bg-red-500/20 text-red-700 border-transparent hover:bg-red-500/30 dark:text-red-400',
                )}
              >
                {label}
              </Badge>
              {((displayStatus === 'Sent' || displayStatus === 'Sending') || displayStatus === 'Completed') && (
                  <span className="text-xs text-muted-foreground font-medium">
                      {count} de {recipients}
                  </span>
              )}
          </div>
        );
      },
    },
    {
      accessorKey: "sentDate",
      header: "Data de Envio",
      cell: ({ row }) => {
        const val = row.getValue("sentDate");
        if (!val) return "-";
        
        let date = new Date(val as string | number | Date);
        
        // Fix for campaigns stored with microsecond timestamps (incorrectly multiplied by 1000)
        // If year is way in the future (e.g., > 3000), assume it was stored as microseconds
        if (date.getFullYear() > 3000) {
            const ms = date.getTime();
            date = new Date(ms / 1000);
        }

        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
      },
    },
    {
      accessorKey: "recipients",
      header: "Destinatários",
    },
    {
        accessorKey: "engagement",
        header: "Engajamento",
        cell: ({ row }) => {
            const engagementVal = (row.getValue("engagement") as number) || 0;
            const readVal = row.original.stats?.read || 0;
            // Consider "Read" as engagement too, using max to approximate unique engaged users
            // since most repliers also read the message.
            const engagementCount = Math.max(engagementVal, readVal);
            
            const recipients = row.original.recipients || 1; // Avoid division by zero
            const percentage = Math.min(100, Math.round((engagementCount / recipients) * 100));
            return `${percentage}%`;
        },
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
        return query(collection(firestore, 'users', user.uid, 'campaigns'), orderBy('sentDate', 'desc'));
    }, [firestore, user]);

    const { data: campaigns, isLoading } = useCollection<Campaign>(campaignsQuery);
    
    const sortedCampaigns = React.useMemo(() => {
        if (!campaigns) return [];
        
        return [...campaigns].sort((a, b) => {
            // Normalize statuses
            const statusA = a.status?.toLowerCase() || '';
            const statusB = b.status?.toLowerCase() || '';
            
            // Define active statuses that should be on top
            // Scheduled, Sending, Paused are "active" or "pending"
            const activeStatuses = ['scheduled', 'sending', 'paused', 'queued'];
            const isActiveA = activeStatuses.includes(statusA);
            const isActiveB = activeStatuses.includes(statusB);

            // Priority 1: Active campaigns on top
            if (isActiveA && !isActiveB) return -1;
            if (!isActiveA && isActiveB) return 1;

            // Helper to get time safely from string, number, Date, or Timestamp
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

            // Priority 2: Within Active (Scheduled/Sending), Sort by Date ASC (Earliest First)
            // Example: Sending (Now) -> Scheduled (Tomorrow) -> Scheduled (Next Week)
            if (isActiveA && isActiveB) {
                 return dateA - dateB;
            }

            // Priority 3: Within Finished (Completed/Sent/Failed), Sort by Date DESC (Latest First)
            // Example: Completed (Today) -> Completed (Yesterday)
            return dateB - dateA;
        });
    }, [campaigns]);

    const [highlightedRow, setHighlightedRow] = React.useState<string | null>(null);
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])

    React.useEffect(() => {
      try {
          const newId = sessionStorage.getItem('newlyCreatedCampaignId');
          if (newId) {
              setHighlightedRow(newId);
              sessionStorage.removeItem('newlyCreatedCampaignId');

              const timer = setTimeout(() => {
                  setHighlightedRow(null);
              }, 3000);

              return () => clearTimeout(timer);
          }
      } catch (error) {
          console.error("Failed to access sessionStorage", error);
      }
    }, []);

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
      <div>
          <div className="flex items-center py-4">
              <Input
              placeholder="Filtrar por nome da campanha..."
              value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
              onChange={(event) =>
                  table.getColumn("name")?.setFilterValue(event.target.value)
              }
              className="max-w-sm"
              />
          </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id}>
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
                    className={cn(row.original.id === highlightedRow && 'animate-pulse-bg')}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
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
      </div>
    );
}
