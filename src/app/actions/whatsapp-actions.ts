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
    const timeoutId = setTimeout(() => controller.abort(), 30000);

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
        // User requested NOT to exclude wasSentByApi to track delivery
        body.excludeMessages = ["isGroupYes"];
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
    const timeoutId = setTimeout(() => controller.abort(), 30000);

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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        // First try to logout
        const logoutResponse = await fetch(`${UAZAPI_URL}/instance/logout/${instanceName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
                'admintoken': UAZAPI_ADMIN_TOKEN!,
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!logoutResponse.ok) {
             if (logoutResponse.status === 401) {
                 console.log(`[UAZAPI] Logout 401 (Unauthorized) - assuming invalid token or already logged out.`);
             } else if (logoutResponse.status !== 404) {
                 console.warn(`Logout failed: ${logoutResponse.status}`);
             }
        }
        
        const deleteController = new AbortController();
        const deleteTimeoutId = setTimeout(() => deleteController.abort(), 30000);

        // Then delete the instance
        // Some servers disable DELETE /instance/delete/:instance or return 405.
        // We'll try it, but ignore 405.
        const deleteResponse = await fetch(`${UAZAPI_URL}/instance/delete/${instanceName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'admintoken': UAZAPI_ADMIN_TOKEN!, 
            },
            signal: deleteController.signal
        });
        clearTimeout(deleteTimeoutId);

        if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            
            if (deleteResponse.status === 404) {
                return { success: true };
            }
            
            console.warn(`[UAZAPI] Delete instance failed: ${deleteResponse.status} ${errorText}`);
            
            if (deleteResponse.status === 405) {
                return { success: true, warning: 'Delete not supported by server' };
            }
            
            // Return success with warning instead of throwing, to ensure UI can disconnect
            return { success: true, warning: `Instance delete failed: ${deleteResponse.status}` };
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
            excludeMessages: ["isGroupYes"]
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

