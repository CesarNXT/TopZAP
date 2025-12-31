'use client';
import React from 'react';
import { PageHeader, PageHeaderHeading, PageHeaderDescription, PageHeaderActions } from '@/components/page-header';
import { ContactsTable } from '@/components/contacts/contacts-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Upload, Trash2, Tag, Users, UserCheck, Ban, RefreshCw } from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { CsvImportWizard } from '@/components/contacts/csv-import-wizard';
import { useToast } from '@/hooks/use-toast';
import type { Contact } from '@/lib/types';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { doc, setDoc, addDoc, collection, writeBatch, getDocs, query, where, getCountFromServer } from 'firebase/firestore';
import { DeleteAllContactsDialog } from '@/components/contacts/delete-all-contacts-dialog';
import { TagManagerDialog } from '@/components/contacts/tag-manager-dialog';

// Função para formatar o número de telefone
const formatPhoneNumberForDB = (phone: string | undefined | null): string => {
    if (!phone) return '';
    
    // 1. Remove tudo que não for dígito
    let cleaned = phone.replace(/\D/g, '');

    // 2. Verifica se é número do Brasil (começa com 55)
    // Se o usuário selecionou DDI 55 no form, o número já vem começando com 55
    // Se veio de importação CSV sem 55, mas parece BR (10 ou 11 dígitos), assumimos 55
    if (!cleaned.startsWith('55')) {
        if (cleaned.length === 10 || cleaned.length === 11) {
             // Assumimos que é Brasil se tiver tamanho típico
            cleaned = '55' + cleaned;
        } else {
            // Se não parece Brasil, retorna como está (outros DDIs)
            return cleaned;
        }
    }
    
    // 3. Enforce 12 digits for Brazil (Remove 9th digit if present)
    // User explicitly requested: "o padrão é 12 digitos... remove esse kralho de 9"
    // This means we must STRIP the 9 to ensure 12 digits.
    if (cleaned.startsWith('55') && cleaned.length === 13) {
        // 55 (2) + DDD (2) + 9 (1) + 8 digits = 13
        // The 9 is at index 4 (0-based: 0,1 are 55; 2,3 are DDD; 4 is 9)
        // We strip the digit at index 4 if it is a '9'.
        if (cleaned[4] === '9') {
             cleaned = cleaned.substring(0, 4) + cleaned.substring(5);
        }
    }
    
    return cleaned;
};


