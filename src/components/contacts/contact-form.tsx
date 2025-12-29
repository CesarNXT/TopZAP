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
import type { Contact, Tag } from '@/lib/types';
import { serverTimestamp, deleteField } from 'firebase/firestore';
import { ddiList } from '@/lib/ddi-list';
import { Check, Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { getTags } from '@/app/actions/tag-actions';
import { useUser } from '@/firebase';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const formSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' }),
  ddi: z.string().default('55'),
  phone: z.string().min(10, { message: 'O telefone deve ter pelo menos 10 caracteres.' }).max(11, { message: 'O telefone deve ter no máximo 11 caracteres.' }),
  segment: z.enum(['Active', 'Blocked']),
  birthday: z.date().optional(),
  tags: z.array(z.string()).optional(),
});

interface ContactFormProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    contact?: Omit<Contact, 'createdAt'> & { createdAt?: any } | null;
    onSave: (contact: Partial<Contact>) => void;
}

export function ContactForm({ isOpen, onOpenChange, contact, onSave }: ContactFormProps) {
  const { user } = useUser();
  const [availableTags, setAvailableTags] = React.useState<Tag[]>([]);
  const [isTagSelectorOpen, setIsTagSelectorOpen] = React.useState(false);

  const [searchTerm, setSearchTerm] = React.useState('');

  React.useEffect(() => {
    if (user && isOpen) {
        getTags(user.uid).then(res => {
            if (res.success && res.data) {
                setAvailableTags(res.data);
            }
        });
    }
  }, [user, isOpen]);

  const filteredTags = availableTags.filter(tag => 
      tag.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
      segment: (contact?.segment === 'Inactive' || contact?.segment === 'Blocked') ? 'Blocked' : 'Active',
      birthday: getInitialBirthday(),
      tags: contact?.tags || [],
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
                          <SelectItem value="Active">Ativo</SelectItem>
                          <SelectItem value="Blocked">Bloqueado</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Etiquetas</FormLabel>
                      <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2 min-h-[30px]">
                              {field.value?.map(tagId => {
                                  const tag = availableTags.find(t => t.id === tagId);
                                  
                                  // Handle deleted/missing tags
                                  if (!tag) {
                                      return (
                                          <Badge 
                                              key={tagId} 
                                              variant="outline" 
                                              className="gap-1 pl-2 pr-1 py-1 bg-gray-100 text-gray-500 border-dashed border-gray-300" 
                                              title="Esta etiqueta foi excluída do sistema"
                                          >
                                              <span className="italic">Etiqueta Excluída</span>
                                              <div 
                                                  className="ml-1 hover:bg-black/10 rounded-full p-0.5 cursor-pointer"
                                                  onClick={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      const newTags = field.value?.filter(t => t !== tagId);
                                                      field.onChange(newTags);
                                                  }}
                                              >
                                                <X className="w-3 h-3" />
                                              </div>
                                          </Badge>
                                      );
                                  }

                                  return (
                                      <Badge 
                                          key={tagId} 
                                          variant="secondary" 
                                          className="gap-1 pl-2 pr-1 py-1" 
                                          style={{ 
                                              backgroundColor: tag.color + '20', 
                                              color: tag.color, 
                                              borderColor: tag.color + '40',
                                              borderWidth: '1px'
                                          }}
                                      >
                                          {tag.name}
                                          <div 
                                              className="ml-1 hover:bg-black/10 rounded-full p-0.5 cursor-pointer"
                                              onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  const newTags = field.value?.filter(t => t !== tagId);
                                                  field.onChange(newTags);
                                              }}
                                          >
                                            <X className="w-3 h-3" />
                                          </div>
                                      </Badge>
                                  );
                              })}
                          </div>
                          
                          <Popover open={isTagSelectorOpen} onOpenChange={setIsTagSelectorOpen}>
                            <PopoverTrigger asChild>
                              <Button 
                                  type="button"
                                  variant="outline" 
                                  className="w-full justify-between text-muted-foreground font-normal"
                              >
                                  <span>Selecionar Etiquetas...</span>
                                  <Plus className="h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[350px] p-0" align="start">
                                <div className="flex flex-col h-full">
                                    <div className="px-3 py-2 border-b">
                                        <h4 className="font-medium text-sm text-muted-foreground mb-2">Selecionar Etiquetas</h4>
                                        <Input 
                                            placeholder="Buscar etiqueta..." 
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="h-8"
                                        />
                                    </div>
                                    <ScrollArea className="h-[250px] p-2">
                                        {filteredTags.length === 0 ? (
                                            <div className="text-center text-muted-foreground py-4 text-sm">
                                                Nenhuma etiqueta encontrada.
                                            </div>
                                        ) : (
                                            <div className="space-y-1">
                                                {filteredTags.map(tag => {
                                                    const isSelected = field.value?.includes(tag.id);
                                                    return (
                                                        <div 
                                                            key={tag.id}
                                                            className={cn(
                                                                "flex items-center space-x-2 p-2 rounded-sm cursor-pointer hover:bg-muted transition-colors",
                                                                isSelected && "bg-muted/50"
                                                            )}
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                const current = field.value || [];
                                                                if (isSelected) {
                                                                    field.onChange(current.filter(t => t !== tag.id));
                                                                } else {
                                                                    field.onChange([...current, tag.id]);
                                                                }
                                                            }}
                                                        >
                                                            <div 
                                                                className={cn(
                                                                    "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                                    isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                                                )}
                                                            >
                                                                <Check className={cn("h-3 w-3")} />
                                                            </div>
                                                            <div 
                                                                className="w-3 h-3 rounded-full shrink-0" 
                                                                style={{ backgroundColor: tag.color }} 
                                                            />
                                                            <span className="text-sm font-medium leading-none flex-1">
                                                                {tag.name}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </ScrollArea>
                                </div>
                            </PopoverContent>
                          </Popover>
                      </div>
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
                          <Input 
                            type="date"
                            value={field.value ? format(field.value, 'yyyy-MM-dd') : ''}
                            onChange={(e) => {
                                const dateStr = e.target.value;
                                if (!dateStr) {
                                    field.onChange(undefined);
                                } else {
                                    const date = new Date(dateStr + 'T00:00:00');
                                    field.onChange(date);
                                }
                            }}
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
