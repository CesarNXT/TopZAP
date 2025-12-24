'use server';

import { InstanceStatus } from '@/lib/uazapi-types';
import { db } from '@/lib/firebase-admin';

const UAZAPI_URL = process.env.UAZAPI_URL || 'https://atendimento.uazapi.com';
const UAZAPI_ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN;

export async function initInstance(instanceName: string, webhookUrl?: string) {
  if (!UAZAPI_ADMIN_TOKEN || UAZAPI_ADMIN_TOKEN === 'admin_token_here') {
      console.error('[UAZAPI] Admin token is missing or default.');
      return { error: 'Configuration Error: Admin Token is missing.' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'admintoken': UAZAPI_ADMIN_TOKEN
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const body: any = { 
        name: instanceName,
        fingerprintProfile: "chrome",
        browser: "chrome"
    };

    if (webhookUrl) {
        body.webhook = webhookUrl;
        body.webhookUrl = webhookUrl;
        // body.webhookByEvents = true; // Removed as it might conflict with addUrlEvents
        body.addUrlEvents = false; // Ensure URL structure remains flat
        body.events = [
            "APPLICATION_STARTUP", "QRCODE_UPDATED", "MESSAGES_SET", "MESSAGES_UPSERT",
            "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE", "CONTACTS_SET",
            "CONTACTS_UPSERT", "CONTACTS_UPDATE", "PRESENCE_UPDATE", "CHATS_SET",
            "CHATS_UPSERT", "CHATS_UPDATE", "CHATS_DELETE", "GROUPS_UPSERT",
            "GROUP_UPDATE", "GROUP_PARTICIPANTS_UPDATE", "CONNECTION_UPDATE", "CALL",
            "sender"
        ];
        body.excludeMessages = ["wasSentByApi", "isGroupYes"];
    }

    const response = await fetch(`${UAZAPI_URL}/instance/init`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
        if (response.status === 429) {
            return { error: 'Limite de instâncias conectadas atingido (429).' };
        }
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
        'token': token,
      },
      body: JSON.stringify({}),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const responseText = await response.text();
    console.log(`[UAZAPI] Connect response for ${instanceName}: ${response.status} ${responseText}`);

    if (!response.ok) {
         if (response.status === 429) {
             throw new Error('Limite de instâncias conectadas atingido (429).');
         }
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
        // First try to logout
        const logoutResponse = await fetch(`${UAZAPI_URL}/instance/logout/${instanceName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
                'admintoken': UAZAPI_ADMIN_TOKEN!,
            },
        });

        if (!logoutResponse.ok) {
             if (logoutResponse.status === 401) {
                 console.log(`[UAZAPI] Logout 401 (Unauthorized) - assuming invalid token or already logged out.`);
             } else if (logoutResponse.status !== 404) {
                 console.warn(`Logout failed: ${logoutResponse.status}`);
             }
        }
        
        // Then delete the instance
        // Some servers disable DELETE /instance/delete/:instance or return 405.
        // We'll try it, but ignore 405.
        const deleteResponse = await fetch(`${UAZAPI_URL}/instance/delete/${instanceName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'admintoken': UAZAPI_ADMIN_TOKEN!, 
            },
        });

        if (!deleteResponse.ok) {
            if (deleteResponse.status === 404) {
                return { success: true };
            }
            if (deleteResponse.status === 405) {
                console.warn(`[UAZAPI] Delete instance returned 405 (Method Not Allowed). Ignoring.`);
                return { success: true, warning: 'Delete not supported by server' };
            }
            const errorText = await deleteResponse.text();
            throw new Error(`Failed to delete instance: ${deleteResponse.status} ${errorText}`);
        }

        return await deleteResponse.json();
    } catch (error: any) {
        console.error('Error disconnecting/deleting:', error);
        // We return success true to allow the UI to reset, even if server failed
        return { success: true, error: error.message }; 
    }
}

export async function deleteInstanceByToken(token: string) {
    try {
        const response = await fetch(`${UAZAPI_URL}/instance`, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': token,
            },
        });
        const responseText = await response.text();
        if (!response.ok) {
            if (response.status === 404) {
                return { error: 'Not Found' };
            }
            return { error: `Failed to delete instance by token: ${response.status} ${responseText}` };
        }
        return JSON.parse(responseText);
    } catch (error: any) {
        return { error: error.message || 'Failed to delete instance by token' };
    }
}

export async function setWebhook(instanceName: string, token: string, webhookUrl: string) {
    try {
        console.log(`[UAZAPI] Setting webhook for ${instanceName} to ${webhookUrl}`);
        
        // Payload based on "Simple Mode" documentation
        const body = {
            url: webhookUrl,
            enabled: true,
            addUrlEvents: false, // Ensure URL structure remains flat
            events: ["messages", "connection", "sender"],
            excludeMessages: ["wasSentByApi", "isGroupYes"]
        };

        // Try user's suggested endpoint: POST /webhook
        // Documentation: https://atendimento.uazapi.com/webhook
        console.log(`[UAZAPI] Trying POST /webhook with token header...`);
        let response = await fetch(`${UAZAPI_URL}/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify(body),
        });

        // Fallback: Try standard /webhook/set/:instance if the above fails with 404
        if (!response.ok && response.status === 404) {
             console.log(`[UAZAPI] /webhook failed (404), trying /webhook/set/${instanceName}...`);
             response = await fetch(`${UAZAPI_URL}/webhook/set/${instanceName}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'admintoken': UAZAPI_ADMIN_TOKEN!,
                    'token': token,
                },
                body: JSON.stringify(body),
             });
        }

        const responseText = await response.text();
        
        if (!response.ok) {
             if (response.status === 429) {
                 return { error: 'Limite de instâncias conectadas atingido (429).' };
             }
             if (response.status === 405) {
                 console.warn(`[UAZAPI] Webhook set returned 405. Ignoring.`);
                 return { success: true, warning: 'Webhook set not supported' };
             }
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
                'admintoken': UAZAPI_ADMIN_TOKEN,
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

export type CampaignMode = 'seguro' | 'normal' | 'rapido';

function getDelayRangeForMode(mode: CampaignMode) {
    if (mode === 'seguro') return { delayMin: 120, delayMax: 180 };
    if (mode === 'rapido') return { delayMin: 60, delayMax: 80 };
    return { delayMin: 60, delayMax: 120 };
}

export async function createSimpleCampaign(token: string, payload: any) {
    try {
        const response = await fetch(`${UAZAPI_URL}/sender/simple`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify(payload),
        });
        const text = await response.text();
        if (!response.ok) return { error: `${response.status} ${text}` };
        return JSON.parse(text);
    } catch (e: any) {
        return { error: e.message || 'Failed to create simple campaign' };
    }
}

