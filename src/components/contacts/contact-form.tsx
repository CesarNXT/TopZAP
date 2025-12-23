'use client';
import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
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
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '@/lib/utils';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from '../ui/calendar';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Contact } from '@/lib/types';

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
    contact?: Contact | null;
    onSave: (contact: Omit<Contact, 'avatarUrl' | 'createdAt'>) => void;
}

export function ContactForm({ isOpen, onOpenChange, contact, onSave }: ContactFormProps) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: contact?.id,
      name: contact?.name || '',
      phone: contact?.phone || '',
      segment: contact?.segment || 'New',
      birthday: contact?.birthday ? new Date(contact.birthday) : undefined,
    },
  });

  React.useEffect(() => {
    form.reset({
        id: contact?.id,
        name: contact?.name || '',
        phone: contact?.phone || '',
        segment: contact?.segment || 'New',
        birthday: contact?.birthday ? new Date(contact.birthday) : undefined,
    });
  }, [contact, form]);

  function onSubmit(values: z.infer<typeof formSchema>) {
    const birthdayString = values.birthday ? format(values.birthday, 'yyyy-MM-dd') : undefined;
    onSave({ ...values, birthday: birthdayString });
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
                      <FormLabel>Segmento</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um segmento" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="New">Novo</SelectItem>
                          <SelectItem value="Regular">Regular</SelectItem>
                          <SelectItem value="VIP">VIP</SelectItem>
                          <SelectItem value="Inactive">Inativo</SelectItem>
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
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP", { locale: ptBR })
                              ) : (
                                <span>Escolha uma data</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
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
