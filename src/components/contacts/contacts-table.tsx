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
  SortingState,
  getSortedRowModel,
  ColumnFiltersState,
  getFilteredRowModel,
  Row,
} from "@tanstack/react-table"
import type { Contact } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '../ui/input';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { MoreHorizontal, Star, Ban, Users, Crown, FilterX, Loader2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useUser, useFirestore } from '@/firebase';
import { collection, deleteDoc, doc, query, orderBy, limit, startAfter, getDocs, QueryDocumentSnapshot, where, QueryConstraint, endAt, startAt } from 'firebase/firestore';

interface ContactsTableProps {
    onEditRequest: (contact: Contact) => void;
    onDelete: () => void;
    importCounter: number;
}

const ActionsCell = ({ row, onEdit, onDelete }: { row: Row<Contact>, onEdit: (contact: Contact) => void, onDelete: (contact: Contact) => void }) => {
    const contact = row.original;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Abrir menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(contact)}>Editar</DropdownMenuItem>
          <DropdownMenuItem>Ver Detalhes</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(contact)}>
            Remover
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
};

const formatPhoneNumber = (phone: string) => {
  const cleaned = ('' + phone).replace(/\D/g, '');
  const match = cleaned.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (match) {
    const ddd = match[2];
    const firstPart = match[3];
    const secondPart = match[4];
    return `(${ddd}) ${firstPart}-${secondPart}`;
  }
  return phone;
};

