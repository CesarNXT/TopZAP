'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser, useFirestore } from '@/firebase'; // Changed import
// import { db } from '@/lib/firebase-client'; // Removed invalid import
import { doc, onSnapshot, setDoc, deleteField, updateDoc, getDoc } from 'firebase/firestore';
import { 
    initInstance, 
    connectInstance, 
    disconnectInstance, 
    setWebhook, 
    forceDeleteInstance,
    deleteInstanceByToken
} from '@/app/actions/whatsapp-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Loader2, QrCode, Smartphone, CheckCircle2, AlertCircle, RefreshCw, Timer, LogOut } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

// Types
interface InstanceStatus {
  status?: 'connecting' | 'connected' | 'disconnected' | 'created';
  qrCode?: string;
  instanceName?: string;
  profileName?: string;
  profilePictureUrl?: string;
  token?: string;
  connected?: boolean;
}

export default function WhatsAppConnectPage() {
    const { user } = useUser(); // Changed hook
    const firestore = useFirestore(); // Added firestore hook
    const { toast } = useToast();
    
    // State
    const [status, setStatus] = useState<InstanceStatus | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [connectionStep, setConnectionStep] = useState('');
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    
    // Refs for cleanup
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const isConnectingRef = useRef(false);

    // 1. Sync with Firestore (Real-time updates)
    useEffect(() => {
        if (!user || !firestore) return;

        const unsubscribe = onSnapshot(doc(firestore, 'users', user.uid), (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                const uazapi = data.uazapi as InstanceStatus | undefined;

                if (uazapi) {
                    setStatus(prev => ({
                        ...prev,
                        ...uazapi,
                        // Prefer Firestore status, but fallback to local if needed
                        status: uazapi.status || 'disconnected'
                    }));

                    // Stop timer if connected
                    if (uazapi.status === 'connected') {
                        if (timerRef.current) clearInterval(timerRef.current);
                        setTimeLeft(null);
                        isConnectingRef.current = false;
                    }
                } else {
                    setStatus(null);
                }
            }
        });

        return () => unsubscribe();
    }, [user]);

    // Cleanup function when timeout is reached
    const handleTimeoutCleanup = useCallback(async () => {
        console.log("[Client] Timeout reached. Cleaning up...");
        setTimeLeft(null);
        setIsLoading(false);
        setConnectionStep('');
        
        toast({ 
            variant: "destructive", 
            title: "Tempo Esgotado", 
            description: "O QR Code expirou. Por favor, tente novamente." 
        });

        if (user && status?.instanceName && status?.token) {
            await updateDoc(doc(firestore, 'users', user.uid), {
                'uazapi.connected': false,
                'uazapi.status': 'disconnected',
                'uazapi.qrCode': deleteField(),
            });
            setTimeout(async () => {
                try {
                    await deleteInstanceByToken(status.token!);
                    await updateDoc(doc(firestore, 'users', user.uid), {
                        'uazapi.token': deleteField(),
                    });
                    await forceDeleteInstance(status.instanceName!);
                } catch (error) {
                    console.error("Cleanup error:", error);
                }
            }, 10000);
        } else if (user) {
            await updateDoc(doc(firestore, 'users', user.uid), {
                'uazapi.connected': false,
                'uazapi.status': 'disconnected',
                'uazapi.qrCode': deleteField(),
                'uazapi.token': deleteField(),
            });
            setTimeout(async () => {
                try {
                    await forceDeleteInstance(user.uid);
                } catch (error) {
                    console.error("Cleanup error:", error);
                }
            }, 10000);
        }
        
        setStatus(null);
    }, [user, firestore, status, toast]);

    // 2. Countdown Timer Logic (40s QR + 50s deletion)
    useEffect(() => {
        if (timeLeft === null) return;

        if (timeLeft === 0) {
            handleTimeoutCleanup();
            return;
        }

        timerRef.current = setTimeout(() => {
            setTimeLeft(prev => (prev !== null ? prev - 1 : null));
        }, 1000);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [timeLeft, handleTimeoutCleanup]);

    // 3. Main Connection Flow
    const handleConnect = async () => {
        if (!user || !firestore) return;
        if (isConnectingRef.current) return;

        try {
            setIsLoading(true);
            isConnectingRef.current = true;
            const instanceName = user.uid;
            const webhookUrl = `${window.location.origin}/api/webhooks/whatsapp`;

            // Step 1: Check if instance already exists (to avoid duplicates)
            setConnectionStep('Verificando instâncias existentes...');
            // We use a safe check - if we can't delete it (404), it doesn't exist
            await forceDeleteInstance(instanceName);

            // Step 2: Init Instance
            setConnectionStep('Criando nova instância...');
            let initRes = await initInstance(instanceName, webhookUrl);
            
            // Retry once if 409/Exists error happens (race condition)
            if (initRes.error && (initRes.error.includes('exists') || initRes.error.includes('409'))) {
                console.log("[Client] Instance exists, trying to force delete again and retry...");
                await forceDeleteInstance(instanceName);
                await new Promise(r => setTimeout(r, 2000)); // Wait for cleanup
                initRes = await initInstance(instanceName, webhookUrl);
            }

            if (initRes.error) throw new Error(initRes.error);
            const token = initRes.token || initRes.hash || initRes.instance?.token;
            if (!token) throw new Error("Token não retornado pela API");

            // Step 3: Save Token (Client Side)
            setConnectionStep('Salvando credenciais...');
            await setDoc(doc(firestore, 'users', user.uid), {
                uazapi: {
                    instanceName,
                    token,
                    status: 'created',
                    connected: false,
                    createdAt: new Date().toISOString()
                }
            }, { merge: true });

            // Step 4: Webhook
            setConnectionStep('Configurando webhook...');
            const webhookRes = await setWebhook(instanceName, token, webhookUrl);
            
            if (webhookRes.error) {
                // Log warning but allow flow to continue if it's just a method/config error
                console.warn("Webhook configuration warning:", webhookRes.error);
                if (webhookRes.error.includes('405') || webhookRes.error.includes('not supported')) {
                    // Ignore 405 errors as per user request (flow must continue)
                } else {
                     // For other errors, we might want to throw, but for now let's be permissive
                     // throw new Error(`Webhook erro: ${webhookRes.error}`);
                }
            }

            // Step 5: Connect (Get QR)
            setConnectionStep('Gerando QR Code...');
            const connectRes = await connectInstance(instanceName, token);
            if (connectRes.error) throw new Error(connectRes.error);

            const qrCode = connectRes.qrcode || connectRes.base64 || connectRes.instance?.qrcode;
            
            if (qrCode) {
                // Update Firestore with QR (triggering UI update via effect)
                await updateDoc(doc(firestore, 'users', user.uid), {
                    'uazapi.qrCode': qrCode,
                    'uazapi.status': 'connecting',
                    'uazapi.connected': false
                });
                
                setTimeLeft(40);
                setConnectionStep('Aguardando leitura...');
            } else {
                throw new Error("QR Code não gerado");
            }

        } catch (error: any) {
            console.error("Connection failed:", error);
            toast({
                variant: "destructive",
                title: "Erro na Conexão",
                description: error.message || "Falha ao iniciar conexão."
            });
            handleTimeoutCleanup();
        } finally {
            setIsLoading(false);
            // Note: isConnectingRef stays true until connected or timeout to prevent double clicks
            if (!timeLeft) isConnectingRef.current = false; 
        }
    };

    const handleDisconnect = async () => {
        if (!user || !firestore || !status?.instanceName || !status?.token) return;
        
        setIsLoading(true);
        setConnectionStep('Desconectando...');
        
        try {
            await disconnectInstance(status.instanceName, status.token);
            await updateDoc(doc(firestore, 'users', user.uid), {
                'uazapi.connected': false,
                'uazapi.status': 'disconnected',
                'uazapi.qrCode': deleteField(),
                'uazapi.token': deleteField(),
            });
            setStatus(null);
            toast({ title: "Desconectado", description: "Instância removida com sucesso." });
        } catch (error) {
            console.error("Disconnect error", error);
            toast({ variant: "destructive", title: "Erro", description: "Falha ao desconectar." });
        } finally {
            setIsLoading(false);
            setConnectionStep('');
            isConnectingRef.current = false;
        }
    };

    // Render Logic
    const isConnected = status?.connected === true || status?.status === 'connected';
    const hasQrCode = !!status?.qrCode && !isConnected;

    return (
        <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-8">
            <Card className="w-full max-w-md border-2 shadow-xl">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold">Conexão WhatsApp</CardTitle>
                    <CardDescription>
                        {isConnected 
                            ? "Sua instância está ativa e sincronizada." 
                            : "Vincule seu dispositivo para iniciar."}
                    </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-6">
                    {/* State: Connected */}
                    {isConnected ? (
                        <div className="flex flex-col items-center space-y-4 py-4 animate-in fade-in zoom-in">
                            <div className="relative">
                                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100 ring-4 ring-green-50">
                                    {status?.profilePictureUrl ? (
                                        <Image 
                                            src={status.profilePictureUrl} 
                                            alt="Profile" 
                                            width={96} 
                                            height={96} 
                                            className="h-full w-full rounded-full object-cover"
                                        />
                                    ) : (
                                        <Smartphone className="h-12 w-12 text-green-600" />
                                    )}
                                </div>
                                <div className="absolute -bottom-1 -right-1 rounded-full bg-green-500 p-1.5 ring-4 ring-white">
                                    <CheckCircle2 className="h-4 w-4 text-white" />
                                </div>
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold text-foreground">
                                    {status?.profileName || "WhatsApp Conectado"}
                                </h3>
                                <p className="text-sm text-muted-foreground">Sessão Ativa</p>
                            </div>
                            <Alert className="bg-green-50 text-green-800 border-green-200">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <AlertTitle>Tudo Pronto!</AlertTitle>
                                <AlertDescription>
                                    O sistema está pronto para enviar mensagens.
                                </AlertDescription>
                            </Alert>
                        </div>
                    ) : (
                        /* State: Disconnected / Connecting */
                        <div className="flex flex-col items-center space-y-6">
                            
                            {/* QR Code Area */}
                            {hasQrCode ? (
                                <div className="relative flex flex-col items-center space-y-4 rounded-xl bg-slate-50 p-6 ring-1 ring-slate-200 animate-in fade-in slide-in-from-bottom-4">
                                    <div className="relative h-64 w-64 overflow-hidden rounded-lg bg-white p-2 shadow-sm">
                                        <Image 
                                            src={status?.qrCode!.startsWith('data:image') 
                                                ? status!.qrCode! 
                                                : `data:image/png;base64,${status!.qrCode}`}
                                            alt="QR Code"
                                            fill
                                            className="object-contain"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/5" />
                                        <div className="absolute inset-x-0 top-0 h-0.5 bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)] animate-scan" />
                                    </div>
                                    
                                    <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                                        <Timer className="h-4 w-4 animate-pulse text-amber-500" />
                                        <span>Expira em {timeLeft} segundos</span>
                                    </div>
                                </div>
                            ) : (
                                /* Placeholder / Loading State */
                                <div className="flex h-48 w-full flex-col items-center justify-center rounded-xl bg-slate-50/50 border border-dashed border-slate-200 p-6 text-center">
                                    {isLoading ? (
                                        <div className="space-y-4">
                                            <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
                                                <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                                                <Loader2 className="relative h-8 w-8 animate-spin text-primary" />
                                            </div>
                                            <p className="text-sm font-medium text-muted-foreground animate-pulse">
                                                {connectionStep}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                                                <QrCode className="h-6 w-6 text-slate-400" />
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                Nenhuma conexão ativa.
                                                <br />
                                                Clique abaixo para iniciar.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Instructions (Only if not loading) */}
                            {!isLoading && !hasQrCode && (
                                <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>Importante</AlertTitle>
                                    <AlertDescription>
                                        Use o <strong>WhatsApp Business</strong> para maior estabilidade.
                                        Tenha o celular em mãos.
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>
                    )}
                </CardContent>
                
                <CardFooter className="flex flex-col gap-3 bg-slate-50/50 p-6">
                    {isConnected ? (
                        <Button 
                            variant="destructive" 
                            className="w-full" 
                            onClick={handleDisconnect}
                            disabled={isLoading}
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            Desconectar Instância
                        </Button>
                    ) : (
                        <Button 
                            className={cn("w-full transition-all", hasQrCode ? "bg-slate-800 hover:bg-slate-900" : "")}
                            size="lg"
                            onClick={handleConnect}
                            disabled={isLoading || (hasQrCode && timeLeft !== null)}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Processando...
                                </>
                            ) : hasQrCode ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Aguardando Leitura...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Conectar WhatsApp
                                </>
                            )}
                        </Button>
                    )}
                    
                    {!isConnected && hasQrCode && (
                        <p className="text-xs text-center text-muted-foreground">
                            Não feche esta janela durante a conexão.
                        </p>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
