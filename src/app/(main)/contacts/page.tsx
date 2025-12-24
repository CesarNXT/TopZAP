'use client';

import React from 'react';
import { PageHeader, PageHeaderHeading, PageHeaderDescription, PageHeaderActions } from '@/components/page-header';
import { ContactsTable } from '@/components/contacts/contacts-table';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { useToast } from '@/hooks/use-toast';
import type { Contact } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { contacts as defaultData } from '@/lib/data';

export default function ContactsPage() {
  const { toast } = useToast();
  const [data, setData] = React.useState<Contact[]>([]);
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [contactToEdit, setContactToEdit] = React.useState<Contact | null>(null);
  const [filter, setFilter] = React.useState('all');
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
    let storedData: Contact[] = [];
    try {
      const storedContacts = localStorage.getItem('contacts');
      if (storedContacts) {
        storedData = JSON.parse(storedContacts);
      } else {
        storedData = [...defaultData];
      }
    } catch (error) {
        console.error("Failed to parse contacts from localStorage", error);
        storedData = [...defaultData];
    }
    setData(storedData);
  }, []);

  React.useEffect(() => {
    if (isMounted) {
      localStorage.setItem('contacts', JSON.stringify(data));
    }
  }, [data, isMounted]);

  const handleSaveContact = (contactData: Omit<Contact, 'avatarUrl' | 'createdAt' | 'id'> & {id?: string}) => {
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

  const filteredData = React.useMemo(() => {
    if (filter === 'all') return data;
    if (filter === 'vip') return data.filter(c => c.segment === 'VIP');
    if (filter === 'blocked') return data.filter(c => c.segment === 'Inactive');
    return data;
  }, [data, filter]);

  if (!isMounted) {
      return null;
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
            <Button onClick={handleNewRequest}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Novo Contato
            </Button>
        </PageHeaderActions>
      </PageHeader>
      
      <ContactsTable 
        data={filteredData}
        setData={setData}
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
    </div>
  );
}
