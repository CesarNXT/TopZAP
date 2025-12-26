'use client';
import React from 'react';
import { PageHeader, PageHeaderHeading, PageHeaderDescription, PageHeaderActions } from '@/components/page-header';
import { ContactsTable } from '@/components/contacts/contacts-table';
import { Button } from '@/components/ui/button';
import { PlusCircle, Upload, Trash2 } from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { CsvImportWizard } from '@/components/contacts/csv-import-wizard';
import { useToast } from '@/hooks/use-toast';
import type { Contact } from '@/lib/types';
import { useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { doc, setDoc, addDoc, collection, writeBatch, getDocs, query } from 'firebase/firestore';
import { DeleteAllContactsDialog } from '@/components/contacts/delete-all-contacts-dialog';

// Função para formatar o número de telefone para o padrão de 12 dígitos (55+DDD+XXXXYYYY)
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
    
    // 3. Se for Brasil (começa com 55), aplica a regra de remover o 9º dígito extra
    // Formato com 9º dígito: 55 (DDD: 2 dígitos) (9º: 1 dígito) (Número: 8 dígitos) -> Total 13 dígitos
    if (cleaned.startsWith('55') && cleaned.length === 13) {
        const ddd = cleaned.substring(2, 4);
        const numberPart = cleaned.substring(4); // Pega a parte do número
        
        // Verifica se o nono dígito é realmente 9
        if (numberPart.startsWith('9')) {
             // Remove o primeiro '9' da parte do número para ficar com 8 dígitos
             // Resultado: 55 + DDD + 8 dígitos = 12 dígitos
             cleaned = '55' + ddd + numberPart.substring(1);
        }
    }
    
    // O número final deve ter 12 dígitos para BR ou o tamanho original para outros países
    return cleaned;
};


export default function ContactsPage() {
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [isImportWizardOpen, setIsImportWizardOpen] = React.useState(false);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = React.useState(false);
  const [contactToEdit, setContactToEdit] = React.useState<Contact | null>(null);
  const [filter, setFilter] = React.useState('all');
  const [importCounter, setImportCounter] = React.useState(0);
  
  const contactsCollectionRef = useMemoFirebase(() => {
    if (!user) return null;
    return collection(firestore, 'users', user.uid, 'contacts');
  }, [firestore, user]);


  const handleSaveContact = async (contactData: Partial<Contact>) => {
    if (!user) {
        toast({ title: "Erro", description: "Você precisa estar logado.", variant: "destructive" });
        return;
    }

    const formattedPhone = formatPhoneNumberForDB(contactData.phone);
    const dataToSave = { ...contactData, phone: formattedPhone };

    try {
        if (dataToSave.id) {
            // Edit existing contact
            const contactRef = doc(firestore, 'users', user.uid, 'contacts', dataToSave.id);
            await setDoc(contactRef, dataToSave, { merge: true });
            toast({ title: "Contato atualizado!", description: `${dataToSave.name} foi atualizado com sucesso.` });
        } else {
            // Add new contact
            const newContact: Omit<Contact, 'id' | 'avatarUrl'> = {
                userId: user.uid,
                name: dataToSave.name || '',
                phone: dataToSave.phone || '',
                segment: dataToSave.segment || 'New',
                createdAt: new Date(),
                birthday: dataToSave.birthday || undefined // Ensure no undefined value
            };
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
  
  const handleBatchImport = async (contacts: { name: string; phone: string }[]) => {
    if (!user) {
        toast({ title: "Erro", description: "Você precisa estar logado.", variant: "destructive" });
        return;
    }
    
    try {
        const chunkSize = 500;
        for (let i = 0; i < contacts.length; i += chunkSize) {
            const chunk = contacts.slice(i, i + chunkSize);
            const batch = writeBatch(firestore);
            
            chunk.forEach(contactData => {
                const formattedPhone = formatPhoneNumberForDB(contactData.phone);
                const newContact: Omit<Contact, 'id' | 'avatarUrl'> = {
                    userId: user.uid,
                    name: contactData.name || '',
                    phone: formattedPhone,
                    segment: 'Regular',
                    createdAt: new Date(),
                };
                const contactRef = doc(collection(firestore, 'users', user.uid, 'contacts'));
                batch.set(contactRef, newContact);
            });
            
            await batch.commit();
        }

        toast({
            title: "Contatos importados!",
            description: `${contacts.length} novos contatos foram adicionados com sucesso.`
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
    </div>
  );
}
