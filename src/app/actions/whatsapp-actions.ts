'use server';

import { InstanceStatus } from '@/lib/uazapi-types';

import { db } from '@/lib/firebase-server';
import { doc, setDoc, updateDoc, deleteField, getDoc } from 'firebase/firestore';

const UAZAPI_URL = process.env.UAZAPI_URL || 'https://atendimento.uazapi.com';
const UAZAPI_ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN;

export async function initInstance(instanceName: string) {
  if (!UAZAPI_ADMIN_TOKEN || UAZAPI_ADMIN_TOKEN === 'admin_token_here') {
      console.error('[UAZAPI] Admin token is missing or default.');
      return { error: 'Configuration Error: Admin Token is missing.' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'AdminToken': UAZAPI_ADMIN_TOKEN,
    'apikey': UAZAPI_ADMIN_TOKEN
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${UAZAPI_URL}/instance/init`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        name: instanceName,
        fingerprintProfile: "chrome",
        browser: "chrome"
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
        return { error: `Failed to init instance: ${response.status} ${responseText}` };
    }

    try {
        const data = JSON.parse(responseText);
        return data;
    } catch (e) {
        return { error: `Invalid JSON response: ${responseText}` };
    }
  } catch (error: any) {
    console.error('Error initializing instance:', error);
    return { error: `Connection failed: ${error.message}` };
  }
}

export async function connectInstance(instanceName: string, token: string) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${UAZAPI_URL}/instance/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Token': token,
      },
      body: JSON.stringify({}),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const responseText = await response.text();
    console.log(`[UAZAPI] Connect response for ${instanceName}: ${response.status} ${responseText}`);

    if (!response.ok) {
         throw new Error(`Failed to connect instance: ${response.status} ${responseText}`);
    }

    return JSON.parse(responseText);
  } catch (error: any) {
    console.error('Error connecting instance:', error);
    return { error: error.message || 'Failed to connect instance' };
  }
}

export async function disconnectInstance(instanceName: string, token: string) {
    try {
        const disconnectResponse = await fetch(`${UAZAPI_URL}/instance/disconnect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Token': token,
            },
        });

        if (!disconnectResponse.ok) {
             console.warn(`Disconnect failed or already disconnected: ${disconnectResponse.status}`);
        }
        
        const deleteResponse = await fetch(`${UAZAPI_URL}/instance/delete/${instanceName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'AdminToken': UAZAPI_ADMIN_TOKEN!, 
            },
        });

        if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            throw new Error(`Failed to delete instance: ${deleteResponse.status} ${errorText}`);
        }

        return await deleteResponse.json();
    } catch (error: any) {
        console.error('Error disconnecting/deleting:', error);
        return { error: error.message || 'Failed to disconnect and delete' };
    }
}

export async function setWebhook(instanceName: string, token: string, webhookUrl: string) {
    try {
        console.log(`[UAZAPI] Setting webhook for ${instanceName} to ${webhookUrl}`);
        // Endpoint adjusted to match likely API pattern /instance/webhook
        const response = await fetch(`${UAZAPI_URL}/instance/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Token': token,
            },
            body: JSON.stringify({
                webhookUrl: webhookUrl,
                webhookByEvents: true,
                events: [
                    "APPLICATION_STARTUP",
                    "QRCODE_UPDATED",
                    "MESSAGES_SET",
                    "MESSAGES_UPSERT",
                    "MESSAGES_UPDATE",
                    "MESSAGES_DELETE",
                    "SEND_MESSAGE",
                    "CONTACTS_SET",
                    "CONTACTS_UPSERT",
                    "CONTACTS_UPDATE",
                    "PRESENCE_UPDATE",
                    "CHATS_SET",
                    "CHATS_UPSERT",
                    "CHATS_UPDATE",
                    "CHATS_DELETE",
                    "GROUPS_UPSERT",
                    "GROUP_UPDATE",
                    "GROUP_PARTICIPANTS_UPDATE",
                    "CONNECTION_UPDATE",
                    "CALL"
                ]
            }),
        });

        const responseText = await response.text();
        
        if (!response.ok) {
             console.error(`Failed to set webhook: ${response.status} ${responseText}`);
             return { error: `Failed to set webhook: ${responseText}` };
        }

        return JSON.parse(responseText);
    } catch (error: any) {
        console.error('Error setting webhook:', error);
        return { error: error.message || 'Failed to set webhook' };
    }
}

export async function forceDeleteInstance(instanceName: string) {
    if (!UAZAPI_ADMIN_TOKEN) return { error: 'Admin Token missing' };
    
    try {
        const deleteResponse = await fetch(`${UAZAPI_URL}/instance/delete/${instanceName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'AdminToken': UAZAPI_ADMIN_TOKEN,
            },
        });

        if (!deleteResponse.ok) {
            if (deleteResponse.status === 404) {
                return { success: true, message: 'Instance not found (already deleted)' };
            }
            const errorText = await deleteResponse.text();
            return { error: `Failed to force delete: ${deleteResponse.status} ${errorText}` };
        }

        return await deleteResponse.json();
    } catch (error: any) {
        console.error('Error force deleting:', error);
        return { error: error.message || 'Failed to force delete' };
    }
}

// Server-side setup function removed to allow client-side orchestration (for proper Firestore Auth/Permission handling)
// The client will handle the strict flow: ForceDelete -> Init -> Save(Client) -> Webhook -> Connect
export async function setupWhatsAppInstance(userId: string, instanceName: string, webhookUrl: string) {
    return { error: 'Deprecated. Use client-side orchestration.' };
}
