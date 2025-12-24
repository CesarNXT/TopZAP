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
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { useUser, useFirestore, useCollection } from '@/firebase';
import { doc, setDoc, addDoc, collection, writeBatch, getDocs, query } from 'firebase/firestore';
import { DeleteAllContactsDialog } from '@/components/contacts/delete-all-contacts-dialog';
import { useMemoFirebase } from '@/firebase/provider';

export default function ContactsPage() {
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [isImportWizardOpen, setIsImportWizardOpen] = React.useState(false);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = React.useState(false);
  const [contactToEdit, setContactToEdit] = React.useState<Contact | null>(null);
  const [filter, setFilter] = React.useState('all');
  
  const contactsCollectionRef = useMemoFirebase(() => {
    if (!user) return null;
    return collection(firestore, 'users', user.uid, 'contacts');
  }, [firestore, user]);

  const { data: contacts } = useCollection<Contact>(contactsCollectionRef);

  const handleSaveContact = async (contactData: Partial<Contact>) => {
    if (!user) {
        toast({ title: "Erro", description: "Você precisa estar logado.", variant: "destructive" });
        return;
    }

    try {
        if (contactData.id) {
            // Edit existing contact
            const contactRef = doc(firestore, 'users', user.uid, 'contacts', contactData.id);
            await setDoc(contactRef, contactData, { merge: true });
            toast({ title: "Contato atualizado!", description: `${contactData.name} foi atualizado com sucesso.` });
        } else {
            // Add new contact
            const newContact: Omit<Contact, 'id'> = {
                userId: user.uid,
                name: contactData.name || '',
                phone: contactData.phone || '',
                segment: contactData.segment || 'New',
                createdAt: new Date(),
                avatarUrl: PlaceHolderImages[Math.floor(Math.random() * PlaceHolderImages.length)].imageUrl,
                birthday: contactData.birthday
            };
            await addDoc(collection(firestore, 'users', user.uid, 'contacts'), newContact);
            toast({ title: "Contato criado!", description: `${newContact.name} foi adicionado à sua lista.` });
        }
        setContactToEdit(null);
        setIsFormOpen(false);
    } catch (error: any) {
        console.error("Error saving contact:", error);
        toast({ title: "Erro ao salvar", description: error.message || "Não foi possível salvar o contato.", variant: "destructive" });
    }
  };
  
  const handleBatchImport = async (contacts: Omit<Contact, 'id' | 'userId' | 'createdAt' | 'avatarUrl'>[]) => {
    if (!user) {
        toast({ title: "Erro", description: "Você precisa estar logado.", variant: "destructive" });
        return;
    }
    
    const batch = writeBatch(firestore);
    
    contacts.forEach(contactData => {
        const newContact: Omit<Contact, 'id'> = {
            userId: user.uid,
            name: contactData.name || '',
            phone: contactData.phone || '',
            segment: 'New',
            createdAt: new Date(),
            avatarUrl: PlaceHolderImages[Math.floor(Math.random() * PlaceHolderImages.length)].imageUrl,
        };
        const contactRef = doc(collection(firestore, 'users', user.uid, 'contacts'));
        batch.set(contactRef, newContact);
    });

    try {
        await batch.commit();
        toast({
            title: "Contatos importados!",
            description: `${contacts.length} novos contatos foram adicionados com sucesso.`
        });
        setIsImportWizardOpen(false);
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
        const contactsRef = collection(firestore, 'users', user.uid, 'contacts');
        const q = query(contactsRef);
        const querySnapshot = await getDocs(q);
        
        const batch = writeBatch(firestore);
        querySnapshot.forEach((doc) => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        
        toast({ title: "Sucesso!", description: "Todos os contatos foram excluídos." });
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
            <Button variant="destructive" onClick={() => setIsDeleteAllOpen(true)} disabled={!contacts || contacts.length === 0}>
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir Todos
            </Button>
        </PageHeaderActions>
      </PageHeader>
      
      <ContactsTable 
        onEditRequest={handleEditRequest} 
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