export function ContactsTable({ onEditRequest, onDelete, importCounter }: ContactsTableProps) {
    const { toast } = useToast();
    const { user } = useUser();
    const firestore = useFirestore();

    const [allContacts, setAllContacts] = React.useState<Contact[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [lastDoc, setLastDoc] = React.useState<QueryDocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = React.useState(true);
    
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [filter, setFilter] = React.useState('all');
    
    const [contactToDelete, setContactToDelete] = React.useState<Contact | null>(null);
    const tableContainerRef = React.useRef<HTMLDivElement>(null);
    const [isFetchingMore, setIsFetchingMore] = React.useState(false);

    const nameFilter = columnFilters.find(f => f.id === 'name')?.value as string || '';

    const resetAndLoad = React.useCallback(() => {
        setAllContacts([]);
        setLastDoc(null);
        setHasMore(true);
        setIsLoading(true);
    }, []);

    React.useEffect(() => {
        resetAndLoad();
    }, [filter, importCounter, nameFilter, user, resetAndLoad]);

    const loadMoreContacts = React.useCallback(async (isSearch = false) => {
        if (!user || (!isSearch && !hasMore) || isFetchingMore) return;
        
        setIsFetchingMore(true);
        if(!isSearch) setIsLoading(true);

        const contactsRef = collection(firestore, 'users', user.uid, 'contacts');
        let queries: QueryConstraint[] = [];

        if (filter !== 'all') {
            const segmentMap = {
                'vip': 'VIP',
                'blocked': 'Inactive',
            };
            queries.push(where('segment', '==', segmentMap[filter as keyof typeof segmentMap]));
        }
        
        if (nameFilter) {
            const endStr = nameFilter.slice(0, -1) + String.fromCharCode(nameFilter.charCodeAt(nameFilter.length - 1) + 1);
            queries.push(where('name', '>=', nameFilter.charAt(0).toUpperCase() + nameFilter.slice(1)));
            queries.push(where('name', '<', endStr.charAt(0).toUpperCase() + endStr.slice(1)));
            queries.push(orderBy('name'));
        } else {
             queries.push(orderBy('name'));
        }

        if (lastDoc && !isSearch) {
            queries.push(startAfter(lastDoc));
        }
        
        queries.push(limit(50));

        const q = query(contactsRef, ...queries);

        try {
            const documentSnapshots = await getDocs(q);
            const newContacts = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact));

            if (isSearch) {
                const lowerCaseSearchContacts = newContacts.filter(c => c.name.toLowerCase().startsWith(nameFilter.toLowerCase()));
                setAllContacts(lowerCaseSearchContacts);
            } else {
                setAllContacts(prev => lastDoc ? [...prev, ...newContacts] : newContacts);
            }

            const lastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1];
            setLastDoc(lastVisible);
            
            if (documentSnapshots.docs.length < 50 || isSearch) {
                setHasMore(false);
            }
        } catch (error) {
            console.error("Error fetching contacts:", error);
            toast({ variant: 'destructive', title: "Erro", description: "Não foi possível carregar os contatos." });
        } finally {
            setIsLoading(false);
            setIsFetchingMore(false);
        }
    }, [user, firestore, lastDoc, hasMore, isFetchingMore, toast, filter, nameFilter]);

    React.useEffect(() => {
        const isSearch = !!nameFilter;
        loadMoreContacts(isSearch);
    }, [filter, importCounter, user, nameFilter]);


     const handleScroll = React.useCallback(() => {
        if (nameFilter) return; // Disable infinite scroll during search
        const container = tableContainerRef.current;
        if (container) {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if (scrollHeight - scrollTop - clientHeight < 100 && !isFetchingMore && hasMore) {
                loadMoreContacts();
            }
        }
    }, [loadMoreContacts, isFetchingMore, hasMore, nameFilter]);
    
    const handleDeleteRequest = (contact: Contact) => {
        setContactToDelete(contact);
    };

    const handleDeleteConfirm = async () => {
        if (contactToDelete && user) {
            try {
                await deleteDoc(doc(firestore, 'users', user.uid, 'contacts', contactToDelete.id));
                setAllContacts(prev => prev.filter(c => c.id !== contactToDelete.id));
                toast({ title: "Contato removido", description: `${contactToDelete.name} foi removido da sua lista.` });
                onDelete();
            } catch (error) {
                console.error("Error deleting contact: ", error);
                toast({ variant: 'destructive', title: "Erro", description: "Não foi possível remover o contato." });
            } finally {
                setContactToDelete(null);
            }
        }
    };
    
    const columns: ColumnDef<Contact>[] = [
      {
        accessorKey: "name",
        header: "Nome",
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback>{contact.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="font-medium">{contact.name}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "phone",
        header: "Telefone",
        cell: ({ row }) => formatPhoneNumber(row.getValue('phone'))
      },
      {
        accessorKey: "segment",
        header: "Grupo",
        cell: ({ row }) => {
          const segment = row.getValue("segment") as string;
          const segmentMap = {
            'VIP': { label: 'Cliente VIP', className: 'border-yellow-500/80 text-yellow-600 bg-yellow-500/10' },
            'New': { label: 'Novo', className: 'border-blue-500/80 text-blue-600 bg-blue-500/10' },
            'Regular': { label: 'Cliente', className: 'border-green-500/80 text-green-600 bg-green-500/10' },
            'Inactive': { label: 'Bloqueado', className: 'border-gray-400 text-gray-500 bg-gray-500/10' },
          }
          const currentSegment = segmentMap[segment as keyof typeof segmentMap] || { label: segment, className: '' };
          return (
              <Badge variant="outline" className={cn('font-medium', currentSegment.className)}>
                {segment === 'VIP' && <Star className='mr-1 h-3 w-3' />}
                {currentSegment.label}
              </Badge>
          )
        },
      },
      {
        accessorKey: "birthday",
        header: "Aniversário",
        cell: ({ row }) => {
            const birthday = row.getValue("birthday") as string;
            return birthday ? new Date(birthday).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', timeZone: 'UTC' }) : '-';
        }
      },
      {
        accessorKey: "createdAt",
        header: "Data de Adição",
        cell: ({ row }) => {
          const date = (row.getValue("createdAt") as any)?.toDate ? (row.getValue("createdAt") as any).toDate() : new Date(row.getValue("createdAt"));
          return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        }
      },
      {
          id: "actions",
          cell: ({ row }) => <ActionsCell row={row} onEdit={onEditRequest} onDelete={handleDeleteRequest} />,
      },
    ];

  const table = useReactTable({
    data: allContacts,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
    },
    manualFiltering: true, // Let our server/useEffect handle filtering
    meta: {
        onEdit: onEditRequest,
        onDelete: handleDeleteRequest,
    }
  });

  return (
    <>
        <div className="flex items-center justify-between py-4">
            <Input
                placeholder="Filtrar por nome..."
                value={nameFilter}
                onChange={(event) => table.getColumn("name")?.setFilterValue(event.target.value)}
                className="max-w-sm"
            />
            <div className="flex items-center gap-2">
                <Button variant={filter === 'all' ? 'secondary' : 'outline'} size="sm" onClick={() => setFilter('all')}><Users className='mr-2 h-4 w-4'/>Todos</Button>
                <Button variant={filter === 'vip' ? 'secondary' : 'outline'} size="sm" onClick={() => setFilter('vip')}><Crown className='mr-2 h-4 w-4'/>Só VIPs</Button>
                <Button variant={filter === 'blocked' ? 'secondary' : 'outline'} size="sm" onClick={() => setFilter('blocked')}><Ban className='mr-2 h-4 w-4'/>Só Bloqueados</Button>
                {filter !== 'all' && (
                     <Button variant="ghost" size="sm" onClick={() => setFilter('all')}><FilterX className='mr-2 h-4 w-4' />Limpar</Button>
                )}
            </div>
        </div>
      <div 
        className="rounded-md border overflow-y-auto relative" 
        style={{ height: 'calc(100vh - 350px)' }}
        ref={tableContainerRef}
        onScroll={handleScroll}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
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
            {isLoading && allContacts.length === 0 ? (
                 <TableRow>
                    <TableCell colSpan={columns.length} className="h-96 text-center">
                        <div className="flex justify-center items-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    </TableCell>
                </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
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
                  Nenhum contato encontrado.
                </TableCell>
              </TableRow>
            )}
            {isFetchingMore && !nameFilter &&(
                <TableRow>
                    <TableCell colSpan={columns.length} className="text-center">
                        <div className="flex justify-center items-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    </TableCell>
                </TableRow>
            )}
             {!hasMore && allContacts.length > 0 && !nameFilter && (
                <TableRow>
                    <TableCell colSpan={columns.length} className="text-center text-muted-foreground p-4">
                        Fim da lista.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!contactToDelete} onOpenChange={() => setContactToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita. Isso removerá permanentemente o contato
                    "{contactToDelete?.name}" da sua lista.
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteConfirm}>Continuar</AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
