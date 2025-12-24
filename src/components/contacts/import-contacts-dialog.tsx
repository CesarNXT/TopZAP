'use client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useState, useMemo } from 'react';
import { ArrowLeft, ArrowRight, UploadCloud, CheckCircle } from 'lucide-react';
import { Progress } from '../ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '../ui/table';
import { ScrollArea } from '../ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import Papa from 'papaparse';

type CsvData = { [key: string]: string }[];

interface ImportContactsDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onImport: (contacts: { name: string; phone: string }[]) => void;
}

const STEPS = {
  UPLOAD: 1,
  MAPPING: 2,
  REVIEW: 3,
  DONE: 4,
};

export function ImportContactsDialog({
  isOpen,
  onOpenChange,
  onImport,
}: ImportContactsDialogProps) {
  const [currentStep, setCurrentStep] = useState(STEPS.UPLOAD);
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<CsvData>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [nameColumn, setNameColumn] = useState('');
  const [phoneColumn, setPhoneColumn] = useState('');
  const { toast } = useToast();

  const resetState = () => {
    setCurrentStep(STEPS.UPLOAD);
    setFile(null);
    setCsvData([]);
    setHeaders([]);
    setNameColumn('');
    setPhoneColumn('');
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      resetState();
    }
    onOpenChange(open);
  };
  
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
    }
  }

  const handleFile = (selectedFile: File) => {
    if (selectedFile.type !== 'text/csv') {
      toast({
        variant: 'destructive',
        title: 'Formato de arquivo inválido',
        description: 'Por favor, envie um arquivo no formato CSV.',
      });
      return;
    }
    setFile(selectedFile);
    
    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setHeaders(results.meta.fields || []);
        setCsvData(results.data as CsvData);
        // Auto-detect columns
        const lowerCaseHeaders = (results.meta.fields || []).map(h => h.toLowerCase());
        const nameGuess = (results.meta.fields || [])[lowerCaseHeaders.indexOf('nome')] || (results.meta.fields || [])[lowerCaseHeaders.indexOf('name')] || '';
        const phoneGuess = (results.meta.fields || [])[lowerCaseHeaders.indexOf('telefone')] || (results.meta.fields || [])[lowerCaseHeaders.indexOf('phone')] || '';
        setNameColumn(nameGuess);
        setPhoneColumn(phoneGuess);

        setCurrentStep(STEPS.MAPPING);
      },
      error: (error) => {
        toast({ variant: 'destructive', title: 'Erro ao processar arquivo', description: error.message });
      }
    });
  };

  const mappedData = useMemo(() => {
    if (!nameColumn || !phoneColumn || csvData.length === 0) return [];
    return csvData.map(row => ({
      name: row[nameColumn],
      phone: row[phoneColumn],
    })).filter(contact => contact.name && contact.phone);
  }, [csvData, nameColumn, phoneColumn]);


  const renderStep = () => {
    switch (currentStep) {
      case STEPS.UPLOAD:
        return (
          <>
            <DialogHeader>
              <DialogTitle>Importar Contatos (Passo 1 de 3)</DialogTitle>
              <DialogDescription>
                Envie um arquivo CSV com seus contatos. O arquivo deve conter colunas para nome e telefone.
              </DialogDescription>
            </DialogHeader>
            <div
                className="mt-4 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
            >
                <UploadCloud className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-center">
                {file ? file.name : 'Arraste e solte o arquivo CSV aqui'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">ou</p>
                <Button asChild variant="link" className="p-0 h-auto">
                <label htmlFor="csv-upload" className="cursor-pointer">
                    clique para selecionar um arquivo
                    <input type="file" id="csv-upload" className='hidden' accept=".csv" onChange={handleFileChange} />
                </label>
                </Button>
            </div>
          </>
        );

      case STEPS.MAPPING:
        return (
          <>
            <DialogHeader>
              <DialogTitle>Mapeamento (Passo 2 de 3)</DialogTitle>
              <DialogDescription>
                Combine as colunas do seu arquivo com os campos de contato.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label>Coluna de Nome</label>
                <Select value={nameColumn} onValueChange={setNameColumn}>
                  <SelectTrigger><SelectValue placeholder="Selecione a coluna do nome" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label>Coluna de Telefone</label>
                <Select value={phoneColumn} onValueChange={setPhoneColumn}>
                  <SelectTrigger><SelectValue placeholder="Selecione a coluna do telefone" /></SelectTrigger>
                  <SelectContent>
                    {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
                <Button onClick={() => setCurrentStep(STEPS.UPLOAD)} variant="ghost"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button>
                <Button onClick={() => setCurrentStep(STEPS.REVIEW)} disabled={!nameColumn || !phoneColumn}>Revisar <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </DialogFooter>
          </>
        );

        case STEPS.REVIEW:
        const validContacts = mappedData.filter(c => c.name && c.phone);
        const invalidCount = csvData.length - validContacts.length;

        return (
            <>
            <DialogHeader>
                <DialogTitle>Revisão (Passo 3 de 3)</DialogTitle>
                <DialogDescription>
                Confira os contatos a serem importados. Encontramos {validContacts.length} contatos válidos.
                </DialogDescription>
            </DialogHeader>
            {invalidCount > 0 && (
                <Alert variant="destructive">
                    <AlertTitle>Contatos Inválidos</AlertTitle>
                    <AlertDescription>{invalidCount} linhas foram ignoradas por não terem nome ou telefone.</AlertDescription>
                </Alert>
            )}
            <ScrollArea className="h-60 mt-4 border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Telefone</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {validContacts.slice(0, 100).map((contact, i) => (
                            <TableRow key={i}>
                                <TableCell>{contact.name}</TableCell>
                                <TableCell>{contact.phone}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </ScrollArea>
            <DialogFooter className="mt-4">
                <Button onClick={() => setCurrentStep(STEPS.MAPPING)} variant="ghost"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button>
                <Button onClick={() => {
                    onImport(validContacts);
                    setCurrentStep(STEPS.DONE);
                }} disabled={validContacts.length === 0}>
                    Importar {validContacts.length} Contatos
                </Button>
            </DialogFooter>
            </>
        );
        case STEPS.DONE:
            return (
              <>
                <div className="flex flex-col items-center justify-center py-10 text-center">
                    <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
                    <DialogTitle className="text-xl mb-2">Importação Concluída!</DialogTitle>
                    <p className="text-muted-foreground">{mappedData.length} contatos foram adicionados à sua lista.</p>
                </div>
                <DialogFooter>
                    <Button onClick={() => handleClose(false)} className="w-full">Fechar</Button>
                </DialogFooter>
              </>
            );

      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-lg">
            <div className="p-2">
                <Progress value={(currentStep / (Object.keys(STEPS).length -1)) * 100} className="mb-4" />
                {renderStep()}
            </div>
        </DialogContent>
    </Dialog>
  );
}
