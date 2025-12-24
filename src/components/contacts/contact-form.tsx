'use client';
import React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@/components/ui/select';
import { Calendar } from '../ui/calendar';
import { format } from 'date-fns';
import type { Contact } from '@/lib/types';
import { serverTimestamp } from 'firebase/firestore';

const formSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' }),
  phone: z.string().min(10, { message: 'O telefone deve ter pelo menos 10 caracteres.' }),
  segment: z.enum(['VIP', 'New', 'Regular', 'Inactive']),
  birthday: z.date().optional(),
});

interface ContactFormProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    contact?: Omit<Contact, 'createdAt'> & { createdAt?: any } | null;
    onSave: (contact: Partial<Contact>) => void;
}

export function ContactForm({ isOpen, onOpenChange, contact, onSave }: ContactFormProps) {
  const getInitialBirthday = () => {
    if (!contact?.birthday) return undefined;
    if (typeof contact.birthday === 'string') {
      return new Date(contact.birthday + 'T00:00:00');
    }
    return undefined;
  };
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: contact?.id,
      name: contact?.name || '',
      phone: contact?.phone || '',
      segment: contact?.segment || 'New',
      birthday: getInitialBirthday(),
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    const birthdayString = values.birthday ? format(values.birthday, 'yyyy-MM-dd') : undefined;
    
    let dataToSave: Partial<Contact> & { createdAt?: any } = {
        ...values,
        birthday: birthdayString,
    };
    
    if (!values.id) { // New contact
        dataToSave.createdAt = serverTimestamp();
    }
    
    onSave(dataToSave);
    onOpenChange(false);
  }

  const title = contact ? 'Editar Contato' : 'Criar Novo Contato';
  const description = contact
    ? 'Atualize os detalhes do contato abaixo.'
    : 'Preencha os campos para adicionar um novo contato.';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome do contato" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefone</FormLabel>
                      <FormControl>
                        <Input placeholder="+55 11 99999-9999" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="segment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grupo</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um grupo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="New">Novo</SelectItem>
                          <SelectItem value="Regular">Cliente</SelectItem>
                          <SelectItem value="VIP">Cliente VIP</SelectItem>
                          <SelectItem value="Inactive">Bloqueado</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="birthday"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Data de Aniversário</FormLabel>
                       <FormControl>
                          <Calendar 
                            selected={field.value}
                            onSelect={field.onChange}
                          />
                        </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="ghost">Cancelar</Button>
                    </DialogClose>
                    <Button type="submit">Salvar Contato</Button>
                </DialogFooter>
                </form>
            </Form>
        </DialogContent>
    </Dialog>
  );
}
