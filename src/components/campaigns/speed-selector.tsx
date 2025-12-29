'use client';
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
  FormField,
} from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { AlertTriangle, Calendar, Clock } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Input } from '@/components/ui/input';
import type { UseFormReturn } from 'react-hook-form';

interface SpeedSelectorProps {
    form: UseFormReturn<any>;
}

export function SpeedSelector({ form }: SpeedSelectorProps) {
  const sendSpeedValue = form.watch('sendSpeed');
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Etapa 3: Configurações de Envio</CardTitle>
        <CardDescription>Defina velocidade e agendamento da campanha.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Speed Selection */}
        <FormField
          control={form.control}
          name="sendSpeed"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel className="text-base">Velocidade de Envio (Delay)</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2"
                >
                  <FormItem>
                    <RadioGroupItem value="slow" id="slow" className="sr-only" />
                    <label
                      htmlFor="slow"
                      className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all hover:bg-accent ${field.value === 'slow' ? 'border-primary ring-2 ring-primary bg-accent/50' : ''}`}
                    >
                      <span className="text-4xl mb-2">🐢</span>
                      <span className="font-bold">Modo Lento</span>
                      <span className="text-xs text-muted-foreground mt-1 text-center">100-120s / msg</span>
                      <span className="text-xs font-semibold text-primary mt-1">Recomendado</span>
                    </label>
                  </FormItem>
                  <FormItem>
                    <RadioGroupItem value="medium" id="medium" className="sr-only" />
                    <label
                      htmlFor="medium"
                      className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all hover:bg-accent ${field.value === 'medium' ? 'border-primary ring-2 ring-primary bg-accent/50' : ''}`}
                    >
                      <span className="text-4xl mb-2">🐇</span>
                      <span className="font-bold">Modo Normal</span>
                      <span className="text-xs text-muted-foreground mt-1 text-center">80-100s / msg</span>
                      <span className="text-xs font-semibold text-yellow-600 mt-1">Risco Médio</span>
                    </label>
                  </FormItem>
                  <FormItem>
                    <RadioGroupItem value="fast" id="fast" className="sr-only" />
                    <label
                      htmlFor="fast"
                      className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all hover:bg-accent ${field.value === 'fast' ? 'border-primary ring-2 ring-primary bg-accent/50' : ''}`}
                    >
                      <span className="text-4xl mb-2">🚀</span>
                      <span className="font-bold">Modo Rápido</span>
                      <span className="text-xs text-muted-foreground mt-1 text-center">60-80s / msg</span>
                      <span className="text-xs font-semibold text-destructive mt-1">Alto Risco</span>
                    </label>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {sendSpeedValue === 'fast' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Modo de Alto Risco Ativado!</AlertTitle>
            <AlertDescription>
              O Modo Rápido aumenta significativamente a chance de bloqueio do seu número. Use com extrema cautela.
            </AlertDescription>
          </Alert>
        )}

        <div className="border-t pt-6">
            <h3 className="font-medium mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Agendamento Diário
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Data de Início</FormLabel>
                            <FormControl>
                                <Input type="date" {...field} value={field.value || ''} min={new Date().toISOString().split('T')[0]} />
                            </FormControl>
                            <FormDescription className="text-xs">
                                Quando começar a enviar.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="startHour"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Horário de Início (Diário)</FormLabel>
                            <FormControl>
                                <Input type="time" {...field} value={field.value || ''} />
                            </FormControl>
                            <FormDescription className="text-xs">
                                Hora que inicia os envios todos os dias.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                
                 <FormField
                    control={form.control}
                    name="endHour"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Horário Final (Diário)</FormLabel>
                            <FormControl>
                                <Input type="time" {...field} value={field.value || ''} />
                            </FormControl>
                            <FormDescription className="text-xs">
                                Hora que pausa os envios todos os dias.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
            
            <div className="mt-4 p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
                <p>
                    O sistema calculará automaticamente quantos contatos podem ser enviados por dia respeitando o intervalo de tempo entre o Horário de Início e o Horário Final, baseado na velocidade escolhida.
                </p>
            </div>
        </div>

      </CardContent>
    </Card>
  );
}