export async function createAdvancedCampaign(token: string, payload: any) {
    try {
        const response = await fetch(`${UAZAPI_URL}/sender/advanced`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify(payload),
        });
        const text = await response.text();
        if (!response.ok) return { error: `${response.status} ${text}` };
        return JSON.parse(text);
    } catch (e: any) {
        return { error: e.message || 'Failed to create advanced campaign' };
    }
}

export async function createAdvancedCampaignForUser(
    userId: string, 
    mode: CampaignMode, 
    messages: any[], 
    phones: string[],
    info?: string, 
    scheduledFor?: number,
    customButtons?: { id: string; text: string }[]
) {
    try {
        const userRef = db.collection('users').doc(userId);
        const snap = await userRef.get();
        if (!snap.exists) return { error: 'User not found' };
        const data = snap.data() as any;
        const token = data?.uazapi?.token;
        const connected = data?.uazapi?.connected === true || data?.uazapi?.status === 'connected';
        if (!token) return { error: 'Instance token not found' };
        if (!connected) return { error: 'WhatsApp not connected' };
        const { delayMin, delayMax } = getDelayRangeForMode(mode);

        // Prepare buttons choices
        const blockButtonId = 'BLOCK_CONTACT_ACTION';
        const blockButtonText = 'Bloquear Contato';
        const blockChoice = `${blockButtonText}|${blockButtonId}`;
        
        const customChoices = customButtons?.map(b => `${b.text}|${b.id}`) || [];
        // Combine custom buttons with mandatory block button (Block usually at the end)
        const allChoices = [...customChoices, blockChoice];

        // 1. Prepare messages payload
        const messagesPayload: any[] = [];

        phones.forEach(phone => {
            messages.forEach((msg, index) => {
                const isLastMessage = index === messages.length - 1;
                const messageButtons = isLastMessage && allChoices.length > 0 ? allChoices : undefined;

                let messageObj: any = { number: phone };

                if (typeof msg === 'string') {
                    messageObj.text = msg;
                    if (messageButtons) {
                         messageObj.buttons = messageButtons.map(c => {
                             const [text, id] = c.split('|');
                             return { id, text };
                         });
                    }
                } else if (typeof msg === 'object') {
                    // Handle image, video, document, etc.
                    // Assuming msg is already formatted as { image: 'url', caption: '...' } or similar
                    // We merge it into messageObj
                    messageObj = { ...messageObj, ...msg };
                    
                    if (messageButtons) {
                         // If the object structure supports buttons directly (like some providers), add them
                         // Or if we need to wrap it. 
                         // For UAZAPI, buttons are usually a separate field or part of the message object.
                         // We'll assume the same structure as text for now.
                         messageObj.buttons = messageButtons.map(c => {
                             const [text, id] = c.split('|');
                             return { id, text };
                         });
                    }
                }
                
                messagesPayload.push(messageObj);
            });
        });

        const payload = {
            delayMin,
            delayMax,
            info: info || '',
            scheduled_for: scheduledFor ?? 1,
            messages: messagesPayload,
        };

        return await createAdvancedCampaign(token, payload);
    } catch (e: any) {
        return { error: e.message || 'Failed to create advanced campaign for user' };
    }
}

export async function deleteCampaignFromProvider(userId: string, campaignId: string) {
    try {
        const userRef = db.collection('users').doc(userId);
        const snap = await userRef.get();
        if (!snap.exists) return { error: 'User not found' };
        const data = snap.data() as any;
        const token = data?.uazapi?.token;
        
        if (!token) return { error: 'Instance token not found' };

        // Try DELETE /sender/delete/:id
        // Assuming UAZAPI has this endpoint structure for campaigns/folders
        const response = await fetch(`${UAZAPI_URL}/sender/delete/${campaignId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
        });

        if (!response.ok) {
             // If 404, it's already gone, so success
             if (response.status === 404) return { success: true };
             const text = await response.text();
             return { error: `Failed to delete from provider: ${response.status} ${text}` };
        }

        return { success: true };
    } catch (e: any) {
        return { error: e.message || 'Failed to delete campaign from provider' };
    }
}

// Server-side setup function removed to allow client-side orchestration (for proper Firestore Auth/Permission handling)
// The client will handle the strict flow: ForceDelete -> Init -> Save(Client) -> Webhook -> Connect
export async function setupWhatsAppInstance(userId: string, instanceName: string, webhookUrl: string) {
    return { error: 'Deprecated. Use client-side orchestration.' };
}
