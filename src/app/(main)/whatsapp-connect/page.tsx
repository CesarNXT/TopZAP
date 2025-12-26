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
    deleteInstanceByToken,
    checkInstanceStatus,
    cleanupInstanceByName
} from '@/app/actions/whatsapp-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  createdAt?: string | number | Date;
}

export default function WhatsAppConnectPage() {
    const { user, isUserLoading } = useUser(); // Changed hook
    const firestore = useFirestore(); // Added firestore hook
    const { toast } = useToast();
    
    // State
    const [status, setStatus] = useState<InstanceStatus | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [connectionStep, setConnectionStep] = useState('');
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    
    // Refs for cleanup
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const isConnectingRef = useRef(false);

    // 1. Sync with Firestore (Real-time updates)
    useEffect(() => {
        if (isUserLoading) return;
        if (!user || !firestore) {
            setIsInitialLoading(false);
            return;
        }

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
                        setIsLoading(false);
                    } else if (uazapi.status === 'connecting' && uazapi.qrCode) {
                        // Calculate remaining time based on creation time
                        if (uazapi.createdAt) {
                            const createdTime = new Date(uazapi.createdAt).getTime();
                            const now = new Date().getTime();
                            const elapsedSeconds = Math.floor((now - createdTime) / 1000);
                            const maxDuration = 70; // 70 seconds validity
                            const remaining = maxDuration - elapsedSeconds;

                            if (remaining <= 0) {
                                console.log("[Client] QR Code expired based on timestamp. Resetting...");
                                // Auto-clear immediately if expired
                                updateDoc(doc(firestore, 'users', user.uid), {
                                    'uazapi.qrCode': deleteField(),
                                    'uazapi.status': 'disconnected',
                                    'uazapi.connected': false,
                                    'uazapi.createdAt': deleteField()
                                }).catch(console.error);
                                setTimeLeft(null);
                            } else {
                                // Update timer with actual remaining time
                                setTimeLeft(remaining);
                            }
                        } else {
                            // Fallback if no timestamp (legacy)
                            setTimeLeft(prev => prev === null ? 70 : prev);
                        }
                    }
                } else {
                    setStatus(null);
                }
            } else {
                setStatus(null);
            }
            // Mark initial load as done after first snapshot
            setIsInitialLoading(false);
        }, (error) => {
            console.error("Firestore snapshot error:", error);
            setIsInitialLoading(false);
        });
        
        return () => unsubscribe();
    }, [user, firestore, isUserLoading]);

    // Generic cleanup function
    const resetConnectionState = useCallback(async (showTimeoutToast = false) => {
        console.log(`[Client] Resetting connection state. Timeout: ${showTimeoutToast}`);
        setTimeLeft(null);
        setIsLoading(false);
        setConnectionStep('');
        
        if (showTimeoutToast) {
            toast({ 
                variant: "destructive", 
                title: "Tempo Esgotado", 
                description: "O tempo de exibição do QR Code expirou." 
            });
        }

        // Restore deletion logic as per user request
        if (user && status?.instanceName) {
            try {
                // Delete from provider
                console.log("[Client] Deleting instance due to reset/timeout...");
                await forceDeleteInstance(status.instanceName);
                
                // Clear firestore state
                await updateDoc(doc(firestore, 'users', user.uid), {
                    'uazapi.connected': false,
                    'uazapi.status': 'disconnected',
                    'uazapi.qrCode': deleteField(),
                    'uazapi.token': deleteField(),
                    'uazapi.instanceName': deleteField(),
                    'uazapi.createdAt': deleteField(),
                });
            } catch (error) {
                console.error("Cleanup error:", error);
            }
        }
        
        setStatus(null);
    }, [user, firestore, status, toast]);

    // Cleanup function when timeout is reached
    const handleTimeoutCleanup = useCallback(async () => {
        console.log("[Client] Timeout reached. Soft resetting local view (keeping instance for Webhook)...");
        
        // Soft reset: Just clear QR from UI, don't delete instance
        // This allows late webhooks to still connect us
        if (user) {
             try {
                await updateDoc(doc(firestore, 'users', user.uid), {
                    'uazapi.qrCode': deleteField(),
                    // We DO NOT change status to disconnected here, 
                    // because we want to see if a webhook comes late.
                    // But if we leave it 'connecting' without QR, it looks like a loading state.
                    // Let's set it to 'disconnected' locally so user can try again,
                    // BUT we do NOT call forceDeleteInstance.
                    'uazapi.status': 'disconnected',
                    'uazapi.connected': false,
                });
                
                toast({ 
                    variant: "destructive", 
                    title: "Tempo Esgotado", 
                    description: "O QR Code expirou. Tente novamente." 
                });
             } catch (e) {
                 console.error("Soft reset failed:", e);
             }
        }
        
        // Reset local state vars
        setTimeLeft(null);
        setIsLoading(false);
        setConnectionStep('');
        
    }, [user, firestore, toast]);

    // 2. Countdown Timer Logic (Increased to 90s)
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

    // Manual Status Check
    const checkStatus = async () => {
        if (!user || !status?.instanceName || !status?.token) return;
        
        toast({ title: "Verificando...", description: "Consultando status no servidor..." });
        
        try {
            const res = await checkInstanceStatus(status.instanceName, status.token);
            if (res.error) {
                 toast({ variant: "destructive", title: "Erro", description: res.error });
                 return;
            }
            
            console.log("[Client] Status Check Result:", res);
            
            // If connected, update firestore
            if (res.connectionState === 'open' || res.connectionState === 'connected') {
                await updateDoc(doc(firestore, 'users', user.uid), {
                    'uazapi.connected': true,
                    'uazapi.status': 'connected',
                    'uazapi.qrCode': deleteField(),
                });
                toast({ title: "Conectado!", description: "Sincronização realizada com sucesso." });
            } else {
                toast({ 
                    variant: "warning", 
                    title: "Ainda não conectado", 
                    description: `Status atual: ${res.connectionState || 'Desconhecido'}` 
                });
            }
        } catch (error: any) {
            console.error("Check status failed:", error);
            toast({ variant: "destructive", title: "Erro", description: "Falha ao verificar status." });
        }
    };

    // 3. Main Connection Flow
    const handleConnect = async () => {
        if (!user || !firestore) return;
        if (isConnectingRef.current) return;

        // Validation for Ngrok on Localhost
        // Using env var now, so no UI validation needed
        
        try {
            setIsLoading(true);
            isConnectingRef.current = true;
            const instanceName = user.uid;
            
            // Construct Webhook URL
            let baseUrl = window.location.origin;
            
            // Override with Ngrok URL ONLY if we are on localhost
            // This ensures production uses the real domain, while local dev uses the tunnel
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const envNgrokUrl = process.env.NEXT_PUBLIC_NGROK_URL;
            
            if (isLocalhost && envNgrokUrl) {
                 console.log("[Client] Localhost detected, using Ngrok URL for webhook.");
                 baseUrl = envNgrokUrl.replace(/\/$/, '');
                 if (!baseUrl.startsWith('http')) {
                     baseUrl = `https://${baseUrl}`;
                 }
            } else {
                 console.log("[Client] Production/Server detected, using current origin for webhook.");
            }

            const webhookUrl = `${baseUrl}/api/webhooks/whatsapp`;

            // Step 1: Check if instance already exists (to avoid duplicates)
            // User requested explicit check and clean: "primeiro desconectar a instancia e depois vc tem que apagar"
            setConnectionStep('Verificando e limpando instâncias...');
            
            // 1. Cleanup OLD session if it exists in our records (and is different from target)
            if (status?.instanceName && status.instanceName !== instanceName) {
                 console.log(`[Client] Cleaning up different old instance: ${status.instanceName}`);
                 await cleanupInstanceByName(status.instanceName);
                 await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 2. Cleanup TARGET session name (to ensure we can create it fresh)
            // Robust cleanup: List -> Find -> Logout -> Delete
            await cleanupInstanceByName(instanceName);
            
            // Add a safety delay to ensure the API has fully processed the deletion
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Step 2: Init Instance
            setConnectionStep('Criando nova instância...');
            let initRes = await initInstance(instanceName, webhookUrl);
            
            // Retry once if 409/Exists error happens (race condition)
            if (initRes.error && (initRes.error.includes('exists') || initRes.error.includes('409'))) {
                console.log("[Client] Instance exists, trying to force delete again and retry...");
                setConnectionStep('Tentando limpar novamente...');
                await forceDeleteInstance(instanceName);
                await new Promise(r => setTimeout(r, 2000)); // Wait longer for cleanup
                initRes = await initInstance(instanceName, webhookUrl);
            }

            if (initRes.error) throw new Error(initRes.error);
            const token = initRes.token || initRes.hash || initRes.instance?.token;
            
            // IMPORTANT: Capture the ACTUAL instance name returned by the API
            // Some providers generate a random ID or sanitize the name
            const actualInstanceName = initRes.instance?.instanceName || initRes.instance?.name || instanceName;
            
            console.log(`[Client] Instance initialized. Requested: ${instanceName}, Actual: ${actualInstanceName}`);

            if (!token) throw new Error("Token não retornado pela API");

            // Step 3: Save Token (Client Side)
            setConnectionStep('Salvando credenciais...');
            await setDoc(doc(firestore, 'users', user.uid), {
                uazapi: {
                    instanceName: actualInstanceName, // Use actual name
                    token,
                    status: 'created',
                    connected: false,
                    createdAt: new Date().toISOString()
                }
            }, { merge: true });

            // Step 4: Webhook
            setConnectionStep('Configurando webhook...');
            const webhookRes = await setWebhook(actualInstanceName, token, webhookUrl);
            
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
            const connectRes = await connectInstance(actualInstanceName, token);
            if (connectRes.error) throw new Error(connectRes.error);

            const qrCode = connectRes.qrcode || connectRes.base64 || connectRes.instance?.qrcode;
            
            if (qrCode) {
                // Update Firestore with QR (triggering UI update via effect)
                await updateDoc(doc(firestore, 'users', user.uid), {
                    'uazapi.qrCode': qrCode,
                    'uazapi.status': 'connecting',
                    'uazapi.connected': false,
                    'uazapi.instanceName': actualInstanceName // Ensure it's saved here too
                });
                
                setTimeLeft(70); // Set to 70 seconds as requested
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
            // Reset state without showing "Timeout" message
            resetConnectionState(false);
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
            // Use robust cleanup to ensure all duplicates are removed (Logout -> Delete)
            await cleanupInstanceByName(status.instanceName);

            // Finally, clean up local state
            await updateDoc(doc(firestore, 'users', user.uid), {
                'uazapi.connected': false,
                'uazapi.status': 'disconnected',
                'uazapi.qrCode': deleteField(),
                'uazapi.token': deleteField(),
                // We keep instanceName usually, but if we want a FULL reset, we might want to clear it too?
                // The init function recreates it based on UID anyway.
                // 'uazapi.instanceName': deleteField(), 
            });
            setStatus(null);
            toast({ title: "Desconectado", description: "Instância removida e resetada com sucesso." });
        } catch (error) {
            console.error("Disconnect error", error);
            toast({ variant: "destructive", title: "Erro", description: "Falha ao desconectar." });
        } finally {
            setIsLoading(false);
            setConnectionStep('');
            isConnectingRef.current = false;
        }
    };

    // 4. Stale State Detection (Fix for "Stuck" UI)
    useEffect(() => {
        // Only run if we have a user and status is 'connecting'
        // And we are NOT currently running a timer (which means this is a fresh page load or stale state)
        if (user && firestore && status?.status === 'connecting' && timeLeft === null && !isConnectingRef.current) {
            console.log("[Client] Detected potentially stale 'connecting' state. Verifying...");
            
            const verifyAndClean = async () => {
                // If missing critical data, just clean
                if (!status.instanceName || !status.token) {
                    console.log("[Client] Missing instance data. Cleaning up.");
                    await handleDisconnect();
                    return;
                }

                try {
                    // Check real status
                    const res = await checkInstanceStatus(status.instanceName, status.token);
                    console.log("[Client] Stale check result:", res);

                    if (res.error || (res.connectionState !== 'open' && res.connectionState !== 'connecting')) {
                        // If instance is gone (404) or not connecting, we should reset.
                        // Even if it says 'connecting' in backend, if we don't have the QR code locally (or it's old),
                        // we can't show it. But status has qrCode. 
                        // However, UAZAPI QR codes expire. If this is a page reload, the QR is likely dead.
                        
                        console.log("[Client] State invalid or expired. Resetting.");
                        await handleDisconnect();
                        toast({
                            title: "Sessão Reiniciada",
                            description: "A tentativa de conexão anterior expirou.",
                        });
                    } else if (res.connectionState === 'open') {
                        // It connected while we were away!
                        await updateDoc(doc(firestore, 'users', user.uid), {
                            'uazapi.connected': true,
                            'uazapi.status': 'connected',
                            'uazapi.qrCode': deleteField(),
                        });
                        toast({ title: "Conectado!", description: "Sincronização recuperada com sucesso." });
                    }
                } catch (e) {
                    console.error("[Client] Error verifying stale state:", e);
                    await handleDisconnect();
                }
            };

            verifyAndClean();
        }
    }, [status?.status, user, firestore]); // Dependencies allow running when status loads

    // 5. Automatic Status Polling - REMOVED per user request to rely on Webhooks
    // Previously checked every 10s/30min. Now we wait for Firestore updates via Webhook.

    // Render Logic
    const isConnected = status?.connected === true || status?.status === 'connected';
    // Only show QR Code if we have it AND the timer is active. 
    // If timer is null (expired), we treat it as no QR code so the UI resets.
    const hasQrCode = !!status?.qrCode && !isConnected && timeLeft !== null;

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
                                        <span>Expira em {timeLeft !== null ? timeLeft : '--'} segundos</span>
                                    </div>
                                    
                                    <div className="flex flex-col gap-2 w-full pt-2">
                                        <p className="text-xs text-center text-muted-foreground animate-pulse">
                                            Aguardando confirmação automática via Webhook...
                                        </p>
                                    </div>
                                </div>
                            ) : isLoading ? (
                                /* Loading State */
                                <div className="flex h-48 w-full flex-col items-center justify-center rounded-xl bg-slate-50/50 border border-dashed border-slate-200 p-6 text-center">
                                        <div className="space-y-4">
                                            <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
                                                <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                                                <Loader2 className="relative h-8 w-8 animate-spin text-primary" />
                                            </div>
                                            <p className="text-sm font-medium text-muted-foreground animate-pulse">
                                                {connectionStep}
                                            </p>
                                        </div>
                                </div>
                            ) : (
                                /* Initial State: Button to Connect */
                                <div className="flex flex-col items-center justify-center space-y-6 py-8">
                                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 ring-8 ring-slate-50">
                                        <QrCode className="h-10 w-10 text-slate-400" />
                                    </div>
                                    <div className="text-center space-y-2 max-w-sm">
                                        <h3 className="text-lg font-medium text-slate-900">
                                            {status?.status === 'disconnected' ? "Instância Desconectada" : "Nenhuma conexão ativa"}
                                        </h3>
                                        <p className="text-sm text-slate-500">
                                            {status?.status === 'disconnected' 
                                                ? "Sua instância foi desconectada. Gere um novo QR Code para reconectar."
                                                : "Clique no botão abaixo para gerar um novo QR Code e conectar seu WhatsApp."}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Instructions (Only if not loading and no QR) */}
                            {!isLoading && !hasQrCode && (
                                <div className="w-full space-y-4">
                                    <Alert>
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>Importante</AlertTitle>
                                        <AlertDescription>
                                            Use o <strong>WhatsApp Business</strong> para maior estabilidade.
                                            Tenha o celular em mãos.
                                        </AlertDescription>
                                    </Alert>
                                </div>
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