export async function cleanupInstanceByName(instanceName: string) {
    if (!UAZAPI_ADMIN_TOKEN) return { error: 'Admin Token missing' };

    try {
        console.log(`[UAZAPI] Starting robust cleanup for instance name: ${instanceName}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        // 1. Fetch all instances to find matches
        // Using /instance/all as it returns the tokens needed for deletion
        const listResponse = await fetch(`${UAZAPI_URL}/instance/all`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'admintoken': UAZAPI_ADMIN_TOKEN,
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!listResponse.ok) {
            console.warn(`[UAZAPI] Failed to fetch instances list: ${listResponse.status}`);
            // Fallback to direct delete attempt if listing fails
            return await forceDeleteInstance(instanceName);
        }

        const instances = await listResponse.json();
        if (!Array.isArray(instances)) {
            console.warn(`[UAZAPI] Invalid instances list format.`);
            return await forceDeleteInstance(instanceName);
        }

        // Find ALL instances that match the name (handling duplicates if any)
        const targets = instances.filter((i: any) => 
            i.name === instanceName || 
            i.instanceName === instanceName ||
            i.instance?.instanceName === instanceName
        );

        if (targets.length === 0) {
            console.log(`[UAZAPI] No existing instances found with name ${instanceName}.`);
            return { success: true };
        }

        console.log(`[UAZAPI] Found ${targets.length} instance(s) to clean up.`);

        // 2. Process each target: Logout -> Delete
        for (const target of targets) {
            const targetName = target.name || target.instanceName || target.instance?.instanceName;
            const targetToken = target.token || target.instance?.token;

            console.log(`[UAZAPI] Cleaning up: ${targetName}`);

            if (!targetToken) {
                 console.warn(`[UAZAPI] No token found for ${targetName}, trying simple force delete.`);
                 await forceDeleteInstance(targetName);
                 continue;
            }

            // A. DELETE directly using the instance token as requested
            try {
                const loopController = new AbortController();
                const loopTimeoutId = setTimeout(() => loopController.abort(), 30000);

                const deleteRes = await fetch(`${UAZAPI_URL}/instance`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'token': targetToken, // User emphasized using token header
                    },
                    signal: loopController.signal
                });
                clearTimeout(loopTimeoutId);

                if (deleteRes.ok) {
                    console.log(`[UAZAPI] Delete successful for ${targetName}`);
                } else {
                    const txt = await deleteRes.text();
                    console.warn(`[UAZAPI] Delete failed for ${targetName}: ${deleteRes.status} ${txt}`);
                }
            } catch (e) {
                console.warn(`[UAZAPI] Delete exception for ${targetName}:`, e);
            }
            
            // Wait a bit to avoid rate limits
            await new Promise(r => setTimeout(r, 1000));
        }

        return { success: true, message: `Cleanup completed for ${targets.length} instance(s)` };

    } catch (error: any) {
        console.error('Error in cleanupInstanceByName:', error);
        return { error: error.message || 'Cleanup failed' };
    }
}

export async function forceDeleteInstance(instanceName: string) {
    if (!UAZAPI_ADMIN_TOKEN) return { error: 'Admin Token missing' };
    
    try {
        console.log(`[UAZAPI] Force deleting instance: ${instanceName}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        // 1. Try to fetch list to see if it exists and get exact name/id if needed
        // This addresses user request: "verifique se tem umma instancia com o mesmo nome"
        // Changed to /instance/all for consistency
        const listResponse = await fetch(`${UAZAPI_URL}/instance/all`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'admintoken': UAZAPI_ADMIN_TOKEN,
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (listResponse.ok) {
            const instances = await listResponse.json();
            if (Array.isArray(instances)) {
                const target = instances.find((i: any) => 
                    i.instance?.instanceName === instanceName || 
                    i.name === instanceName || 
                    i.instanceName === instanceName
                );
                
                if (!target) {
                    console.log(`[UAZAPI] Instance ${instanceName} not found in list. Assuming deleted.`);
                    // We still try the direct delete call just in case
                } else {
                    console.log(`[UAZAPI] Found instance in list: ${target.instance?.instanceName || target.name}`);
                }
            }
        }

        const deleteController = new AbortController();
        const deleteTimeoutId = setTimeout(() => deleteController.abort(), 30000);

        // 2. Perform Delete
        // Changed to try /instance/logout first as /delete often returns 405 on some versions
        console.log(`[UAZAPI] Trying logout before delete for ${instanceName}...`);
        try {
             await fetch(`${UAZAPI_URL}/instance/logout/${instanceName}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'admintoken': UAZAPI_ADMIN_TOKEN,
                },
                signal: deleteController.signal
            });
        } catch (e) {
            console.warn("[UAZAPI] Logout attempt failed or timed out", e);
        }

        const deleteResponse = await fetch(`${UAZAPI_URL}/instance/delete/${instanceName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'admintoken': UAZAPI_ADMIN_TOKEN,
            },
            signal: deleteController.signal
        });
        clearTimeout(deleteTimeoutId);

        if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            
            if (deleteResponse.status === 404) {
                return { success: true, message: 'Instance not found (already deleted)' };
            }
            
            console.warn(`[UAZAPI] Delete instance failed: ${deleteResponse.status} ${errorText}`);
            
            if (deleteResponse.status === 405) {
                return { success: true, warning: 'Delete not supported by server' };
            }
            
            return { success: true, warning: `Instance delete failed: ${deleteResponse.status}` };
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

// Helper to validate media URL
async function validateMediaUrl(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch (error) {
        console.error(`[UAZAPI] Media URL validation failed for ${url}:`, error);
        return false;
    }
}

export async function createSimpleCampaignForUser(
    userId: string, 
    campaignName: string,
    mode: CampaignMode, 
    message: any, 
    phones: string[],
    info?: string, 
    scheduledFor?: number
) {
    if (scheduledFor) {
        const now = Date.now();
        // 5 minutes tolerance to allow for slight clock skew or processing time
        if (scheduledFor < now - 5 * 60 * 1000) {
             return { error: 'A data/hora agendada já passou. Por favor, escolha um horário futuro para evitar envio imediato indesejado.' };
        }
    }
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

        // Ensure phones have the correct suffix if required by API, or pass as is if API handles it.
        // Docs example shows "@s.whatsapp.net".
        const formattedPhones = phones.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);

        const payload: any = {
            folder: campaignName,
            numbers: formattedPhones,
            delayMin,
            delayMax,
            scheduled_for: scheduledFor ?? Date.now(),
            info: info || '',
        };

        // Prepare Block Button
        const blockButtonId = 'BLOCK_CONTACT_ACTION';
        const blockButtonText = 'Bloquear Contato';
        const blockChoice = `${blockButtonText}|${blockButtonId}`;

        // Map message content
        if (typeof message === 'string') {
            // Use simple text type as requested by user to ensure delivery
            payload.type = 'text';
            payload.text = message;
        } else {
            // Handle objects (image, video, etc)
            // Audio/PTT cannot have buttons in standard message type usually
            if (message.audio) {
                if (!(await validateMediaUrl(message.audio))) {
                    return { error: 'Áudio inacessível ou inválido.' };
                }
                payload.type = 'audio';
                payload.file = message.audio;
                // PTT handling if needed
                if (message.type === 'ptt') {
                     // payload.ptt = true; // If supported
                }
            } else {
                // For Image, Video, Document, Text-Object -> Convert to Button Message
                payload.type = 'button';
                
                // Collect existing buttons if any
                let choices: string[] = [];
                if (message.buttons && Array.isArray(message.buttons)) {
                    choices = message.buttons.map((b: any) => {
                        if (typeof b === 'string') return b;
                        if (b.text && b.id) return `${b.text}|${b.id}`;
                        return b.text || b;
                    });
                }
                
                // Add Block Button
                choices.push(blockChoice);
                
                // Limit to 3 buttons (WhatsApp limitation for interactive buttons)
                if (choices.length > 3) {
                    choices = choices.slice(0, 3);
                }
                payload.choices = choices;

                // Set Text/Caption
                const bodyText = message.text || message.caption || ' ';
                payload.text = bodyText;
                payload.content = bodyText;
                payload.buttonText = bodyText; 
                payload.footerText = message.footer || ' ';

                if (message.image) {
                    if (!(await validateMediaUrl(message.image))) {
                        return { error: 'Imagem inacessível ou inválida. Verifique o upload.' };
                    }
                    payload.imageButton = message.image;
                    // payload.file = message.image; // Backup
                } else if (message.video) {
                    if (!(await validateMediaUrl(message.video))) {
                        return { error: 'Vídeo inacessível ou inválido.' };
                    }
                    payload.videoButton = message.video;
                    // payload.file = message.video; // Backup
                } else if (message.document) {
                    payload.documentButton = message.document;
                    payload.docName = message.fileName;
                    // payload.file = message.document; // Backup
                }
            }
        }
        
        console.log(`[UAZAPI] Creating simple campaign '${campaignName}'. Phones: ${phones.length}, Type: ${payload.type}, ScheduledFor: ${payload.scheduled_for} (Ms)`);

        return await createSimpleCampaign(token, payload);
    } catch (e: any) {
        return { error: e.message || 'Failed to create simple campaign for user' };
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
    if (scheduledFor) {
        const now = Date.now();
        // 5 minutes tolerance to allow for slight clock skew or processing time
        if (scheduledFor < now - 5 * 60 * 1000) {
             return { error: 'A data/hora agendada já passou. Por favor, escolha um horário futuro para evitar envio imediato indesejado.' };
        }
    }
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
        // Removing mandatory block button to ensure text messages are sent reliably as 'text' type
        const allChoices = [...customChoices];

        // 1. Prepare messages payload
        const messagesPayload: any[] = [];
        
        console.log(`[UAZAPI] Creating advanced campaign. Phones: ${phones.length}, Messages: ${messages.length}, ScheduledFor: ${scheduledFor}`);

        for (const phone of phones) {
            for (const [index, msg] of messages.entries()) {
                const isLastMessage = index === messages.length - 1;
                const messageButtons = isLastMessage && allChoices.length > 0 ? allChoices : undefined;

                let messageObj: any = { number: phone };

                if (typeof msg === 'string') {
                    messageObj.text = msg;
                    messageObj.type = 'text'; // Explicitly set type to text
                    
                    if (messageButtons && messageButtons.length > 0) {
                         // The advanced endpoint might expect buttons in a specific format
                         messageObj.type = 'button';
                         messageObj.buttonText = msg;
                         messageObj.footerText = ' ';
                         messageObj.choices = messageButtons.map((c: string) => {
                             const [text, id] = c.split('|');
                             return { id, text };
                         });
                    }
                } else if (typeof msg === 'object') {
                    // Handle image, video, document, etc.
                    // We need to map the internal message format (image/caption) to UAZAPI format (file/text)
                    
                    if (msg.image) {
                         if (!(await validateMediaUrl(msg.image))) {
                             return { error: 'Imagem inacessível ou inválida. Verifique o upload.' };
                         }
                         messageObj.type = 'image';
                         messageObj.file = msg.image;
                         messageObj.text = msg.caption || '';
                    } else if (msg.video) {
                         if (!(await validateMediaUrl(msg.video))) {
                             return { error: 'Vídeo inacessível ou inválido.' };
                         }
                         messageObj.type = 'video';
                         messageObj.file = msg.video;
                         messageObj.text = msg.caption || '';
                    } else if (msg.audio) {
                         if (!(await validateMediaUrl(msg.audio))) {
                             return { error: 'Áudio inacessível ou inválido.' };
                         }
                         messageObj.type = 'audio';
                         messageObj.file = msg.file || msg.audio; // Handle both fields
                         // PTT handling
                         if (msg.ptt) messageObj.ptt = true;
                    } else if (msg.document) {
                         messageObj.type = 'document';
                         messageObj.file = msg.document;
                         messageObj.docName = msg.fileName;
                         messageObj.text = msg.caption || '';
                    }
                    
                    // If no specific media type is set, but we have text, treat as text message
                    if (!messageObj.type && (msg.text || msg.caption || msg.content)) {
                        messageObj.type = 'text';
                        messageObj.text = msg.text || msg.caption || msg.content;
                    }
                    
                    // If the message has a specific type hint (like 'button' or 'ptt')
                    if (msg.type) {
                        if (msg.type === 'button') {
                            messageObj.type = 'button';
                            if (msg.image) {
                                messageObj.imageButton = msg.image;
                                // If it's a button message with image, ensure text is set
                                messageObj.text = msg.caption || messageObj.text || ' ';
                                messageObj.footerText = msg.footer || ' ';
                                messageObj.buttonText = messageObj.text; // Some endpoints use buttonText
                            }
                        } else if (msg.type === 'ptt') {
                             messageObj.type = 'audio'; 
                             messageObj.ptt = true; // If supported
                        }
                    }

                    // Explicitly handle buttons if they exist in the message object (from wizard logic or manual)
                    // Note: createAdvancedCampaignForUser has a separate 'customButtons' arg, but we handle per-message too
                    if (messageButtons) {
                         messageObj.type = 'button';
                         // For button messages, the main text is often in 'buttonText' or 'text' depending on endpoint
                         messageObj.buttonText = messageObj.text || msg.caption || 'Selecione';
                         messageObj.footerText = msg.footer || ' ';
                         
                         messageObj.choices = messageButtons.map((c: string) => {
                             const [text, id] = c.split('|');
                             return { id, text }; // or just format string if API requires
                         });
                         
                         // If image is present with buttons
                         if (msg.image) {
                             messageObj.imageButton = msg.image;
                         }
                    }
                }
                
                messagesPayload.push(messageObj);
            }
        }
        
        if (messagesPayload.length === 0) {
            console.error('[UAZAPI] No messages generated in payload');
            return { error: 'No messages to send' };
        }
        
        console.log('[UAZAPI] Generated payload (first 2 items):', JSON.stringify(messagesPayload.slice(0, 2), null, 2));

        const payload = {
            delayMin,
            delayMax,
            info: info || '',
            scheduled_for: scheduledFor ?? Date.now(),
            messages: messagesPayload,
        };

        return await createAdvancedCampaign(token, payload);
    } catch (e: any) {
        return { error: e.message || 'Failed to create advanced campaign for user' };
    }
}

export async function deleteCampaignFromProvider(userId: string, campaignId: string) {
    return await controlCampaign(userId, campaignId, 'delete');
}

export async function controlCampaign(userId: string, campaignId: string, action: 'stop' | 'continue' | 'delete', uazapiId?: string) {
    try {
        const userRef = db.collection('users').doc(userId);
        const snap = await userRef.get();
        if (!snap.exists) return { error: 'User not found' };
        const data = snap.data() as any;
        const token = data?.uazapi?.token;
        
        if (!token) return { error: 'Instance token not found' };

        const payload = {
            folder_id: uazapiId || campaignId,
            action: action
        };

        const response = await fetch(`${UAZAPI_URL}/sender/edit`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
             const text = await response.text();
             // If deleting and not found (404), consider it a success on the provider side
             // Also ignore 400 if it says "folder not found" or similar, though 404 is standard
             if (action === 'delete' && (response.status === 404 || text.toLowerCase().includes('not found'))) {
                 console.log(`[UAZAPI] Campaign ${uazapiId || campaignId} not found on provider (404), proceeding to local delete.`);
             } else {
                 return { error: `Failed to ${action} campaign: ${response.status} ${text}` };
             }
        }
        
        // Update Firestore status for immediate UI feedback
        try {
            const campaignRef = userRef.collection('campaigns').doc(campaignId);
            if (action === 'stop') {
                await campaignRef.update({ status: 'Paused' });
            } else if (action === 'continue') {
                await campaignRef.update({ status: 'Scheduled' });
            } else if (action === 'delete') {
                await campaignRef.delete();
            }
        } catch (e) {
            console.error('Failed to update/delete local campaign:', e);
            // If it was a delete action and we failed to delete locally, we should probably report error
             if (action === 'delete') {
                 return { error: 'Failed to delete local campaign record.' };
            }
        }

        return { success: true };

        return { success: true };
    } catch (e: any) {
        return { error: e.message || `Failed to ${action} campaign` };
    }
}

export async function checkInstanceStatus(instanceName: string, token: string) {
    try {
        const controller = new AbortController();
        // Increased timeout to 30s to prevent ConnectTimeoutError (user reported 10s timeout)
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        // Strategy 1: Try direct connection status endpoint
        // GET /instance/connectionState/:instance
        const response = await fetch(`${UAZAPI_URL}/instance/connectionState/${instanceName}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': token,
                'admintoken': UAZAPI_ADMIN_TOKEN!,
            },
            signal: controller.signal,
            cache: 'no-store'
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            // Expected response: { connectionState: "open" | "close" | "connecting" }
            return data;
        }

        console.log(`[UAZAPI] connectionState failed (${response.status}), trying list strategies...`);

        const listController = new AbortController();
        const listTimeoutId = setTimeout(() => listController.abort(), 30000); // Increased timeout here too

        // Strategy 2: Use /instance/all (Most reliable for tokens)
        const listResponse = await fetch(`${UAZAPI_URL}/instance/all`, {
             method: 'GET',
             headers: {
                 'Accept': 'application/json',
                 'Content-Type': 'application/json',
                 'admintoken': UAZAPI_ADMIN_TOKEN!,
             },
             signal: listController.signal,
             cache: 'no-store'
        });
        clearTimeout(listTimeoutId);

        if (listResponse.ok) {
            const instances = await listResponse.json();
            if (Array.isArray(instances)) {
                console.log(`[UAZAPI] /instance/all count: ${instances.length}`);
                
                const instance = instances.find((i: any) => 
                    i.instance?.instanceName === instanceName || 
                    i.name === instanceName || 
                    i.instanceName === instanceName
                );

                if (instance) {
                     const status = instance.connectionStatus || instance.status || instance.instance?.status;
                     const connectionState = (status === 'open' || status === 'connected') ? 'open' : status;
                     console.log(`[UAZAPI] Found in /instance/all: ${status} -> ${connectionState}`);
                     return { connectionState };
                }
            }
        }

        // Strategy 3: Use /instance/fetchInstances (Fallback)
        const fetchController = new AbortController();
        const fetchTimeoutId = setTimeout(() => fetchController.abort(), 15000);

        const fetchResponse = await fetch(`${UAZAPI_URL}/instance/fetchInstances`, {
             method: 'GET',
             headers: {
                 'Accept': 'application/json',
                 'Content-Type': 'application/json',
                 'admintoken': UAZAPI_ADMIN_TOKEN!,
             },
             signal: fetchController.signal,
             cache: 'no-store'
        });
        clearTimeout(fetchTimeoutId);

        if (fetchResponse.ok) {
            const instances = await fetchResponse.json();
            if (Array.isArray(instances)) {
                console.log(`[UAZAPI] /fetchInstances count: ${instances.length}`);
                const instance = instances.find((i: any) => 
                    i.instance?.instanceName === instanceName || 
                    i.name === instanceName || 
                    i.instanceName === instanceName
                );

                if (instance) {
                     const status = instance.connectionStatus || instance.status;
                     const connectionState = (status === 'open' || status === 'connected') ? 'open' : status;
                     console.log(`[UAZAPI] Found in /fetchInstances: ${status} -> ${connectionState}`);
                     return { connectionState };
                }
            }
        }

        // If all fail, return error with details
            const text = await response.text();
            return { error: `Failed to check status. API returned ${response.status}. Instance not found in lists.` };

        } catch (e: any) {
            console.error("checkInstanceStatus exception:", e);
            // Include specific error info (e.g. fetch failed)
            return { error: `Connection Check Failed: ${e.message || 'Unknown error'}` };
        }
    }

export async function getCampaignsFromProvider(userId: string, status?: string) {
    try {
        const userRef = db.collection('users').doc(userId);
        const snap = await userRef.get();
        if (!snap.exists) return { error: 'User not found' };
        const data = snap.data() as any;
        const token = data?.uazapi?.token;
        
        if (!token) return { error: 'Instance token not found' };

        const url = new URL(`${UAZAPI_URL}/sender/listfolders`);
        if (status) url.searchParams.append('status', status);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'token': token,
            },
        });

        if (!response.ok) {
            const text = await response.text();
            return { error: `Failed to list campaigns: ${response.status} ${text}` };
        }

        return await response.json();
    } catch (e: any) {
        return { error: e.message || 'Failed to list campaigns from provider' };
    }
}

export async function getCampaignMessagesFromProvider(
    userId: string, 
    folderId: string, 
    messageStatus?: 'Scheduled' | 'Sent' | 'Failed',
    page: number = 1,
    pageSize: number = 20
) {
    try {
        const userRef = db.collection('users').doc(userId);
        const snap = await userRef.get();
        if (!snap.exists) return { error: 'User not found' };
        const data = snap.data() as any;
        const token = data?.uazapi?.token;
        
        if (!token) return { error: 'Instance token not found' };

        const payload: any = {
            folder_id: folderId,
            page,
            pageSize
        };
        if (messageStatus) payload.messageStatus = messageStatus;

        const response = await fetch(`${UAZAPI_URL}/sender/listmessages`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            return { error: `Failed to list messages: ${response.status} ${text}` };
        }

        return await response.json();
    } catch (e: any) {
        return { error: e.message || 'Failed to list messages from provider' };
    }
}

export async function getQRCode(instanceName: string, token: string) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

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

        if (!response.ok) {
            const responseText = await response.text();
            if (response.status === 429) {
                return { error: 'Limite de instâncias conectadas atingido (429).' };
            }
            return { error: `Failed to get QR Code: ${response.status} ${responseText}` };
        }

        return await response.json();
    } catch (error: any) {
        console.error('Error getting QR Code:', error);
        return { error: error.message || 'Failed to get QR Code' };
    }
}