export default function ContactsPage() {
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [isImportWizardOpen, setIsImportWizardOpen] = React.useState(false);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = React.useState(false);
  const [isTagManagerOpen, setIsTagManagerOpen] = React.useState(false);
  const [contactToEdit, setContactToEdit] = React.useState<Contact | null>(null);
  const [filter, setFilter] = React.useState('all');
  const [importCounter, setImportCounter] = React.useState(0);
  const [stats, setStats] = React.useState({ total: 0, active: 0, blocked: 0 });

  const contactsCollectionRef = useMemoFirebase(() => {
    if (!user) return null;
    return collection(firestore, 'users', user.uid, 'contacts');
  }, [firestore, user?.uid]);

  React.useEffect(() => {
    async function fetchStats() {
        if (!contactsCollectionRef) return;
        
        // Check session cache to avoid quota exhaustion (429/resource-exhausted)
        // We only refetch if importCounter changes or cache is expired (> 5 min)
        const cacheKey = `contactStats_${user?.uid}`;
        const cached = sessionStorage.getItem(cacheKey);
        const now = Date.now();
        
        if (cached) {
            try {
                const { timestamp, data, lastImportCounter } = JSON.parse(cached);
                // Use cache if importCounter matches and it's fresh enough (5 mins)
                if (importCounter === lastImportCounter && (now - timestamp < 5 * 60 * 1000)) {
                    setStats(data);
                    return;
                }
            } catch (e) {
                // Invalid cache, ignore
            }
        }

        try {
            // Total
            const totalSnapshot = await getCountFromServer(contactsCollectionRef);
            const total = totalSnapshot.data().count;

            // Active
            const activeQuery = query(contactsCollectionRef, where('segment', '==', 'Active'));
            const activeSnapshot = await getCountFromServer(activeQuery);
            const active = activeSnapshot.data().count;

            // Blocked
            const blockedQuery = query(contactsCollectionRef, where('segment', '==', 'Blocked'));
            const blockedSnapshot = await getCountFromServer(blockedQuery);
            const blocked = blockedSnapshot.data().count;

            const newStats = { total, active, blocked };
            setStats(newStats);
            
            // Save to session storage
            sessionStorage.setItem(cacheKey, JSON.stringify({
                timestamp: now,
                data: newStats,
                lastImportCounter: importCounter
            }));

        } catch (error: any) {
            console.error("Error fetching stats:", error);
            // Handle Quota Exceeded gracefully
            if (error.code === 'resource-exhausted' || error.message?.includes('429')) {
                // If we have cached data (even if stale/wrong importCounter), use it as fallback
                if (cached) {
                     try {
                         const { data } = JSON.parse(cached);
                         setStats(data);
                         // Don't toast error to user to avoid spam, just log warning
                         console.warn("Quota exceeded, using cached stats.");
                         return;
                     } catch(e) {}
                }
                // If really no data, we might just leave 0s or show a silent error
            }
        }
    }

    fetchStats();
  }, [contactsCollectionRef, importCounter, user?.uid]);


  const handleSaveContact = async (contactData: Partial<Contact>) => {
    if (!user) {
        toast({ title: "Erro", description: "Você precisa estar logado.", variant: "destructive" });
        return;
    }

    const formattedPhone = formatPhoneNumberForDB(contactData.phone);
    const dataToSave: any = { ...contactData, phone: formattedPhone };
    
    // Ensure tags are preserved
    if (contactData.tags) {
        dataToSave.tags = contactData.tags;
    }

    try {
        if (dataToSave.id) {
            // Edit existing contact
            const contactRef = doc(firestore, 'users', user.uid, 'contacts', dataToSave.id);
            await setDoc(contactRef, dataToSave, { merge: true });
            toast({ title: "Contato atualizado!", description: `${dataToSave.name} foi atualizado com sucesso.` });
        } else {
            // Add new contact
            const newContact: any = {
                userId: user.uid,
                name: dataToSave.name || '',
                phone: dataToSave.phone || '',
                segment: dataToSave.segment || 'Active',
                tags: dataToSave.tags || [],
                createdAt: new Date(),
            };

            if (dataToSave.birthday) {
                newContact.birthday = dataToSave.birthday;
            }

            await addDoc(collection(firestore, 'users', user.uid, 'contacts'), newContact);
            toast({ title: "Contato criado!", description: `${newContact.name} foi adicionado à sua lista.` });
        }
        setContactToEdit(null);
        setIsFormOpen(false);
        setImportCounter(c => c + 1); // Trigger refetch
    } catch (error: any) {
        console.error("Error saving contact:", error);
        toast({ title: "Erro ao salvar", description: error.message || "Não foi possível salvar o contato.", variant: "destructive" });
    }
  };
  
  const handleBatchImport = async (contacts: { name: string; phone: string }[], tags: string[]) => {
    if (!user) {
        toast({ title: "Erro", description: "Você precisa estar logado.", variant: "destructive" });
        return;
    }
    
    try {
        // 1. Fetch existing contacts to check for duplicates
        // This might be heavy for very large collections, but necessary for deduplication without schema changes.
        const q = query(collection(firestore, 'users', user.uid, 'contacts'));
        const querySnapshot = await getDocs(q);
        const existingPhones = new Set<string>();
        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (data.phone) existingPhones.add(data.phone);
        });

        // 2. Prepare contacts to import (deduplicate against DB)
        const contactsToImport: any[] = [];
        let duplicatesCount = 0;

        // Use a local set for the batch itself to avoid duplicates within the CSV (though Wizard handles this, extra safety)
        const batchPhones = new Set<string>();

        contacts.forEach(contactData => {
            const formattedPhone = formatPhoneNumberForDB(contactData.phone);
            
            // Check if already in DB or already in this batch
            if (existingPhones.has(formattedPhone) || batchPhones.has(formattedPhone)) {
                duplicatesCount++;
                return; 
            }

            batchPhones.add(formattedPhone);
            
            contactsToImport.push({
                userId: user.uid,
                name: contactData.name || '',
                phone: formattedPhone,
                segment: 'Active',
                tags: tags || [],
                createdAt: new Date(),
            });
        });

        if (contactsToImport.length === 0) {
            toast({ 
                title: "Importação cancelada", 
                description: `Todos os ${contacts.length} contatos já existem na sua lista.`,
                variant: "default" 
            });
            setIsImportWizardOpen(false);
            return;
        }

        const chunkSize = 500;
        for (let i = 0; i < contactsToImport.length; i += chunkSize) {
            const chunk = contactsToImport.slice(i, i + chunkSize);
            const batch = writeBatch(firestore);
            
            chunk.forEach((newContact: any) => {
                const contactRef = doc(collection(firestore, 'users', user.uid, 'contacts'));
                batch.set(contactRef, newContact);
            });
            
            await batch.commit();
        }

        toast({
            title: "Contatos importados!",
            description: `${contactsToImport.length} novos contatos adicionados. ${duplicatesCount > 0 ? `${duplicatesCount} duplicados foram ignorados.` : ''}`
        });
        setIsImportWizardOpen(false);
        setImportCounter(c => c + 1); // Trigger refetch
    } catch (error: any) {
        console.error("Error batch importing contacts:", error);
        toast({ title: "Erro na importação", description: error.message || "Não foi possível importar os contatos.", variant: "destructive" });
    }
  };

  const handleDeleteAllContacts = async () => {
    if (!user) {
        toast({ title: "Erro", description: "Você precisa estar logado.", variant: "destructive" });
        return;
    }
    try {
        if (!contactsCollectionRef) return;
        const q = query(contactsCollectionRef);
        const querySnapshot = await getDocs(q);
        
        const docs = querySnapshot.docs;
        const chunkSize = 500;
        
        for (let i = 0; i < docs.length; i += chunkSize) {
            const chunk = docs.slice(i, i + chunkSize);
            const batch = writeBatch(firestore);
            chunk.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }
        
        toast({ title: "Sucesso!", description: "Todos os contatos foram excluídos." });
        setImportCounter(c => c + 1); // Trigger refetch
    } catch (error: any) {
        console.error("Error deleting all contacts:", error);
        toast({ title: "Erro ao excluir", description: error.message || "Não foi possível excluir todos os contatos.", variant: "destructive" });
    } finally {
        setIsDeleteAllOpen(false);
    }
  };

  const handleEditRequest = (contact: Contact) => {
    setContactToEdit(contact);
    setIsFormOpen(true);
  };
  
  const handleNewRequest = () => {
    setContactToEdit(null);
    setIsFormOpen(true);
  }

  const handleDeleteRequest = () => {
    setImportCounter(c => c + 1);
  }

  const handleRefresh = () => {
    setImportCounter(c => c + 1);
    toast({ title: "Atualizando...", description: "A lista de contatos está sendo atualizada." });
  };

  return (
    <div className="container">
      <PageHeader>
        <div className='flex-1'>
          <PageHeaderHeading>Gerenciamento de Contatos</PageHeaderHeading>
          <PageHeaderDescription>
            Organize e agrupe seus contatos para mensagens direcionadas.
          </PageHeaderDescription>
        </div>
        <PageHeaderActions>
            <Button variant="outline" size="icon" onClick={handleRefresh} title="Atualizar Lista">
                <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="destructive" onClick={() => setIsDeleteAllOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir Todos
            </Button>
            <Button variant="outline" onClick={() => setIsTagManagerOpen(true)}>
                <Tag className="mr-2 h-4 w-4" />
                Etiquetas
            </Button>
            <Button variant="outline" onClick={() => setIsImportWizardOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Importar CSV
            </Button>
            <Button onClick={handleNewRequest}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Novo Contato
            </Button>
        </PageHeaderActions>
      </PageHeader>
      
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total de Contatos
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Contatos Ativos
            </CardTitle>
            <UserCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Contatos Bloqueados
            </CardTitle>
            <Ban className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.blocked}</div>
          </CardContent>
        </Card>
      </div>

      <ContactsTable 
        importCounter={importCounter}
        onEditRequest={handleEditRequest} 
        onDelete={handleDeleteRequest}
        filter={filter}
        setFilter={setFilter}
      />

      <ContactForm
        key={contactToEdit?.id || 'new'}
        isOpen={isFormOpen}
        onOpenChange={(isOpen) => {
            if (!isOpen) {
                setContactToEdit(null);
            }
            setIsFormOpen(isOpen);
        }}
        contact={contactToEdit}
        onSave={handleSaveContact}
      />
      
      <CsvImportWizard
        isOpen={isImportWizardOpen}
        onOpenChange={setIsImportWizardOpen}
        onImport={handleBatchImport}
      />

      <DeleteAllContactsDialog
        isOpen={isDeleteAllOpen}
        onOpenChange={setIsDeleteAllOpen}
        onConfirm={handleDeleteAllContacts}
      />

      <TagManagerDialog 
        isOpen={isTagManagerOpen} 
        onOpenChange={setIsTagManagerOpen} 
      />
    </div>
  );
}
