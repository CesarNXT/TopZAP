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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { Contact, Tag } from '@/lib/types';
import { getTags } from '@/app/actions/tag-actions';
import { standardizeContactStatuses } from '@/app/actions/migration-actions';
import { Button } from '@/components/ui/button';
import { Input } from '../ui/input';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { MoreHorizontal, Star, Ban, Users, Crown, FilterX, Loader2, Trash2, UserPlus, User, Search, Tag as TagIcon, RefreshCw } from 'lucide-react';
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
    const userId = user?.uid;
    const firestore = useFirestore();

    const [contacts, setContacts] = React.useState<Contact[]>([]);
    const [tags, setTags] = React.useState<Tag[]>([]);

    React.useEffect(() => {
        if (userId) {
            getTags(userId).then(res => {
                if (res.success && res.data) {
                    setTags(res.data);
                }
            });
        }
    }, [userId, importCounter]);

    const [isLoading, setIsLoading] = React.useState(true);
    const [isMigrating, setIsMigrating] = React.useState(false);

    // Auto-run migration on mount to fix legacy statuses
    React.useEffect(() => {
        if (userId) {
            standardizeContactStatuses(userId).then((res) => {
                if (res.success && res.count > 0) {
                    loadContacts();
                }
            });
        }
    }, [userId]);

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

    const handleMigration = async () => {
        if (!user?.uid) return;
        setIsMigrating(true);
        try {
            const result = await standardizeContactStatuses(user.uid);
            if (result.success) {
                if ((result.count ?? 0) > 0) {
                     toast({ title: 'Sucesso', description: `${result.count} contatos padronizados.` });
                     loadContacts();
                } else {
                     toast({ title: 'Tudo certo', description: 'Todos os contatos já estão padronizados.' });
                }
            } else {
                toast({ title: 'Erro', description: result.error, variant: 'destructive' });
            }
        } catch (e) {
            toast({ title: 'Erro', description: 'Falha na migração.', variant: 'destructive' });
        } finally {
            setIsMigrating(false);
        }
    };
    
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
        accessorKey: "lastMessageAt",
        header: "Última Interação",
        cell: ({ row }) => {
            const date = row.getValue('lastMessageAt') as string;
            if (!date) return <span className="text-muted-foreground text-xs">-</span>;
            const d = new Date(date);
            if (isNaN(d.getTime())) return <span className="text-muted-foreground text-xs">-</span>;
            return <span className="text-xs text-muted-foreground">{d.toLocaleString()}</span>;
        }
      },
      {
        accessorKey: "segment",
        header: "Status",
        cell: ({ row }) => {
          const segment = row.getValue("segment") as string;
          const isBlocked = segment === 'Blocked';
          return (
              <Badge variant="outline" className={cn('font-medium', 
                isBlocked 
                  ? 'border-red-500/80 text-red-600 bg-red-500/10' 
                  : 'border-green-500/80 text-green-600 bg-green-500/10'
              )}>
                {isBlocked ? 'Bloqueado' : 'Ativo'}
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
        accessorKey: "tags",
        header: "Etiquetas",
        cell: ({ row }) => {
            const contactTags = row.original.tags || [];
            if (contactTags.length === 0) return <span className="text-muted-foreground text-xs">-</span>;
            
            return (
                <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {contactTags.map(tagId => {
                        const tag = tags.find(t => t.id === tagId);
                        
                        if (!tag) {
                            return (
                                <Badge 
                                    key={tagId} 
                                    variant="outline" 
                                    className="text-[10px] px-1 py-0 h-5 gap-1 border-dashed border-gray-300 text-gray-400"
                                    title="Etiqueta excluída"
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                                    Excluída
                                </Badge>
                            );
                        }

                        return (
                            <Badge 
                                key={tagId} 
                                variant="outline" 
                                className="text-[10px] px-1 py-0 h-5 gap-1 border-0"
                                style={{ 
                                    backgroundColor: tag.color + '20', 
                                    color: tag.color 
                                }}
                            >
                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                                {tag.name}
                            </Badge>
                        );
                    })}
                </div>
            );
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
      if (!userId) {
          console.log('[Frontend] No userId found, skipping loadContacts.');
          return;
      }
      
      console.log(`[Frontend] Loading contacts for UserID: ${userId}`);

      // Check cache first
      if (pagesCache[page]) {
          setContacts(pagesCache[page]);
          setHasNextPage(pagesCache[page].length >= PAGE_SIZE);
          return;
      }

      setIsLoading(true);

      const contactsRef = collection(firestore, 'users', userId, 'contacts');
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
                 const BATCH_SIZE = 1000; // Optimized batch size
                 const MAX_DOCS = 2000; // Limit search scope to save costs as per user request

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

            // Apply tag filter in memory if active
            if (filter !== 'all') {
                if (filter === 'blocked') {
                    filtered = filtered.filter(c => c.segment === 'Blocked');
                } else if (filter === 'active') {
                     filtered = filtered.filter(c => c.segment === 'Active');
                } else {
                     // Filter by tag ID
                     filtered = filtered.filter(c => c.tags && c.tags.includes(filter));
                }
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
          // If searchTerm is present, we prioritize name search logic and do client-side filtering
          // to avoid composite index requirement.
            if (!searchTerm) {
                if (filter === 'blocked') {
                    queries.push(where('segment', '==', 'Blocked'));
                } else if (filter === 'active') {
                     queries.push(where('segment', '==', 'Active'));
                } else {
                     // Filter by tag ID using array-contains
                     queries.push(where('tags', 'array-contains', filter));
                }
            }
      }
      
      // Standard ordering
      if (filter === 'all') {
          queries.push(orderBy('name', 'asc'));
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
              if (filter === 'blocked') {
                  newContacts = newContacts.filter(c => c.segment === 'Blocked');
              } else if (filter === 'active') {
                   newContacts = newContacts.filter(c => c.segment === 'Active');
              } else {
                   newContacts = newContacts.filter(c => c.tags && c.tags.includes(filter));
              }
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
  }, [userId, firestore, page, filter, searchTerm, pageCursors, toast, pagesCache]);
  
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
                        <SelectValue placeholder="Filtrar por..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">
                            <div className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                <span>Todos</span>
                            </div>
                        </SelectItem>
                        <SelectItem value="active">
                             <div className="flex items-center gap-2 text-green-600">
                                 <User className="h-4 w-4" />
                                 <span>Ativos</span>
                             </div>
                        </SelectItem>
                        <SelectItem value="blocked">
                            <div className="flex items-center gap-2 text-red-600">
                                <Ban className="h-4 w-4" />
                                <span>Bloqueados</span>
                            </div>
                        </SelectItem>
                        {tags.length > 0 && (
                            <>
                                <DropdownMenuSeparator />
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                    Etiquetas
                                </div>
                                {tags.map(tag => (
                                    <SelectItem key={tag.id} value={tag.id}>
                                        <div className="flex items-center gap-2">
                                            <div 
                                                className="w-3 h-3 rounded-full" 
                                                style={{ backgroundColor: tag.color }} 
                                            />
                                            <span>{tag.name}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </>
                        )}
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
        className="hidden md:block rounded-md border overflow-y-auto relative" 
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
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span>Nenhum contato encontrado.</span>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => loadContacts()}
                      className="mt-2"
                    >
                      <RefreshCw className="h-3 w-3 mr-2" />
                      Tentar Recarregar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {isLoading ? (
            <div className="flex justify-center items-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        ) : table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
                <Card key={row.id} className="bg-white shadow-sm" onClick={() => onEditRequest(row.original)}>
                    <CardHeader className="pb-2 pt-4 px-4">
                         <div className="flex justify-between items-start">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-12 w-12">
                                    <AvatarFallback className="text-lg">{row.original.name.charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <CardTitle className="text-lg font-semibold">{row.original.name}</CardTitle>
                                    <p className="text-base text-muted-foreground">{formatPhoneNumber(row.original.phone)}</p>
                                </div>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                                <ActionsCell row={row} onEdit={onEditRequest} onDelete={handleDeleteRequest} />
                            </div>
                         </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pb-4 px-4">
                        <div className="flex items-center justify-between border-t pt-3">
                            <span className="text-sm font-medium text-muted-foreground">Status</span>
                            {flexRender(columns[4].cell, { row } as any)}
                        </div>
                        
                         <div className="space-y-2 border-t pt-3">
                            <span className="text-sm font-medium text-muted-foreground block">Etiquetas</span>
                            <div className="flex flex-wrap gap-2">
                                {flexRender(columns[7].cell, { row } as any)}
                            </div>
                        </div>

                         <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                            <span>Adicionado em</span>
                            {flexRender(columns[6].cell, { row } as any)}
                        </div>
                    </CardContent>
                </Card>
            ))
        ) : (
            <div className="text-center py-12 bg-white rounded-lg border border-dashed text-muted-foreground">
                <div className="flex flex-col items-center justify-center gap-2">
                    <span>Nenhum contato encontrado.</span>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => loadContacts()}
                      className="mt-2"
                    >
                      <RefreshCw className="h-3 w-3 mr-2" />
                      Tentar Recarregar
                    </Button>
                  </div>
            </div>
        )}
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
