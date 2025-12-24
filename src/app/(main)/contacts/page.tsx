'use client';

import React from 'react';
import { PageHeader, PageHeaderHeading, PageHeaderDescription, PageHeaderActions } from '@/components/page-header';
import { ContactsTable } from '@/components/contacts/contacts-table';
import { Button } from '@/components/ui/button';
import { PlusCircle, Upload } from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { useToast } from '@/hooks/use-toast';
import type { Contact } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { contacts as defaultData } from '@/lib/data';

export default function ContactsPage() {
  const { toast } = useToast();
  const [data, setData] = React.useState<Contact[]>(() => [...defaultData]);
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [contactToEdit, setContactToEdit] = React.useState<Contact | null>(null);

  const handleSaveContact = (contactData: Omit<Contact, 'avatarUrl' | 'createdAt'>) => {
    if (contactData.id) {
        // Edit existing contact
        setData(prev => prev.map(c => c.id === contactData.id ? { ...c, ...contactData } : c));
        toast({ title: "Contato atualizado!", description: `${contactData.name} foi atualizado com sucesso.` });
    } else {
        // Add new contact
        const newContact: Contact = {
            ...contactData,
            id: uuidv4(),
            createdAt: new Date().toISOString(),
            avatarUrl: PlaceHolderImages[Math.floor(Math.random() * PlaceHolderImages.length)].imageUrl,
        };
        setData(prev => [newContact, ...prev]);
        toast({ title: "Contato criado!", description: `${newContact.name} foi adicionado à sua lista.` });
    }
    setContactToEdit(null);
    setIsFormOpen(false);
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
            Importe, organize e segmente seus contatos para mensagens direcionadas.
          </PageHeaderDescription>
        </div>
        <PageHeaderActions>
            <Button variant="outline">
                <Upload className="mr-2 h-4 w-4" />
                Importar Contatos
            </Button>
            <Button onClick={handleNewRequest}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Novo Contato
            </Button>
        </PageHeaderActions>
      </PageHeader>
      
      <ContactsTable 
        data={data}
        setData={setData}
        onEditRequest={handleEditRequest} 
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
    </div>
  );
}
