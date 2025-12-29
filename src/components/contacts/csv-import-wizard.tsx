'use client';
import React, { useState, useMemo } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UploadCloud, Sheet, CheckCircle, AlertTriangle, ArrowLeft, Loader2, HelpCircle, Tags } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import type { Tag } from '@/lib/types';

interface CsvImportWizardProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onImport: (contacts: { name: string; phone: string }[], tags: string[]) => Promise<void> | void;
}

const PHONE_REGEX_BR = /^55\d{10,11}$/; // 55 + DDD + 8 ou 9 dígitos

export function CsvImportWizard({ isOpen, onOpenChange, onImport }: CsvImportWizardProps) {
  const { user } = useUser();
  const firestore = useFirestore();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [nameColumn, setNameColumn] = useState<string>('');
  const [phoneColumn, setPhoneColumn] = useState<string>('');
  const [defaultDDD, setDefaultDDD] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = React.useRef(false);

  // Fetch Tags
  const tagsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(collection(firestore, 'users', user.uid, 'tags'), orderBy('name'));
  }, [firestore, user]);
  
  const { data: tags } = useCollection<Tag>(tagsQuery);
  const availableTags = tags || [];

  const resetWizard = () => {
    setStep(1);
    setFile(null);
    setHeaders([]);
    setData([]);
    setNameColumn('');
    setPhoneColumn('');
    setDefaultDDD('');
    setSelectedTags([]);
    setIsProcessing(false);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev => 
      prev.includes(tagId) 
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  };


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setHeaders(results.meta.fields || []);
          setData(results.data);
          setStep(2);
        },
      });
    }
  };

  const { validContacts, invalidContacts } = useMemo(() => {
    if (step !== 3 || !phoneColumn) {
      return { validContacts: [], invalidContacts: [] };
    }

    const valid: { name: string; phone: string }[] = [];
    const invalid: { name: string; rawPhone: string; reason: string }[] = [];
    const seenPhones = new Set<string>();

    data.forEach((row) => {
      // Name is optional now. Use provided column if selected, otherwise fallback.
      const rawName = (nameColumn && nameColumn !== 'none_selection_special_value') ? row[nameColumn]?.trim() : '';
      const rawPhone = row[phoneColumn]; // Keep original for debugging
      let phone = rawPhone?.toString().trim();

      if (phone) {
          phone = phone.replace(/\D/g, ''); // Remove non-digit characters
          
          // Check if phone became empty after removing non-digits
          if (!phone) {
            invalid.push({ name: rawName || 'Sem nome', rawPhone: rawPhone || '(Vazio)', reason: 'Sem números' });
            return;
          }

          // Remove leading zeros (common in BR like 031...)
          phone = phone.replace(/^0+/, '');

          // Intelligent formatting for BR numbers
          
          // 1. Handle missing DDD (8 or 9 digits) using Default DDD
          if ((phone.length === 8 || phone.length === 9) && defaultDDD) {
               phone = '55' + defaultDDD + phone;
          }
          // 2. Handle standard numbers without Country Code (10 or 11 digits)
          else if (phone.length === 10 || phone.length === 11) {
              phone = '55' + phone;
          }
          // 3. Handle numbers that might have carrier codes (e.g. 1531999999999 -> 13 digits but not starting with 55)
          // If it's > 11 digits and DOES NOT start with 55, try to extract the last 11 digits (DDD + Number)
          else if (phone.length > 11 && !phone.startsWith('55')) {
              const last11 = phone.slice(-11);
              // Basic check if the extraction looks like a valid mobile/landline (DDD >= 11)
              if (parseInt(last11.substring(0, 2)) > 10) {
                  phone = '55' + last11;
              }
          }
          // 4. If it already has 55 (12 or 13 digits), keep it as is.
          
          // Validate strictly for BR format
          if (PHONE_REGEX_BR.test(phone)) {
              if (seenPhones.has(phone)) {
                  invalid.push({ name: rawName || 'Sem nome', rawPhone: rawPhone, reason: `Duplicado (${phone})` });
              } else {
                  seenPhones.add(phone);
                  // Use Phone as name if name is missing
                  const finalName = rawName || phone;
                  valid.push({ name: finalName, phone });
              }
          } else {
              invalid.push({ name: rawName || 'Sem nome', rawPhone: rawPhone, reason: `Formato inválido (${phone})` });
          }
      } else {
        invalid.push({ name: rawName || 'Sem nome', rawPhone: '(Vazio)', reason: 'Coluna vazia' });
      }
    });

    return { validContacts: valid, invalidContacts: invalid };

  }, [step, data, nameColumn, phoneColumn, defaultDDD]);
  
  const handleImportClick = async () => {
    if (isProcessingRef.current) return;
    
    try {
        isProcessingRef.current = true;
        setIsProcessing(true);
        await onImport(validContacts, selectedTags);
    } catch (error) {
        console.error("Error importing contacts", error);
    } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      resetWizard();
    }
    onOpenChange(open);
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Assistente de Importação de Contatos</DialogTitle>
          <DialogDescription>
            Siga os passos para importar seus contatos de um arquivo CSV.
          </DialogDescription>
        </DialogHeader>
        
        {step === 1 && (
          <div className="py-8">
            <label
              htmlFor="csv-upload"
              className="relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                <UploadCloud className="w-10 h-10 mb-4 text-muted-foreground" />
                <p className="mb-2 text-lg font-semibold">Clique para fazer o upload</p>
                <p className="text-sm text-muted-foreground">ou arraste e solte seu arquivo CSV aqui</p>
              </div>
              <input id="csv-upload" type="file" className="absolute inset-0 w-full h-full opacity-0" accept=".csv" onChange={handleFileChange} />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-6 py-4">
            <Alert>
              <Sheet className="h-4 w-4" />
              <AlertTitle>Arquivo Carregado: {file?.name}</AlertTitle>
              <AlertDescription>
                Agora, mapeie as colunas do seu arquivo para os campos de Nome e Telefone.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name-column">Coluna do Nome (Opcional)</Label>
                <Select value={nameColumn} onValueChange={setNameColumn}>
                  <SelectTrigger id="name-column">
                    <SelectValue placeholder="Selecione a coluna (ou deixe vazio)" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    <SelectItem value="none_selection_special_value">-- Não usar nome --</SelectItem>
                    {headers.map(header => <SelectItem key={header} value={header}>{header}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone-column">Coluna do Telefone</Label>
                <Select value={phoneColumn} onValueChange={setPhoneColumn}>
                  <SelectTrigger id="phone-column">
                    <SelectValue placeholder="Selecione a coluna" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {headers.map(header => <SelectItem key={header} value={header}>{header}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-4 space-y-2">
                <Label htmlFor="default-ddd">DDD Padrão (Opcional)</Label>
                <Input 
                    id="default-ddd" 
                    placeholder="Ex: 11 (Usado se o número não tiver DDD)" 
                    value={defaultDDD} 
                    onChange={(e) => setDefaultDDD(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    maxLength={2}
                />
                <p className="text-xs text-muted-foreground">
                    Será adicionado automaticamente para números com 8 ou 9 dígitos.
                </p>
            </div>

            <div className="mt-4 space-y-2">
                <Label>Etiquetas para aplicar em todos (Opcional)</Label>
                <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px] bg-background/50">
                    {availableTags.length === 0 ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground w-full justify-center py-2">
                             <Tags className="w-4 h-4" />
                             <span>Nenhuma etiqueta disponível.</span>
                        </div>
                    ) : (
                        availableTags.map(tag => {
                            const isSelected = selectedTags.includes(tag.id);
                            return (
                                <Badge
                                    key={tag.id}
                                    variant="outline"
                                    className={`cursor-pointer select-none gap-1 transition-all hover:opacity-80 px-3 py-1 ${isSelected ? 'shadow-sm' : ''}`}
                                    style={isSelected ? {
                                        backgroundColor: tag.color,
                                        color: '#fff', // Assuming dark text on light bg isn't guaranteed, but white is safe for most generated colors? Actually user picks color. 
                                        // Let's try to be smart or just use the color as BG.
                                        borderColor: tag.color
                                    } : {
                                        borderColor: tag.color, // + '40' maybe too faint?
                                        backgroundColor: tag.color + '10', // Light tint
                                        color: tag.color
                                    }}
                                    onClick={() => toggleTag(tag.id)}
                                >
                                    {tag.name}
                                    {isSelected && <CheckCircle className="w-3 h-3 ml-1" />}
                                </Badge>
                            );
                        })
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                    Os contatos importados receberão estas etiquetas automaticamente.
                </p>
            </div>

            <DialogFooter className="pt-4">
                <Button variant="ghost" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <Button onClick={() => setStep(3)} disabled={!phoneColumn}>
                    Verificar e Pré-visualizar
                </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-6 py-4">
            <Alert variant="default" className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-800 dark:text-green-300">Validação Concluída</AlertTitle>
                <AlertDescription className="text-green-700 dark:text-green-400">
                    Encontramos <strong>{validContacts.length} contatos válidos</strong> para importar.
                </AlertDescription>
            </Alert>
            
            {invalidContacts.length > 0 && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Contatos Inválidos</AlertTitle>
                    <AlertDescription>
                        Foram ignorados <strong>{invalidContacts.length} contatos</strong>. Verifique a aba "Inválidos" abaixo para detalhes.
                    </AlertDescription>
                </Alert>
            )}

            <Tabs defaultValue="valid" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="valid">Válidos ({validContacts.length})</TabsTrigger>
                    <TabsTrigger value="invalid">Inválidos ({invalidContacts.length})</TabsTrigger>
                </TabsList>
                
                <TabsContent value="valid">
                    <div className="max-h-60 overflow-y-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Telefone (Após Limpeza)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {validContacts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center text-muted-foreground h-24">
                                            Nenhum contato válido encontrado.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    validContacts.slice(0, 50).map((contact, index) => (
                                        <TableRow key={index}>
                                            <TableCell className="font-medium">{contact.name}</TableCell>
                                            <TableCell>{contact.phone}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                        {validContacts.length > 50 && <div className='p-2 text-center text-sm text-muted-foreground'>Mostrando 50 de {validContacts.length} contatos.</div>}
                    </div>
                </TabsContent>

                <TabsContent value="invalid">
                    <div className="max-h-60 overflow-y-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Valor Original</TableHead>
                                    <TableHead>Motivo</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invalidContacts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center text-muted-foreground h-24">
                                            Nenhum contato inválido.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    invalidContacts.slice(0, 50).map((contact, index) => (
                                        <TableRow key={index}>
                                            <TableCell className="font-medium">{contact.name}</TableCell>
                                            <TableCell className="font-mono text-xs">{String(contact.rawPhone).substring(0, 30)}</TableCell>
                                            <TableCell className="text-red-500 text-xs">{contact.reason}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                        {invalidContacts.length > 50 && <div className='p-2 text-center text-sm text-muted-foreground'>Mostrando 50 de {invalidContacts.length} contatos.</div>}
                    </div>
                </TabsContent>
            </Tabs>

            <DialogFooter className="pt-4">
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button onClick={handleImportClick} disabled={validContacts.length === 0 || isProcessing}>
                 {isProcessing ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Importando...
                    </>
                 ) : (
                    `Importar ${validContacts.length} Contatos`
                 )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
