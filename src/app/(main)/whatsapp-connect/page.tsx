'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PageHeader, PageHeaderHeading, PageHeaderDescription } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, QrCode, Smartphone, CheckCircle2, RefreshCw, LogOut, Link as LinkIcon, Wifi, WifiOff, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { connectInstance, disconnectInstance, initInstance, forceDeleteInstance, setWebhook } from '@/app/actions/whatsapp-actions';
import { useToast } from '@/hooks/use-toast';
import { InstanceStatus } from '@/lib/uazapi-types';
import { useUser, useFirestore } from '@/firebase/provider';
import { doc, onSnapshot, updateDoc, deleteField, setDoc, getDoc } from 'firebase/firestore';
import { cn } from '@/lib/utils';

// Helper to check connection status
const checkIsConnected = (statusStr?: string) => {
    return ['connected', 'open', 'authenticated', 'ready'].includes(statusStr || '');
};

export default function WhatsAppConnectPage() {
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  
  // State
  const [instanceName, setInstanceName] = useState('');
  const [instanceToken, setInstanceToken] = useState('');
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const isInitializingRef = useRef(false);

  // Manual Instance Creation Handler
  const handleCreateInstance = useCallback(async () => {
      console.log("[Client] Connect button clicked");
      
      if (!user) {
          toast({ variant: "destructive", title: "Erro de Sessão", description: "Usuário não identificado. Recarregue a página." });
          return;
      }
      
      // Prevent multiple clicks
      if (isInitializingRef.current || isInitializing) {
          console.warn("[Client] Already initializing");
          return;
      }
      
      try {
        isInitializingRef.current = true;
        setIsInitializing(true);
        toast({ title: "Iniciando", description: "Configurando ambiente seguro..." });

        const generatedName = user.uid;
        const webhookUrl = `${window.location.origin}/api/webhooks/whatsapp`;
        
        // --- STRICT FLOW ORCHESTRATION ---
        
        // 1. Force Cleanup (Ensure clean slate)
        console.log("[Client] Step 1: Cleanup");
        await forceDeleteInstance(generatedName);
        
        // 2. Init Instance (Create)
        console.log("[Client] Step 2: Init Instance");
        let initRes = await initInstance(generatedName);
        if (initRes.error) {
            // Retry logic
            if (initRes.error.includes('already exists') || initRes.error.includes('409')) {
                await new Promise(r => setTimeout(r, 2000));
                initRes = await initInstance(generatedName);
            }
        }
        
        if (initRes.error) {
             throw new Error(initRes.error);
        }
        
        const token = initRes.token || initRes.hash || initRes.instance?.token || initRes.instance?.hash;
        if (!token) throw new Error("Falha ao obter token da instância");

        // 3. Save Token (Client Side - Authenticated)
        // MUST happen before Webhook so webhook handler can find the user
        console.log("[Client] Step 3: Save Token");
        await setDoc(doc(firestore, 'users', user.uid), {
            uazapi: {
                instanceName: generatedName,
                token: token,
                createdAt: new Date().toISOString(),
                status: 'created'
            }
        }, { merge: true });
        
        // Update local state immediately
        setInstanceName(generatedName);
        setInstanceToken(token);

        // 4. Configure Webhook
        console.log("[Client] Step 4: Set Webhook");
        const webhookRes = await setWebhook(generatedName, token, webhookUrl);
        if (webhookRes.error) {
            console.warn("Webhook warning:", webhookRes.error);
        }

        // 5. Connect (Generate QR)
        console.log("[Client] Step 5: Generate QR");
        const connectRes = await connectInstance(generatedName, token);
        if (connectRes.error) {
             throw new Error(connectRes.error);
        }

        const qrCode = connectRes.qrcode || connectRes.base64 || connectRes.instance?.qrcode || connectRes.instance?.base64;
        
        if (qrCode) {
            setStatus((prev) => ({
                ...prev,
                qrCode: qrCode,
                status: 'disconnected' // Will be updated by webhook
            } as InstanceStatus));
        }

        toast({ title: "Instância Criada", description: "Conecte seu WhatsApp agora." });
        
        // 6. Timeout Cleanup Monitor (Client Side)
        setTimeout(async () => {
             console.log("[Client] Checking connection timeout...");
             try {
                 const userDocSnap = await getDoc(doc(firestore, 'users', user.uid));
                 if (userDocSnap.exists()) {
                     const d = userDocSnap.data();
                     const currentStatus = d.uazapi?.status;
                     if (currentStatus !== 'connected' && currentStatus !== 'open') {
                         console.log("[Client] Timeout reached. Cleaning up...");
                         toast({ variant: "destructive", title: "Tempo Esgotado", description: "Conexão não detectada. Tentando limpar..." });
                         await handleDisconnect(); // Re-use disconnect logic
                     }
                 }
             } catch (e) {
                 console.error("Timeout check failed", e);
             }
        }, 60000);

      } catch (e: any) {
          console.error("Setup exception", e);
          toast({ variant: "destructive", title: "Erro na Inicialização", description: e.message || "Ocorreu um erro ao criar a instância." });
          // Cleanup if possible
          await handleDisconnect();
      } finally {
          isInitializingRef.current = false;
          setIsInitializing(false);
      }
  }, [user, firestore, toast]);

  // Sync with Firestore
  useEffect(() => {
      if (!user || !firestore) return;

      const userDocRef = doc(firestore, 'users', user.uid);
      const unsubscribe = onSnapshot(userDocRef, (docSnapshot) => {
          if (docSnapshot.exists()) {
              const data = docSnapshot.data();
              if (data.uazapi && data.uazapi.instanceName && data.uazapi.token) {
                  setInstanceName(data.uazapi.instanceName);
                  setInstanceToken(data.uazapi.token);
                  
                  // Update status from Firestore (Webhook updates)
                  if (data.uazapi.status || data.uazapi.qrCode) {
                      setStatus(prev => ({
                          ...prev,
                          status: data.uazapi.status || prev?.status || 'disconnected',
                          qrCode: data.uazapi.qrCode || (data.uazapi.status === 'connected' ? undefined : prev?.qrCode),
                          profilePictureUrl: prev?.profilePictureUrl, // Preserve if available
                          profileName: prev?.profileName
                      } as InstanceStatus));
                  }
              }
          }
      });

      return () => unsubscribe();
  }, [user, firestore]);

  const isConnected = checkIsConnected(status?.status);

  // Handlers
  const handleGenerateQR = async () => {
     if (!instanceToken) return;
     if (isConnected) return;
     
     setIsLoading(true);
     try {
         const res = await connectInstance(instanceName, instanceToken);
         if (res.error) {
             console.error("GenerateQR error:", res.error);
             // Handle Invalid Token / Instance Not Found
             if (typeof res.error === 'string' && (res.error.includes('401') || res.error.includes('403') || res.error.includes('not found'))) {
                  toast({ variant: "destructive", title: "Sessão Inválida", description: "Reiniciando conexão..." });
                  // Clear state to force re-creation
                  setInstanceToken('');
                  setInstanceName('');
                  setStatus(null);
                  if (user) {
                      await updateDoc(doc(firestore, 'users', user.uid), {
                          uazapi: deleteField()
                      }).catch(() => {});
                  }
             } else {
                 toast({ variant: "destructive", title: "Erro", description: res.error });
             }
         } else {
             // Update QR Code immediately
             const newQr = res.qrcode || res.base64 || res.instance?.qrcode || res.instance?.base64;
             if (newQr) {
                 setStatus(prev => ({
                     ...prev,
                     qrCode: newQr,
                     status: 'qrcode'
                 } as InstanceStatus));
             }
             toast({ title: "Gerado", description: "Aguarde o QR Code..." });
         }
     } finally {
         setIsLoading(false);
     }
  };

  const handleDisconnect = async () => {
      if (!instanceName || !instanceToken) return;
      setIsLoading(true);
      try {
          await disconnectInstance(instanceName, instanceToken);
          if (user) {
              await updateDoc(doc(firestore, 'users', user.uid), {
                  uazapi: deleteField()
              });
          }
          setInstanceToken('');
          setInstanceName('');
          setStatus(null);
          toast({ title: "Desconectado", description: "Instância removida." });
      } catch (e) {
          console.error(e);
          toast({ variant: "destructive", title: "Erro", description: "Falha ao desconectar." });
      } finally {
          setIsLoading(false);
      }
  };

  if (isUserLoading || (isInitializing && !instanceName)) {
      return (
          <div className="flex h-[80vh] w-full flex-col items-center justify-center gap-4">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="absolute inset-0 animate-ping rounded-full bg-primary/20 delay-150 duration-1000" />
              </div>
              <p className="animate-pulse text-sm font-medium text-muted-foreground">Preparando ambiente seguro...</p>
          </div>
      );
  }

  return (
    <div className="container max-w-6xl px-4 py-8 md:px-6 lg:py-10 animate-in fade-in duration-500">
      <div className="mb-10 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Conexão WhatsApp</h1>
            <p className="text-muted-foreground">Gerencie a conexão da sua instância para automação de mensagens.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-secondary/50 px-4 py-1.5 backdrop-blur-sm">
             <div className={cn("h-2.5 w-2.5 rounded-full", isConnected ? "bg-green-500 animate-pulse" : "bg-amber-500")} />
             <span className="text-sm font-medium text-secondary-foreground">
                 {isConnected ? "Sistema Operacional" : "Aguardando Vínculo"}
             </span>
          </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Status & Device Info */}
        <div className="lg:col-span-5 space-y-6">
            <Card className="overflow-hidden border-none shadow-lg bg-gradient-to-br from-background to-secondary/20">
                <div className="absolute inset-0 bg-grid-white/10 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))]" />
                <CardHeader className="relative pb-0">
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        Status da Sessão
                    </CardTitle>
                </CardHeader>
                <CardContent className="relative pt-6">
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                        <div className={cn(
                            "relative mb-4 flex h-24 w-24 items-center justify-center rounded-full border-4 transition-colors duration-500",
                            isConnected ? "border-green-100 bg-green-50" : "border-amber-100 bg-amber-50"
                        )}>
                            {isConnected && status?.profilePictureUrl ? (
                                <Image 
                                    src={status.profilePictureUrl} 
                                    alt="Profile" 
                                    width={96} 
                                    height={96} 
                                    className="rounded-full object-cover h-full w-full p-1" 
                                />
                            ) : isConnected ? (
                                <CheckCircle2 className="h-10 w-10 text-green-600" />
                            ) : (
                                <WifiOff className="h-10 w-10 text-amber-500" />
                            )}
                            
                            {isConnected && (
                                <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 ring-4 ring-background">
                                    <Wifi className="h-3 w-3 text-white" />
                                </span>
                            )}
                        </div>

                        <h3 className="text-xl font-bold text-foreground">
                            {isConnected ? (status?.profileName || 'WhatsApp Business') : 'Desconectado'}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {isConnected ? (status?.phone || status?.id || 'Sessão Ativa') : 'Nenhuma sessão ativa detectada'}
                        </p>

                        {!isConnected && (
                             <div className="mt-6 w-full rounded-lg bg-amber-50/50 p-3 text-sm text-amber-800 border border-amber-100/50">
                                <p className="font-medium">Ação Necessária</p>
                                <p className="text-amber-700/80 mt-1">Escaneie o QR Code ao lado para iniciar.</p>
                             </div>
                        )}
                    </div>
                </CardContent>
                {isConnected && (
                    <CardFooter className="relative bg-muted/30 p-4">
                        <Button 
                            variant="destructive" 
                            onClick={handleDisconnect} 
                            disabled={isLoading} 
                            className="w-full transition-all hover:bg-red-600"
                        >
                            <LogOut className="mr-2 h-4 w-4" /> 
                            {isLoading ? 'Encerrando...' : 'Desconectar Sessão'}
                        </Button>
                    </CardFooter>
                )}
            </Card>

            {/* Features / Instructions List */}
            <div className="space-y-4 pl-2">
                <div className="flex gap-4 items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">1</div>
                    <div>
                        <h4 className="font-medium">Abra o WhatsApp</h4>
                        <p className="text-sm text-muted-foreground">No seu celular, toque em Menu ou Configurações.</p>
                    </div>
                </div>
                <div className="flex gap-4 items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">2</div>
                    <div>
                        <h4 className="font-medium">Dispositivos Conectados</h4>
                        <p className="text-sm text-muted-foreground">Toque em "Conectar um aparelho".</p>
                    </div>
                </div>
                <div className="flex gap-4 items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">3</div>
                    <div>
                        <h4 className="font-medium">Escaneie o Código</h4>
                        <p className="text-sm text-muted-foreground">Aponte a câmera para o QR Code na tela.</p>
                    </div>
                </div>
            </div>
        </div>

        {/* Right Column: Connection Interface */}
        <div className="lg:col-span-7">
            {instanceToken && !isConnected ? (
                <Card className="h-full border-none shadow-lg overflow-hidden">
                    <div className="h-2 w-full bg-gradient-to-r from-primary/50 to-emerald-400" />
                    <CardHeader>
                        <CardTitle>Vincular Novo Dispositivo</CardTitle>
                        <CardDescription>Escaneie o QR Code para conectar.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="p-6 min-h-[400px] flex flex-col justify-center">
                            <div className="flex flex-col items-center justify-center">
                                <div className="relative flex h-72 w-72 items-center justify-center rounded-3xl bg-white p-4 shadow-inner ring-1 ring-black/5">
                                    {status?.qrCode ? (
                                        <div className="relative h-full w-full overflow-hidden rounded-xl">
                                            <Image 
                                                src={status.qrCode.startsWith('data:image') ? status.qrCode : `data:image/png;base64,${status.qrCode}`}
                                                alt="QR Code" 
                                                fill
                                                className="object-contain"
                                            />
                                            {/* Scanning Line Animation */}
                                            <div className="absolute inset-x-0 top-0 h-1 bg-primary/50 shadow-[0_0_20px_rgba(37,211,102,0.6)] animate-scan" />
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-muted-foreground/50">
                                            <QrCode className="h-20 w-20 opacity-20" />
                                            <p className="mt-4 text-sm font-medium">Aguardando geração...</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mt-8 max-w-sm mx-auto w-full">
                                <Button 
                                    onClick={handleGenerateQR} 
                                    disabled={isLoading} 
                                    className="w-full h-12 text-base font-medium transition-transform active:scale-[0.98]"
                                    size="lg"
                                >
                                    {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
                                    {status?.qrCode ? 'Atualizar QR Code' : 'Gerar QR Code'}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : isConnected ? (
                 <Card className="flex h-full flex-col items-center justify-center border-none shadow-none bg-transparent">
                    <div className="text-center space-y-4 max-w-md mx-auto">
                        <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-green-100/50 ring-8 ring-green-50">
                            <div className="relative">
                                <Smartphone className="h-16 w-16 text-green-600" />
                                <div className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-green-500 ring-4 ring-white flex items-center justify-center">
                                    <CheckCircle2 className="h-4 w-4 text-white" />
                                </div>
                            </div>
                        </div>
                        <h2 className="text-3xl font-bold tracking-tight text-foreground">Tudo Pronto!</h2>
                        <p className="text-lg text-muted-foreground">
                            Sua instância do WhatsApp está conectada e sincronizada com sucesso. Você já pode iniciar suas campanhas.
                        </p>
                    </div>
                </Card>
            ) : (
                <Card className="h-full border-none shadow-lg flex flex-col items-center justify-center p-8 text-center space-y-6 bg-muted/10">
                    <div className="bg-primary/10 p-6 rounded-full">
                         <Smartphone className="h-12 w-12 text-primary" />
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-xl font-bold">Conectar WhatsApp</h3>
                        <p className="text-muted-foreground max-w-sm">
                            Nenhuma instância ativa encontrada. Clique abaixo para criar uma nova conexão e sincronizar suas mensagens.
                        </p>
                    </div>
                    <Button 
                        onClick={(e) => {
                            e.preventDefault();
                            handleCreateInstance();
                        }} 
                        disabled={isInitializing} 
                        size="lg" 
                        className="px-8 z-50 relative cursor-pointer"
                    >
                        {isInitializing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
                        {isInitializing ? 'Processando...' : 'Conectar WhatsApp'}
                    </Button>
                 </Card>
            )}
        </div>
      </div>
    </div>
  );
}
