'use server';

import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Helper to get API URL
const getApiUrl = () => process.env.UAZAPI_URL || 'https://atendimento.uazapi.com';

export async function verifyInstanceConnection(token: string) {
    if (!token) return { success: false, error: 'Token is required' };

    try {
        const response = await fetch(`${getApiUrl()}/instance/status`, {
            method: 'GET',
            headers: {
                'token': token,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('UAZAPI Connection Error:', errorText);
            return { success: false, error: 'Failed to connect to provider. Check your token.' };
        }

        const data = await response.json();
        
        // Return success with available data
        // We map the response to our internal structure
        return { 
            success: true, 
            data: {
                id: data.id || 'default',
                name: data.instanceName || 'WhatsApp Instance',
                profilePicUrl: data.profilePictureUrl || '',
                status: 'connected' // Assumed connected if status call succeeds
            }
        };
    } catch (error: any) {
        console.error('Error verifying connection:', error);
        return { success: false, error: error.message };
    }
}

export async function setWebhook(instanceName: string, token: string, webhookUrl: string) {
    try {
        // According to user instructions, the endpoint is /webhook (POST)
        // and it requires specific body parameters.
        const response = await fetch(`${getApiUrl()}/webhook`, {
            method: 'POST',
            headers: {
                'token': token,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                enabled: true,
                url: webhookUrl,
                events: [
                    "messages",
                    "sender",
                    "connection"
                ],
                excludeMessages: [
                    "wasSentByApi",
                    "isGroupYes"
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('UAZAPI Webhook Error:', errorText);
            return { success: false, error: `Failed to set webhook: ${response.statusText}` };
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error: any) {
        console.error('Error setting webhook:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteInstanceByToken(token: string) {
    try {
        // We might need instance name, but let's try to find it or just return success
        // if we can't really delete it from provider without name.
        // Assuming logout/delete endpoint
        // For now, we just acknowledge.
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function cleanupInstanceByName(instanceName: string) {
    console.log(`[Actions] Cleanup instance ${instanceName} requested`);
    return { success: true };
}

export async function forceDeleteInstance(instanceName: string) {
    console.log(`[Actions] Force delete instance ${instanceName} requested`);
    return { success: true };
}

// Helper to create simple campaign on provider
async function createSimpleProviderCampaign(
    token: string,
    campaignName: string,
    message: string,
    phones: string[],
    scheduledAt: number | Date,
    speed: string
) {
    let delayMin = 10;
    let delayMax = 30;
    // Values matched to UI descriptions:
    // Slow: 100-120s (Recommended)
    // Normal: 80-100s (Medium Risk)
    // Fast: 60-80s (High Risk)
    if (speed === 'slow') { delayMin = 100; delayMax = 120; }
    else if (speed === 'normal') { delayMin = 80; delayMax = 100; }
    else if (speed === 'fast') { delayMin = 60; delayMax = 80; }

    const formattedPhones = phones.map(p => {
        const clean = p.replace(/\D/g, '');
        // For simple sender, some versions expect @s.whatsapp.net, others just number.
        // Usually /sender/simple expects full JID or number.
        // Let's safe bet: if it looks like a number, append suffix.
        return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
    });

    // Add 10 seconds buffer
    const scheduledTimestamp = new Date(scheduledAt).getTime() + 10000;
    
    const payload = {
        numbers: formattedPhones,
        type: 'text',
        folder: campaignName,
        delayMin,
        delayMax,
        scheduled_for: scheduledTimestamp,
        info: campaignName,
        text: message
    };

    const response = await fetch(`${getApiUrl()}/sender/simple`, {
        method: 'POST',
        headers: {
            'token': token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Falha ao criar campanha na UAZAPI');
    }

    return result.folder_id;
}

// Helper to create advanced campaign on provider
async function createAdvancedProviderCampaign(
    token: string,
    campaignName: string,
    messages: any[],
    phones: string[],
    scheduledAt: number | Date,
    speed: string
) {
    let delayMin = 10;
    let delayMax = 30;
    // Values matched to UI descriptions:
    // Slow: 100-120s (Recommended)
    // Normal: 80-100s (Medium Risk)
    // Fast: 60-80s (High Risk)
    if (speed === 'slow') { delayMin = 100; delayMax = 120; }
    else if (speed === 'normal') { delayMin = 80; delayMax = 100; }
    else if (speed === 'fast') { delayMin = 60; delayMax = 80; }

    // Add 5 seconds buffer
    const scheduledTimestamp = new Date(scheduledAt).getTime() + 5000;

    const advancedMessages: any[] = [];
    phones.forEach(phone => {
        const cleanPhone = phone.replace(/\D/g, '');
        // Use raw number as per docs
        const formattedPhone = cleanPhone; 
        
        messages.forEach(msg => {
            advancedMessages.push({
                number: formattedPhone,
                ...msg
            });
        });
    });

    const payload = {
        delayMin,
        delayMax,
        info: campaignName,
        scheduled_for: scheduledTimestamp,
        messages: advancedMessages
    };

    console.log('[UAZAPI] Creating Advanced Campaign Payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(`${getApiUrl()}/sender/advanced`, {
        method: 'POST',
        headers: {
            'token': token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log('[UAZAPI] Create Campaign Response:', JSON.stringify(result, null, 2));

    if (!response.ok) {
        console.error('[UAZAPI] Error creating campaign:', result);
        throw new Error(result.error || JSON.stringify(result) || 'Falha ao criar campanha avançada na UAZAPI');
    }

    return result.folder_id;
}

export async function createSimpleCampaignProviderOnly(
    userId: string,
    campaignName: string,
    message: string,
    phones: string[],
    scheduledAt: number | Date,
    speed: string
) {
    try {
        const token = await getUserToken(userId);
        if (!token) {
            throw new Error('Usuário não possui token da UAZAPI configurado.');
        }

        const uazapiId = await createSimpleProviderCampaign(token, campaignName, message, phones, scheduledAt, speed);
        return { success: true, id: uazapiId };
    } catch (error: any) {
        console.error('Error creating provider-only simple campaign:', error);
        return { success: false, error: error.message };
    }
}

export async function createAdvancedCampaignProviderOnly(
    userId: string,
    campaignName: string,
    messages: any[],
    phones: string[],
    scheduledAt: number | Date,
    speed: string
) {
    try {
        const token = await getUserToken(userId);
        if (!token) {
            throw new Error('Usuário não possui token da UAZAPI configurado.');
        }

        const uazapiId = await createAdvancedProviderCampaign(token, campaignName, messages, phones, scheduledAt, speed);
        return { success: true, id: uazapiId };
    } catch (error: any) {
        console.error('Error creating provider-only advanced campaign:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteCampaignFromProvider(userId: string, folderId: string) {
    try {
        const token = await getUserToken(userId);
        if (!token) return { success: false, error: 'No token' };

        // Use /sender/edit with action=delete
        const response = await fetch(`${getApiUrl()}/sender/edit`, {
            method: 'POST',
            headers: {
                'token': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                folder_id: folderId,
                action: 'delete'
            })
        });

        if (!response.ok) {
            const result = await response.json();
            
             // If 404 or similar, maybe it's already gone
            if (response.status === 404 || result.error?.includes('not found') || result.error?.includes('Folder not found')) {
                 console.log(`[UAZAPI] Campaign ${folderId} not found on provider, assuming already deleted.`);
                 return { success: true };
            }

            console.error('UAZAPI Delete Campaign Error:', result);
            return { success: false, error: result.error || 'Failed to delete campaign from provider' };
        }

        return { success: true };
    } catch (error: any) {
        console.error('Error deleting campaign from provider:', error);
        return { success: false, error: error.message };
    }
}

export async function controlCampaign(userId: string, campaignId: string, action: 'stop' | 'continue') {
    if (!userId || !campaignId) {
        return { success: false, error: 'Missing parameters' };
    }

    try {
        const campaignRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId);
        const docSnap = await campaignRef.get();

        if (!docSnap.exists) {
            return { success: false, error: 'Campaign not found' };
        }

        const campaign = docSnap.data();

        // MASTER CAMPAIGN HANDLING (Container for batches)
        // Check for batchIds OR batches map
        let batchIds = campaign?.batchIds;
        
        // If batchIds missing but batches map exists, extract IDs from map keys
        if ((!batchIds || batchIds.length === 0) && campaign?.batches && typeof campaign.batches === 'object') {
            batchIds = Object.keys(campaign.batches);
            console.log(`[Control] Recovered ${batchIds.length} batch IDs from batches map`);
        }

        if (batchIds && Array.isArray(batchIds) && batchIds.length > 0) {
            console.log(`[Control] Processing Master Campaign ${campaignId} with ${batchIds.length} batches`);
            
            const results = [];
            for (const batchId of batchIds) {
                if (batchId === campaignId) continue;

                // 1. Check for Real Campaign Document
                const batchRef = db.collection('users').doc(userId).collection('campaigns').doc(batchId);
                const batchSnap = await batchRef.get();

                if (batchSnap.exists) {
                    const batchData = batchSnap.data();
                    const batchStatus = (batchData?.status || '').toLowerCase();
                    
                    if (action === 'continue' && ['sending', 'sent', 'completed', 'done'].includes(batchStatus)) {
                         results.push({ success: true, status: batchStatus });
                         continue;
                    }
                    if (action === 'stop' && ['stopped', 'sent', 'completed', 'failed'].includes(batchStatus)) {
                         results.push({ success: true, status: batchStatus });
                         continue;
                    }

                    const res = await controlCampaign(userId, batchId, action);
                    results.push(res);
                } else {
                    // 2. Handle Virtual Batch (from Master Campaign Map)
                    const virtualBatch = campaign.batches?.[batchId];
                    if (!virtualBatch) {
                        results.push({ success: false, error: `Batch ${batchId} not found` });
                        continue;
                    }
                    
                    const batchStatus = (virtualBatch.status || '').toLowerCase();

                    if (action === 'stop') {
                         try {
                             await deleteCampaignFromProvider(userId, batchId);
                             await campaignRef.update({ 
                                 [`batches.${batchId}.status`]: 'Stopped',
                                 [`batches.${batchId}.updatedAt`]: new Date().toISOString()
                             });
                             results.push({ success: true });
                         } catch (e: any) {
                             results.push({ success: false, error: e.message });
                         }
                    } else if (action === 'continue') {
                        // Check if already running
                        if (['sending', 'sent', 'completed'].includes(batchStatus)) {
                            results.push({ success: true });
                            continue;
                        }

                        // RESTART LOGIC
                        const batchPhones = virtualBatch.phones;
                        if (!batchPhones || batchPhones.length === 0) {
                             results.push({ success: false, error: `Lote ${batchId} sem dados para reenvio (Recrie a campanha)` });
                             continue;
                        }

                        try {
                             // Clean up old
                             try { await deleteCampaignFromProvider(userId, batchId); } catch (e) {}
                             
                             const token = await getUserToken(userId);
                             if (!token) throw new Error('No token');

                             const batchName = virtualBatch.name || `${campaign.name} (Batch)`;
                             const speed = campaign.speed || 'normal';
                             const masterMessages = campaign.messages || [];
                             const masterMessage = campaign.message || '';
                             
                             let newId = '';
                             if (masterMessages.length > 0) {
                                 newId = await createAdvancedProviderCampaign(token, batchName, masterMessages, batchPhones, new Date(), speed);
                             } else {
                                 newId = await createSimpleProviderCampaign(token, batchName, masterMessage, batchPhones, new Date(), speed);
                             }

                             // Update Map Keys (Delete old, Add new)
                             const newBatchData = {
                                 ...virtualBatch,
                                 id: newId,
                                 uazapiId: newId,
                                 status: 'Sending',
                                 updatedAt: new Date().toISOString()
                             };
                             
                             await campaignRef.update({
                                 [`batches.${batchId}`]: FieldValue.delete(),
                                 [`batches.${newId}`]: newBatchData,
                                 batchIds: FieldValue.arrayRemove(batchId)
                             });
                             await campaignRef.update({
                                 batchIds: FieldValue.arrayUnion(newId)
                             });

                             results.push({ success: true, newId });
                        } catch (e: any) {
                             results.push({ success: false, error: e.message });
                        }
                    }
                }
            }

            // Determine overall status
            let newStatus = '';
            if (action === 'stop') {
                newStatus = 'Stopped';
                await campaignRef.update({ 
                    status: newStatus,
                    stoppedAt: new Date().toISOString()
                });
            } else if (action === 'continue') {
                newStatus = 'Sending';
                await campaignRef.update({ 
                    status: newStatus,
                    scheduledAt: new Date().toISOString(),
                    sentDate: new Date().toISOString()
                });
            }

            const failures = results.filter(r => !r.success);
            if (failures.length > 0 && failures.length === results.length) {
                // If ALL failed, return error
                const firstError = failures[0].error || 'Erro desconhecido';
                return { success: false, error: `Falha ao processar lotes: ${firstError}` };
            }

            return { success: true, status: newStatus };
        }

        const currentUazapiId = campaign?.uazapiId;
        const currentStatus = (campaign?.status || '').toLowerCase();

        // Idempotency check for single campaign
        if (action === 'continue' && currentStatus === 'sending') {
             console.log(`[Control] Campaign ${campaignId} is already sending. Skipping.`);
             return { success: true, status: 'Sending' };
        }

        let newStatus = '';

        if (action === 'stop') {
            newStatus = 'Stopped';
            // Stop on Provider (Delete/Clear)
            if (currentUazapiId) {
                await deleteCampaignFromProvider(userId, currentUazapiId);
            }
        } else if (action === 'continue') {
            newStatus = 'Sending';
            
            // FORCE START LOGIC (Override Schedule)
            // 1. Delete existing scheduled folder on provider to prevent double send
            if (currentUazapiId) {
                await deleteCampaignFromProvider(userId, currentUazapiId);
            }

            // 2. Re-create on provider with NOW schedule
            const token = await getUserToken(userId);
            if (!token) return { success: false, error: 'No token' };

            const type = campaign?.type || 'simple';
            let phones = campaign?.phones || [];
            const speed = campaign?.speed || 'normal';
            
            // Fallback: If phones array is empty, try to fetch from dispatches subcollection
            if (!phones || phones.length === 0) {
                 const dispatchesSnap = await campaignRef.collection('dispatches').get();
                 if (!dispatchesSnap.empty) {
                     phones = dispatchesSnap.docs.map(doc => doc.data().phone).filter((p: any) => !!p);
                     // Optional: Update the campaign doc with the recovered phones to avoid future lookups
                     if (phones.length > 0) {
                         await campaignRef.update({ phones });
                     }
                 }
            }

            if (!phones || phones.length === 0) {
                 return { success: false, error: 'No recipients found to start campaign.' };
            }

            // Ensure Dispatches Exist (Smart Backfill) - Critical for tracking
            try {
                const dispatchesRef = campaignRef.collection('dispatches');
                
                // Get ALL existing dispatch IDs to avoid duplicates/overwrites
                // Optimization: If list is huge, this might be heavy, but for < 10k it's fine.
                const existingSnap = await dispatchesRef.select('phone').get();
                const existingPhones = new Set(existingSnap.docs.map(d => d.id));
                
                const missingPhones = phones.filter((p: string) => !existingPhones.has(p));
                
                if (missingPhones.length > 0) {
                    console.log(`[Control] Smart Backfilling: Found ${missingPhones.length} missing dispatches (Total Target: ${phones.length})`);
                    
                    // Chunk for batch limits
                    const chunkSize = 450; 
                    for (let i = 0; i < missingPhones.length; i += chunkSize) {
                        const chunk = missingPhones.slice(i, i + chunkSize);
                        const batch = db.batch();
                        
                        for (const phone of chunk) {
                             // Use phone as ID for idempotency
                             const docRef = dispatchesRef.doc(phone);
                             batch.set(docRef, {
                                 phone: phone,
                                 status: 'scheduled', 
                                 campaignId: campaignId,
                                 updatedAt: new Date().toISOString(),
                                 createdAt: new Date().toISOString(),
                                 name: phone // Fallback name
                             });
                        }
                        await batch.commit();
                    }
                    console.log(`[Control] Successfully backfilled ${missingPhones.length} dispatches.`);
                } else {
                    console.log(`[Control] All ${phones.length} recipients already have dispatch records.`);
                }
            } catch (err) {
                console.error('[Control] Error backfilling dispatches:', err);
                // Continue anyway, don't block sending
            }

            let newUazapiId = '';

            if (type === 'simple') {
                const message = campaign?.message || '';
                newUazapiId = await createSimpleProviderCampaign(
                    token, 
                    campaign?.name || 'Campaign', 
                    message, 
                    phones, 
                    new Date(), // Start NOW
                    speed
                );
            } else {
                const messages = campaign?.messages || [];
                newUazapiId = await createAdvancedProviderCampaign(
                    token,
                    campaign?.name || 'Campaign',
                    messages,
                    phones,
                    new Date(), // Start NOW
                    speed
                );
            }

            // Update with NEW UAZAPI ID
            if (newUazapiId) {
                await campaignRef.update({ uazapiId: newUazapiId });
            }
        }

        const updates: Record<string, any> = { status: newStatus };
        if (action === 'continue') {
            updates.scheduledAt = new Date().toISOString();
            updates.sentDate = new Date().toISOString();
            updates.startDate = new Date().toISOString();
        }
        if (action === 'stop') {
            updates.stoppedAt = new Date().toISOString();
        }
        await campaignRef.update(updates);

        return { success: true, status: newStatus };
    } catch (error: any) {
        console.error('Error controlling campaign:', error);
        return { success: false, error: error.message };
    }
}

export async function getCampaignsFromProvider(userId: string) {
    try {
        const token = await getUserToken(userId);
        if (!token) return { success: false, error: 'No token' };

        const response = await fetch(`${getApiUrl()}/sender/listfolders`, {
            method: 'GET',
            headers: {
                'token': token,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) return { success: false, error: 'Failed to fetch folders' };
        
        const data = await response.json();
        return { success: true, data: Array.isArray(data) ? data : [] };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getCampaignMessagesFromProvider(userId: string, campaignId: string, uazapiId?: string, page = 1, pageSize = 50) {
    try {
        const token = await getUserToken(userId);
        if (!token) return { success: false, error: 'No token' };

        // We need the UAZAPI folder ID (uazapiId). 
        // If not provided, fetch from Firestore campaign doc.
        let folderId = uazapiId;
        if (!folderId) {
            const campaignDoc = await db.collection('users').doc(userId).collection('campaigns').doc(campaignId).get();
            folderId = campaignDoc.data()?.uazapiId;
        }

        if (!folderId) return { success: false, error: 'Campaign has no provider ID' };

        const response = await fetch(`${getApiUrl()}/sender/listmessages`, {
            method: 'POST',
            headers: {
                'token': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                folder_id: folderId,
                page,
                pageSize
            })
        });

        if (!response.ok) return { success: false, error: 'Failed to fetch messages' };
        
        const data = await response.json();
        return { success: true, messages: data.messages || [], total: data.pagination?.total || 0 };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// Helper to get token
async function getUserToken(userId: string): Promise<string | null> {
    const userDoc = await db.collection('users').doc(userId).get();
    return userDoc.data()?.uazapi?.token || null;
}
