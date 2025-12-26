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
import { serverTimestamp, deleteField } from 'firebase/firestore';
import { ddiList } from '@/lib/ddi-list';

const formSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' }),
  ddi: z.string().default('55'),
  phone: z.string().min(10, { message: 'O telefone deve ter pelo menos 10 caracteres.' }).max(11, { message: 'O telefone deve ter no máximo 11 caracteres.' }),
  segment: z.enum(['New', 'Regular', 'Inactive']),
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
  
  const getInitialPhoneData = () => {
      if (!contact?.phone) return { ddi: '55', phone: '' };
      
      const cleaned = contact.phone.replace(/\D/g, '');
      // Try to find the matching DDI
      // Sort DDI list by length desc to match longest code first
      const sortedDDI = [...ddiList].sort((a, b) => b.code.length - a.code.length);
      
      for (const ddi of sortedDDI) {
          if (cleaned.startsWith(ddi.code)) {
              return {
                  ddi: ddi.code,
                  phone: cleaned.substring(ddi.code.length)
              };
          }
      }
      
      // Default fallback if no DDI match found (assume Brazil 55 if not found or just use default)
      // Or just put everything in phone if no DDI matches?
      // Let's assume 55 if starts with 55, else default to 55 and put whole number in phone?
      // Actually, if we can't parse DDI, we might have an issue. 
      // But let's try to handle cases where number doesn't have DDI stored? 
      // Existing data might be just "11999999999" without 55? 
      // If cleaned length is 10 or 11, it's likely BR without 55.
      if (cleaned.length === 10 || cleaned.length === 11) {
           return { ddi: '55', phone: cleaned };
      }
      
      return { ddi: '55', phone: cleaned };
  };

  const initialPhoneData = getInitialPhoneData();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: contact?.id,
      name: contact?.name || '',
      ddi: initialPhoneData.ddi,
      phone: initialPhoneData.phone,
      segment: contact?.segment || 'New',
      birthday: getInitialBirthday(),
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    const birthdayString = values.birthday ? format(values.birthday, 'yyyy-MM-dd') : undefined;
    
    let finalPhone = values.phone.replace(/\D/g, '');
    
    // Brazil 9th digit rule
    if (values.ddi === '55') {
        if (finalPhone.length === 11) {
            // Remove the 3rd digit (index 2) which is the 9 after DDD
            // Example: 11 9 8888 7777 -> 11 8888 7777
            finalPhone = finalPhone.substring(0, 2) + finalPhone.substring(3);
        }
    }
    
    const fullPhone = values.ddi + finalPhone;

    let dataToSave: any = {
        ...values,
        phone: fullPhone,
    };
    
    // Handle birthday: if set, use string; if cleared/empty:
    // - For existing contact: use deleteField() to remove from Firestore
    // - For new contact: delete the key so it's not sent as undefined
    if (birthdayString) {
        dataToSave.birthday = birthdayString;
    } else {
        if (values.id) {
            dataToSave.birthday = deleteField();
        } else {
            delete dataToSave.birthday;
        }
    }

    // Remove ddi from dataToSave
    delete dataToSave.ddi;
    
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
                      <div className="flex gap-2">
                          <FormField
                            control={form.control}
                            name="ddi"
                            render={({ field: ddiField }) => (
                                <FormItem className="w-[140px]">
                                    <Select onValueChange={ddiField.onChange} value={ddiField.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="DDI" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="max-h-[300px]">
                                            {ddiList.map((ddi) => (
                                                <SelectItem key={ddi.code} value={ddi.code}>
                                                    {ddi.country} (+{ddi.code})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                          />
                          <FormControl>
                            <Input 
                                placeholder="11 99999-9999" 
                                {...field} 
                                maxLength={11}
                                onChange={(e) => {
                                    // Only allow digits
                                    const value = e.target.value.replace(/\D/g, '');
                                    field.onChange(value);
                                }}
                            />
                          </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="segment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="New">Novo</SelectItem>
                          <SelectItem value="Regular">Cliente</SelectItem>
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
