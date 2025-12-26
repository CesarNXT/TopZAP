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
        <CardDescription>Defina velocidade, limites e agendamento da campanha.</CardDescription>
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
                    <RadioGroupItem value="safe" id="safe" className="sr-only" />
                    <label
                      htmlFor="safe"
                      className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all hover:bg-accent ${field.value === 'safe' ? 'border-primary ring-2 ring-primary bg-accent/50' : ''}`}
                    >
                      <span className="text-4xl mb-2">🐢</span>
                      <span className="font-bold">Modo Seguro</span>
                      <span className="text-xs text-muted-foreground mt-1 text-center">120-180s / msg</span>
                      <span className="text-xs font-semibold text-primary mt-1">Recomendado</span>
                    </label>
                  </FormItem>
                  <FormItem>
                    <RadioGroupItem value="fast" id="fast" className="sr-only" />
                    <label
                      htmlFor="fast"
                      className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all hover:bg-accent ${field.value === 'fast' ? 'border-primary ring-2 ring-primary bg-accent/50' : ''}`}
                    >
                      <span className="text-4xl mb-2">🐇</span>
                      <span className="font-bold">Modo Normal</span>
                      <span className="text-xs text-muted-foreground mt-1 text-center">60-120s / msg</span>
                      <span className="text-xs font-semibold text-yellow-600 mt-1">Risco Médio</span>
                    </label>
                  </FormItem>
                  <FormItem>
                    <RadioGroupItem value="turbo" id="turbo" className="sr-only" />
                    <label
                      htmlFor="turbo"
                      className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 cursor-pointer transition-all hover:bg-accent ${field.value === 'turbo' ? 'border-primary ring-2 ring-primary bg-accent/50' : ''}`}
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

        {sendSpeedValue === 'turbo' && (
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
                Limites e Agendamento
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                    control={form.control}
                    name="dailyLimit"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Limite Diário</FormLabel>
                            <FormControl>
                                <Input 
                                    type="number" 
                                    min={300}
                                    {...field} 
                                    disabled
                                    value={300}
                                />
                            </FormControl>
                            <FormDescription className="text-xs">
                                Fixo em 300 mensagens por dia para segurança.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

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
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                <FormField
                    control={form.control}
                    name="startHour"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Horário de Início (1º Dia)</FormLabel>
                            <FormControl>
                                <Input type="time" {...field} value={field.value || ''} />
                            </FormControl>
                            <FormDescription className="text-xs">
                                Horário para iniciar o envio do primeiro lote.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                
                 <FormField
                    control={form.control}
                    name="nextDaysStartHour"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Horário de Início (Próximos Dias)</FormLabel>
                            <FormControl>
                                <Input type="time" {...field} value={field.value || ''} />
                            </FormControl>
                            <FormDescription className="text-xs">
                                Horário para iniciar os lotes dos dias seguintes.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        </div>

      </CardContent>
    </Card>
  );
}
