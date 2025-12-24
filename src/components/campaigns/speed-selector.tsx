'use client';
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  FormField,
} from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { AlertTriangle } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import type { UseFormReturn } from 'react-hook-form';

interface SpeedSelectorProps {
    form: UseFormReturn<any>;
}

export function SpeedSelector({ form }: SpeedSelectorProps) {
  const sendSpeedValue = form.watch('sendSpeed');
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Etapa 3: Velocidade de Envio</CardTitle>
        <CardDescription>Defina o intervalo entre as mensagens para evitar bloqueios.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FormField
          control={form.control}
          name="sendSpeed"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>Velocidade de Envio (Delay)</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2"
                >
                  <FormItem>
                    <RadioGroupItem value="safe" id="safe" className="sr-only" />
                    <label
                      htmlFor="safe"
                      className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all ${field.value === 'safe' ? 'border-primary ring-2 ring-primary' : ''}`}
                    >
                      <span className="text-4xl">🐢</span>
                      <span className="font-bold mt-2">Modo Seguro</span>
                      <span className="text-sm text-muted-foreground">(20-45s / msg)</span>
                      <span className="text-xs font-semibold text-primary mt-1">Recomendado</span>
                    </label>
                  </FormItem>
                  <FormItem>
                    <RadioGroupItem value="fast" id="fast" className="sr-only" />
                    <label
                      htmlFor="fast"
                       className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all ${field.value === 'fast' ? 'border-primary ring-2 ring-primary' : ''}`}
                    >
                      <span className="text-4xl">🐇</span>
                      <span className="font-bold mt-2">Modo Normal</span>
                      <span className="text-sm text-muted-foreground">(10-20s / msg)</span>
                       <span className="text-xs font-semibold text-yellow-600 mt-1">Risco Médio</span>
                    </label>
                  </FormItem>
                  <FormItem>
                    <RadioGroupItem value="turbo" id="turbo" className="sr-only" />
                    <label
                      htmlFor="turbo"
                       className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all ${field.value === 'turbo' ? 'border-primary ring-2 ring-primary' : ''}`}
                    >
                      <span className="text-4xl">🚀</span>
                      <span className="font-bold mt-2">Modo Rápido</span>
                      <span className="text-sm text-muted-foreground">(5-10s / msg)</span>
                       <span className="text-xs font-semibold text-destructive mt-1">Alto Risco</span>
                    </label>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {sendSpeedValue === 'turbo' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Modo de Alto Risco Ativado!</AlertTitle>
            <AlertDescription>
              O Modo Rápido aumenta significativamente a chance de bloqueio do seu número. Use com extrema cautela e apenas para contatos que esperam sua mensagem.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
