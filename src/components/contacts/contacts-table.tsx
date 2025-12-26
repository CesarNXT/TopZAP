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
import { MoreHorizontal, Star, Ban, Users, Crown, FilterX, Loader2, Trash2, UserPlus, User, Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useUser, useFirestore } from '@/firebase';
import { collection, deleteDoc, doc, query, orderBy, limit, startAfter, getDocs, QueryDocumentSnapshot, where, QueryConstraint, writeBatch, documentId } from 'firebase/firestore';
import { Checkbox } from '@/components/ui/checkbox';

interface ContactsTableProps {
    onEditRequest: (contact: Contact) => void;
    onDelete: () => void;
    importCounter: number;
    filter: string;
    setFilter: (filter: string) => void;
}

const ActionsCell = ({ row, onEdit, onDelete }: { row: Row<Contact>, onEdit: (contact: Contact) => void, onDelete: (contact: Contact) => void }) => {
    const contact = row.original;
    return (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); onDelete(contact); }}>
            <Trash2 className="h-4 w-4" />
        </Button>
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

export function ContactsTable({ onEditRequest, onDelete, importCounter, filter, setFilter }: ContactsTableProps) {
    const { toast } = useToast();
    const { user } = useUser();
    const firestore = useFirestore();

    const [contacts, setContacts] = React.useState<Contact[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [page, setPage] = React.useState(0);
    const [pageCursors, setPageCursors] = React.useState<QueryDocumentSnapshot[]>([]);
    const [pagesCache, setPagesCache] = React.useState<Record<number, Contact[]>>({});
    const [hasNextPage, setHasNextPage] = React.useState(false);
    const [allContactsCache, setAllContactsCache] = React.useState<Contact[] | null>(null);
    const [searchTerm, setSearchTerm] = React.useState("");
    
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    
    const [contactToDelete, setContactToDelete] = React.useState<Contact | null>(null);
    const [rowSelection, setRowSelection] = React.useState({});
    const [isDeletingMultiple, setIsDeletingMultiple] = React.useState(false);
    
    const PAGE_SIZE = 50;
    
    const handleDeleteRequest = (contact: Contact) => {
      setContactToDelete(contact);
    };

    const handleBulkDelete = async () => {
        if (!user || Object.keys(rowSelection).length === 0) return;
        
        if (!confirm(`Tem certeza que deseja excluir ${Object.keys(rowSelection).length} contatos?`)) return;

        setIsDeletingMultiple(true);
        try {
            const selectedIndices = Object.keys(rowSelection).map(Number);
            
            const selectedRowIds = Object.keys(rowSelection).filter(k => rowSelection[k as keyof typeof rowSelection]);
            const contactsToDelete = selectedRowIds.map(index => contacts[parseInt(index)]).filter(Boolean);
            
            const chunkSize = 500;
            for (let i = 0; i < contactsToDelete.length; i += chunkSize) {
                const chunk = contactsToDelete.slice(i, i + chunkSize);
                const batch = writeBatch(firestore);
                chunk.forEach(contact => {
                    const docRef = doc(firestore, 'users', user.uid, 'contacts', contact.id);
                    batch.delete(docRef);
                });
                await batch.commit();
            }

            // Remove from local state
            const deletedIds = new Set(contactsToDelete.map(c => c.id));
            setContacts(prev => prev.filter(c => !deletedIds.has(c.id)));
            // Also update allContactsCache if it exists
            if (allContactsCache) {
                setAllContactsCache(prev => prev ? prev.filter(c => !deletedIds.has(c.id)) : null);
            }

            setRowSelection({});
            toast({ title: "Contatos removidos", description: `${contactsToDelete.length} contatos foram removidos.` });
            onDelete();
        } catch (error) {
            console.error("Error deleting contacts:", error);
            toast({ variant: 'destructive', title: "Erro", description: "Falha ao excluir contatos selecionados." });
        } finally {
            setIsDeletingMultiple(false);
        }
    };


    const columns: ColumnDef<Contact>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
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
        header: "Status",
        cell: ({ row }) => {
          const segment = row.getValue("segment") as string;
          const segmentMap = {
            'New': { label: 'Novo', className: 'border-blue-500/80 text-blue-600 bg-blue-500/10' },
            'Regular': { label: 'Cliente', className: 'border-green-500/80 text-green-600 bg-green-500/10' },
            'Inactive': { label: 'Bloqueado', className: 'border-gray-400 text-gray-500 bg-gray-500/10' },
          }
          const currentSegment = segmentMap[segment as keyof typeof segmentMap] || { label: segment, className: '' };
          return (
              <Badge variant="outline" className={cn('font-medium', currentSegment.className)}>
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
    data: contacts,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
    meta: {
        onEdit: onEditRequest,
        onDelete: handleDeleteRequest,
    }
  });

  const loadContacts = React.useCallback(async () => {
      if (!user) return;
      
      // Check cache first
      if (pagesCache[page]) {
          setContacts(pagesCache[page]);
          setHasNextPage(pagesCache[page].length >= PAGE_SIZE);
          return;
      }

      setIsLoading(true);

      const contactsRef = collection(firestore, 'users', user.uid, 'contacts');
      let queries: QueryConstraint[] = [];

      // Multi-query search implementation replaced by Client-Side Search for "Contains" support
      if (searchTerm) {
        setIsLoading(true);
        try {
            let searchSource = allContactsCache;

            // If we haven't fetched all contacts yet, or cache is empty, do it now
            if (!searchSource || searchSource.length === 0) {
                 // Toast removed as per user request

                 // Fetch all contacts in batches to avoid Firebase 10k limit and ensure we find the contact
                 let allDocs: any[] = [];
                 let lastDoc = null;
                 let hasMore = true;
                 const BATCH_SIZE = 5000; // Safe batch size under 10k limit
                 const MAX_DOCS = 100000; // Increased limit for larger lists

                 while (hasMore && allDocs.length < MAX_DOCS) {
                     // Explicitly order by documentId for stable pagination
                     let constraints: QueryConstraint[] = [orderBy(documentId()), limit(BATCH_SIZE)];
                     
                     if (lastDoc) {
                         constraints.push(startAfter(lastDoc));
                     }
                     
                     const q = query(contactsRef, ...constraints);
                     
                     const snapshot = await getDocs(q);
                     
                     if (snapshot.empty) {
                         hasMore = false;
                     } else {
                         allDocs = [...allDocs, ...snapshot.docs];
                         lastDoc = snapshot.docs[snapshot.docs.length - 1];
                         
                         // If we got fewer than requested, we reached the end
                         if (snapshot.docs.length < BATCH_SIZE) {
                             hasMore = false;
                         }
                     }
                 }

                 searchSource = allDocs.map(doc => ({ id: doc.id, ...doc.data() } as Contact));
                 
                 // Sort by name in memory
                 searchSource.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                 
                 setAllContactsCache(searchSource);
                 // Toast removed as per user request
            }

            // Perform client-side filtering
            const lowerFilter = searchTerm.toLowerCase();
            const rawFilter = searchTerm.replace(/\D/g, '');
            
            let filtered = searchSource.filter(contact => {
                const contactName = (contact.name || '').toLowerCase();
                const nameMatch = contactName.includes(lowerFilter);
                
                // For phone search:
                // 1. Check if the raw input (only digits) is contained in the raw phone number (only digits)
                // 2. OR check if the user typed text matches the formatted phone
                const phoneStr = String(contact.phone || '');
                const contactRawPhone = phoneStr.replace(/\D/g, '');
                
                const phoneMatch = rawFilter 
                    ? contactRawPhone.includes(rawFilter) 
                    : phoneStr.includes(searchTerm); // Fallback for formatted input like (31)

                return nameMatch || phoneMatch;
            });

            // Apply segment filter in memory if active
            if (filter !== 'all') {
                const segmentMap: Record<string, string> = {
                    'blocked': 'Inactive',
                    'inactive': 'Inactive',
                    'new': 'New',
                    'regular': 'Regular'
                };
                const mappedSegment = segmentMap[filter] || filter;
                filtered = filtered.filter(c => c.segment === mappedSegment);
            }

            setContacts(filtered);
            setHasNextPage(false); // Pagination disabled in search mode
            setPagesCache({}); 

            // Toast to debug/confirm search scope if it's the first time searching
            if (!allContactsCache) {
                 console.log(`Loaded ${searchSource.length} contacts for search.`);
            } 

        } catch (error: any) {
            console.error("Search error:", error);
            toast({ variant: 'destructive', title: "Erro na busca", description: "Falha ao buscar contatos." });
        } finally {
            setIsLoading(false);
        }
        return; // Exit early for search mode
      }

      // Standard Load (No Search Filter)
      if (filter !== 'all') {
          // If searchTerm is present, we prioritize name search logic and do client-side filtering for segment
          // to avoid composite index requirement.
          if (!searchTerm) {
              const segmentMap: Record<string, string> = {
                  'blocked': 'Inactive',
                  'inactive': 'Inactive',
                  'new': 'New',
                  'regular': 'Regular'
              };
              const mappedSegment = segmentMap[filter] || filter; 
              queries.push(where('segment', '==', mappedSegment));
          }
      }
      
      // Standard ordering
      if (filter === 'all') {
          queries.push(orderBy('name'));
      }
      
      // Pagination logic
      if (page > 0) {
          const cursor = pageCursors[page - 1];
          if (cursor) {
              queries.push(startAfter(cursor));
          }
      }
      
      queries.push(limit(PAGE_SIZE));

      const q = query(contactsRef, ...queries);

      try {
          const documentSnapshots = await getDocs(q);
          let newContacts = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact));

          // If we have both searchTerm and segment filter, we did NOT apply segment filter in query
          // So we must apply it in memory here
          if (filter !== 'all' && searchTerm) {
              const segmentMap: Record<string, string> = {
                  'blocked': 'Inactive',
                  'inactive': 'Inactive',
                  'new': 'New',
                  'regular': 'Regular'
              };
              const mappedSegment = segmentMap[filter] || filter;
              newContacts = newContacts.filter(c => c.segment === mappedSegment);
          }

          setContacts(newContacts);
          setPagesCache(prev => ({...prev, [page]: newContacts}));
          
          // Check if there are more results
          setHasNextPage(documentSnapshots.docs.length >= PAGE_SIZE);

          // Update cursors if we loaded a full page
          if (documentSnapshots.docs.length > 0) {
             const lastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1];
             setPageCursors(prev => {
                 const newCursors = [...prev];
                 newCursors[page] = lastVisible;
                 return newCursors;
             });
          }

      } catch (error: any) {
            console.error("Error fetching contacts:", error);
            if (error?.message?.includes('offline') || error?.code === 'unavailable') {
                 toast({ variant: 'warning', title: "Conexão Instável", description: "Verifique sua internet. Tentando reconectar..." });
            } else {
                 toast({ variant: 'destructive', title: "Erro", description: "Não foi possível carregar os contatos." });
            }
        } finally {
          setIsLoading(false);
      }
  }, [user, firestore, page, filter, searchTerm, pageCursors, toast, pagesCache]);
  
  // Reset pagination when filters change
  React.useEffect(() => {
      setPage(0);
      setPageCursors([]);
      setContacts([]);
      setPagesCache({});
      // Note: We intentionally do NOT clear allContactsCache here to reuse it during search typing
  }, [filter, searchTerm, importCounter]);

  // Clear allContactsCache only when explicit refresh actions happen
  React.useEffect(() => {
      setAllContactsCache(null);
  }, [importCounter]);

  // Load contacts when page or filters change
  React.useEffect(() => {
    // Debounce load if searchTerm is present to avoid rapid fire queries
    const timeoutId = setTimeout(() => {
        loadContacts();
    }, searchTerm ? 300 : 0);

    return () => clearTimeout(timeoutId);
  }, [loadContacts]);

  const handleDeleteConfirm = async () => {
      if (contactToDelete && user) {
          try {
              await deleteDoc(doc(firestore, 'users', user.uid, 'contacts', contactToDelete.id));
              setContacts(prev => prev.filter(c => c.id !== contactToDelete.id));
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

  return (
    <>
        <div className="flex items-center justify-between py-4 gap-4">
            <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Filtrar por nome ou telefone..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-9"
                />
            </div>
            
            <div className="flex items-center gap-2">
                <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">
                            <div className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                <span>Todos</span>
                            </div>
                        </SelectItem>
                        <SelectItem value="new">
                            <div className="flex items-center gap-2 text-blue-600">
                                <UserPlus className="h-4 w-4" />
                                <span>Novos</span>
                            </div>
                        </SelectItem>
                        <SelectItem value="regular">
                            <div className="flex items-center gap-2 text-green-600">
                                <User className="h-4 w-4" />
                                <span>Clientes</span>
                            </div>
                        </SelectItem>
                        <SelectItem value="inactive">
                            <div className="flex items-center gap-2 text-gray-600">
                                <Ban className="h-4 w-4" />
                                <span>Bloqueados</span>
                            </div>
                        </SelectItem>
                    </SelectContent>
                </Select>

                {filter !== 'all' && (
                     <Button variant="ghost" size="icon" onClick={() => setFilter('all')} title="Limpar Filtro">
                        <FilterX className='h-4 w-4' />
                     </Button>
                )}
            </div>
        </div>
      <div 
        className="rounded-md border overflow-y-auto relative" 
        style={{ height: 'calc(100vh - 400px)' }}
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
            {isLoading ? (
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
                  onClick={() => onEditRequest(row.original)}
                  className="cursor-pointer hover:bg-muted/50"
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
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || isLoading}
        >
          Anterior
        </Button>
        <div className="text-sm text-muted-foreground">
            Página {page + 1}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNextPage || isLoading}
        >
          Próximo
        </Button>
      </div>

      <AlertDialog open={!!contactToDelete} onOpenChange={() => setContactToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita. Isso removerá permanentemente o contato
                    &quot;{contactToDelete?.name}&quot; da sua lista.
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
