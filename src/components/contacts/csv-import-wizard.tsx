'use client';
import React, { useState, useMemo } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
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
import { UploadCloud, Sheet, CheckCircle, AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';

interface CsvImportWizardProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onImport: (contacts: { name: string; phone: string }[]) => void;
}

const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/; // E.164 format-ish

export function CsvImportWizard({ isOpen, onOpenChange, onImport }: CsvImportWizardProps) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [nameColumn, setNameColumn] = useState<string>('');
  const [phoneColumn, setPhoneColumn] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  const resetWizard = () => {
    setStep(1);
    setFile(null);
    setHeaders([]);
    setData([]);
    setNameColumn('');
    setPhoneColumn('');
    setIsProcessing(false);
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

  const { validContacts, invalidContactsCount } = useMemo(() => {
    if (step !== 3 || !nameColumn || !phoneColumn) {
      return { validContacts: [], invalidContactsCount: 0 };
    }

    const valid: { name: string; phone: string }[] = [];
    let invalidCount = 0;

    data.forEach((row) => {
      const name = row[nameColumn]?.trim();
      let phone = row[phoneColumn]?.toString().trim();

      if (name && phone) {
        phone = phone.replace(/\D/g, ''); // Remove non-digit characters
        if (PHONE_REGEX.test(phone)) {
            valid.push({ name, phone });
        } else {
            invalidCount++;
        }
      } else {
        invalidCount++;
      }
    });

    return { validContacts: valid, invalidContactsCount: invalidCount };
  }, [step, data, nameColumn, phoneColumn]);
  
  const handleImportClick = async () => {
    setIsProcessing(true);
    // In a real app, might have async operations here
    await new Promise(resolve => setTimeout(resolve, 500)); 
    onImport(validContacts);
    setIsProcessing(false);
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
                <Label htmlFor="name-column">Coluna do Nome</Label>
                <Select value={nameColumn} onValueChange={setNameColumn}>
                  <SelectTrigger id="name-column">
                    <SelectValue placeholder="Selecione a coluna" />
                  </SelectTrigger>
                  <SelectContent>
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
                  <SelectContent>
                    {headers.map(header => <SelectItem key={header} value={header}>{header}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="pt-4">
                <Button variant="ghost" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <Button onClick={() => setStep(3)} disabled={!nameColumn || !phoneColumn}>
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
            
            {invalidContactsCount > 0 && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Contatos Inválidos</AlertTitle>
                    <AlertDescription>
                        Foram ignorados <strong>{invalidContactsCount} contatos</strong> por falta de nome ou telefone inválido.
                    </AlertDescription>
                </Alert>
            )}

            <div className="max-h-60 overflow-y-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Telefone</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {validContacts.slice(0, 10).map((contact, index) => (
                            <TableRow key={index}>
                                <TableCell className="font-medium">{contact.name}</TableCell>
                                <TableCell>{contact.phone}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {validContacts.length > 10 && <div className='p-2 text-center text-sm text-muted-foreground'>Mostrando 10 de {validContacts.length} contatos.</div>}
            </div>

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
