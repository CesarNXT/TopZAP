'use client';
import React, { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface DeleteAllContactsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function DeleteAllContactsDialog({ isOpen, onOpenChange, onConfirm }: DeleteAllContactsDialogProps) {
  const [confirmationText, setConfirmationText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const isConfirmationCorrect = confirmationText === 'deletar';

  const handleConfirmClick = async () => {
    if (isConfirmationCorrect) {
      setIsDeleting(true);
      await onConfirm();
      setIsDeleting(false);
      onOpenChange(false);
      setConfirmationText('');
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setConfirmationText('');
      setIsDeleting(false);
    }
    onOpenChange(open);
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive" />
            Você tem certeza absoluta?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação é irreversível e excluirá permanentemente **todos** os seus contatos.
            Para confirmar, digite a palavra <strong className="text-destructive">deletar</strong> no campo abaixo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-4 space-y-2">
          <Label htmlFor="delete-confirmation">Confirmação</Label>
          <Input
            id="delete-confirmation"
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            placeholder="Digite 'deletar' aqui"
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirmClick}
            disabled={!isConfirmationCorrect || isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Excluindo...
              </>
            ) : (
              'Eu entendo, excluir todos'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
