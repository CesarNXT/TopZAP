'use client';

import { useState, useEffect } from 'react';
import { useUser, useFirestore } from '@/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Key, Check, User as UserIcon, LogOut, ShieldCheck } from 'lucide-react';

import { verifyInstanceConnection, setWebhook, deleteInstanceByToken } from '@/app/actions/whatsapp-actions';

export function WhatsAppSettings() {
    const { user } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();
    
    const [token, setToken] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaved, setIsSaved] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('');

    useEffect(() => {
        // Set webhook URL based on current origin
        if (typeof window !== 'undefined') {
            const origin = window.location.origin;
            // If localhost, try to use ngrok url from env
            if (origin.includes('localhost') && process.env.NEXT_PUBLIC_NGROK_URL) {
                setWebhookUrl(`${process.env.NEXT_PUBLIC_NGROK_URL}/api/webhooks/whatsapp`);
            } else {
                setWebhookUrl(`${origin}/api/webhooks/whatsapp`);
            }
        }

        if (!user || !firestore) return;

        // Real-time listener for connection status
        const unsubscribe = onSnapshot(doc(firestore, 'users', user.uid), (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                if (data.uazapi?.token) {
                    setToken(data.uazapi.token);
                    // Check if status is connected
                    setIsConnected(data.uazapi.status === 'connected');
                } else {
                    setToken('');
                    setIsConnected(false);
                }
            }
        });

        return () => unsubscribe();
    }, [user, firestore]);

    const handleSave = async () => {
        if (!user || !firestore) return;
        if (!token.trim()) {
            toast({
                variant: "destructive",
                title: "Erro",
                description: "O token não pode estar vazio."
            });
            return;
        }

        setIsLoading(true);
        try {
            // 1. Verify token and connection status via Server Action
            const result = await verifyInstanceConnection(token.trim());

            if (result.error || !result.success) {
                toast({
                    variant: "destructive",
                    title: "Erro de Conexão",
                    description: result.error || "Não foi possível verificar a instância."
                });
                
                // If specific instruction needed based on error (e.g. not connected)
                if (result.status && result.status !== 'connected') {
                     toast({
                        variant: "destructive",
                        title: "Instância Desconectada",
                        description: "Sua instância não está conectada. Por favor, conecte seu WhatsApp na UAZAPI ou contate o suporte."
                    });
                }
                return;
            }

            const instanceData = result.data;
            const instanceName = instanceData.name || instanceData.instanceName || 'Unknown';

            // 2. Configure Webhook automatically
            let webhookSuccess = false;
            if (webhookUrl) {
                const webhookResult = await setWebhook(instanceName, token.trim(), webhookUrl);
                if (webhookResult.error) {
                    console.error("Webhook configuration failed:", webhookResult.error);
                    toast({
                        variant: "warning",
                        title: "Aviso do Webhook",
                        description: `Token válido, mas houve erro ao configurar webhook: ${webhookResult.error}. Verifique se a URL está acessível.`
                    });
                } else {
                    webhookSuccess = true;
                }
            }

            // 3. Save to Firestore if valid and connected
            await setDoc(doc(firestore, 'users', user.uid), {
                uazapi: {
                    token: token.trim(),
                    connected: true,
                    status: 'connected',
                    instanceName: instanceName,
                    instanceId: instanceData.id,
                    profilePicUrl: instanceData.profilePicUrl,
                    profileName: instanceData.profileName,
                    updatedAt: new Date().toISOString()
                }
            }, { merge: true });

            setIsSaved(true);
            setIsConnected(true);
            toast({
                title: "Sucesso",
                description: webhookSuccess 
                    ? "Token salvo e Webhook configurado com sucesso!" 
                    : "Token salvo com sucesso!"
            });
            
            // Reset success state after a few seconds
            setTimeout(() => setIsSaved(false), 3000);
        } catch (error) {
            console.error("Error saving token:", error);
            toast({
                variant: "destructive",
                title: "Erro ao salvar",
                description: "Não foi possível salvar o token."
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisconnect = async () => {
        if (!user || !firestore || !token) return;
        
        setIsLoading(true);
        try {
            // 1. Call API to delete instance (logout)
            await deleteInstanceByToken(token);
            
            // 2. Update Firestore to remove token and status
            await setDoc(doc(firestore, 'users', user.uid), {
                uazapi: {
                    token: null, // Clear token
                    connected: false,
                    status: 'disconnected',
                    qrCode: null,
                    updatedAt: new Date().toISOString()
                }
            }, { merge: true });
            
            setToken('');
            setIsConnected(false);
            
            toast({
                title: "Desconectado",
                description: "Instância desconectada com sucesso."
            });
            
        } catch (error) {
            console.error("Error disconnecting:", error);
            toast({
                variant: "destructive",
                title: "Erro ao desconectar",
                description: "Houve um erro ao tentar desconectar."
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        {isConnected ? <ShieldCheck className="w-5 h-5 text-green-500" /> : <Key className="w-5 h-5" />}
                        {isConnected ? 'Status da Conexão' : 'Token da API'}
                    </CardTitle>
                    <CardDescription>
                        {isConnected 
                            ? 'Seu WhatsApp está conectado e pronto para uso.' 
                            : 'Informe o token fornecido pela nossa equipe para conectar seu WhatsApp'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {isConnected ? (
                        <div className="flex flex-col items-center justify-center py-6 space-y-4">
                            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full border border-green-200">
                                <span className="relative flex h-3 w-3">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                                </span>
                                <span className="font-medium">Conectado</span>
                            </div>
                            <p className="text-sm text-muted-foreground text-center max-w-md">
                                Você não precisa mais mexer no token. O sistema monitora a conexão automaticamente.
                            </p>
                            <Button 
                                variant="destructive" 
                                onClick={handleDisconnect}
                                disabled={isLoading}
                                className="mt-4"
                            >
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                                Desconectar
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="token" className="text-base">Token</Label>
                                <Input 
                                    id="token" 
                                    type="password"
                                    value={token} 
                                    onChange={(e) => setToken(e.target.value)} 
                                    placeholder="Cole seu token aqui..."
                                    className="h-14 text-lg px-4"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Button 
                                    onClick={handleSave} 
                                    disabled={isLoading} 
                                    size="lg"
                                    className="bg-green-500 hover:bg-green-600 text-white text-base px-8 h-12"
                                >
                                    {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                                    Salvar Token
                                </Button>
                                {isSaved && !isLoading && (
                                    <span className="flex items-center text-green-500 text-sm font-medium animate-in fade-in slide-in-from-left-2">
                                        <Check className="w-4 h-4 mr-1" />
                                        Salvo!
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
