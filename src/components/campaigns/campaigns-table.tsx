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
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';

const CampaignActionsCell = ({ campaign }: { campaign: Campaign }) => {
    const { user } = useUser();
    const { toast } = useToast();
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (!user) return;
        
        // Simple confirm could be improved with a Dialog, but keeping it simple for now as per "click to delete" pattern
        // Or better, let's just trigger it. If the user clicks "Excluir", they probably mean it.
        // But to be safe against accidental clicks in a menu, a small confirm is nice.
        if (!confirm('Tem certeza que deseja excluir esta campanha?')) return;

        setIsDeleting(true);
        const result = await deleteCampaignAction(user.uid, campaign.id);
        setIsDeleting(false);

        if (result.success) {
            toast({ title: "Campanha excluída com sucesso" });
        } else {
            toast({ variant: "destructive", title: "Erro ao excluir", description: result.error });
        }
    };

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
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                    className="text-destructive focus:text-destructive cursor-pointer" 
                    onClick={handleDelete}
                    disabled={isDeleting}
                >
                    {isDeleting ? 'Excluindo...' : 'Excluir Campanha'}
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
        const status = row.getValue("status") as string;
        const count = row.original.count || 0;
        const recipients = row.original.recipients || 0;
        
        const statusMap = {
            Sent: 'Enviando', // Changed to reflect it might be in progress if count < recipients
            Scheduled: 'Agendada',
            Draft: 'Rascunho',
            Failed: 'Falhou',
            Completed: 'Concluído'
        }

        // Determine if completed
        const isCompleted = count >= recipients && recipients > 0;
        const displayStatus = isCompleted ? 'Completed' : status;
        const label = statusMap[displayStatus as keyof typeof statusMap] || status;

        return (
          <div className="flex flex-col gap-1">
              <Badge
                variant={displayStatus === 'Sent' ? 'default' : displayStatus === 'Completed' ? 'default' : displayStatus === 'Scheduled' ? 'secondary' : 'destructive'}
                className={cn(
                  'font-semibold w-fit',
                  displayStatus === 'Sent' && 'bg-blue-500/20 text-blue-700 border-transparent hover:bg-blue-500/30 dark:text-blue-400',
                  displayStatus === 'Completed' && 'bg-green-500/20 text-green-700 border-transparent hover:bg-green-500/30 dark:text-green-400',
                  displayStatus === 'Scheduled' && 'bg-yellow-500/20 text-yellow-700 border-transparent hover:bg-yellow-500/30 dark:text-yellow-400',
                  displayStatus === 'Draft' && 'bg-gray-500/20 text-gray-700 border-transparent hover:bg-gray-500/30 dark:text-gray-400',
                  displayStatus === 'Failed' && 'bg-red-500/20 text-red-700 border-transparent hover:bg-red-500/30 dark:text-red-400',
                )}
              >
                {label}
              </Badge>
              {(displayStatus === 'Sent' || displayStatus === 'Completed') && (
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
      cell: ({ row }) => new Date(row.getValue("sentDate")).toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
    },
    {
      accessorKey: "recipients",
      header: "Destinatários",
    },
    {
        accessorKey: "engagement",
        header: "Engajamento",
        cell: ({ row }) => `${row.getValue("engagement")}%`,
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
      data: campaigns || [],
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
