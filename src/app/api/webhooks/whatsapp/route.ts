import { NextResponse } from 'next/server';
import { db, admin } from '@/lib/firebase-admin';
import { cleanupInstanceByName, forceDeleteInstance, deleteInstanceByToken } from '@/app/actions/whatsapp-actions';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        // console.log('[Webhook] Received payload:', JSON.stringify(body, null, 2)); // Reduce log noise

        let { instance, event, data, EventType, instanceName, type, token } = body;

        // Unified Parsing Logic
        // 1. Resolve Event Name
        // Priority: type (more specific like 'LoggedOut') > EventType > event
        if (type === 'LoggedOut') event = 'LoggedOut';
        else if (!event && EventType) event = EventType;
        else if (!event && type) event = type;

        // console.log(`[Webhook] Resolved event: ${event}`);

        // 2. Resolve Instance Name (String)
        // If 'instance' is an object (common in some UAZAPI versions), try to get name from it
        let instanceStatusFromObject = undefined;
        if (typeof instance === 'object' && instance !== null) {
            instanceStatusFromObject = instance.status; // Capture status from instance object
            instance = instance.name || instance.instanceName || instanceName;
        }
        // Fallbacks
        if (!instance && instanceName) instance = instanceName;
        if (!instance && data?.instance) instance = data.instance;
        if (!instance && data?.instanceKey) instance = data.instanceKey;

        // console.log(`[Webhook] Resolved instance: ${instance}`);

        // 3. Resolve Data
        const safeData = data || body || {};

        if (!instance || !event) {
            console.error('[Webhook] Missing instance or event', { instance, event, bodyKeys: Object.keys(body) });
            return NextResponse.json({ error: 'Invalid payload', received: body }, { status: 400 });
        }

        // --- OPTIMIZATION START: Fetch User ONCE ---
        // Instead of fetching inside every if block, we fetch once here.
        // This saves multiple reads if a single payload triggers multiple logical blocks (unlikely but safe)
        // and simplifies the code.
        let userDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
        let userId: string | null = null;

        if (instance) {
             const usersRef = db.collection('users');
             // Limit 1 is crucial for cost/performance even if unique
             const querySnapshot = await usersRef.where('uazapi.instanceName', '==', instance).limit(1).get();
             if (!querySnapshot.empty) {
                 userDoc = querySnapshot.docs[0];
                 userId = userDoc.id;
             } else {
                 console.warn(`[Webhook] No user found for instance ${instance}`);
                 // If no user, we can't do much for most events.
                 // But we proceed because some events might be generic (though current logic depends on user)
             }
        }
        // --- OPTIMIZATION END ---

        // 1. Handle Connection Updates
        // Added 'LoggedOut' to the check
        if (event === 'CONNECTION_UPDATE' || event === 'connection' || event === 'LoggedOut') {
            // Determine status with multiple fallbacks
            const status = safeData.status || 
                           instanceStatusFromObject || 
                           (event === 'LoggedOut' ? 'disconnected' : undefined);
            
            console.log(`[Webhook] Processing connection update. Status: ${status}, Connection: ${safeData.connection}`);

            const connection = safeData.connection;
            const qrCode = safeData.qrCode || safeData.qrcode || safeData.base64;
            
            if (userDoc) {
                const userData = userDoc.data();
                
                // Get token from payload (preferred) or DB
                const instanceToken = token || userData.uazapi?.token;
                
                if (status === 'disconnected' || connection === 'close') {
                    console.log(`[Webhook] Instance ${instance} disconnected. Cleaning up...`);
                    
                    // 1. Delete from Provider (UAZAPI)
                    try {
                        console.log(`[Webhook] Deleting instance ${instance} from provider...`);
                        
                        if (instanceToken) {
                            // console.log(`[Webhook] Using token for deletion: ${instanceToken.substring(0, 8)}...`);
                            const deleteResult = await deleteInstanceByToken(instanceToken);
                            
                            if (deleteResult.error) {
                                console.warn(`[Webhook] deleteInstanceByToken failed: ${deleteResult.error}, trying force delete...`);
                                throw new Error(deleteResult.error);
                            }
                            console.log(`[Webhook] Instance ${instance} deleted successfully via token.`);
                        } else {
                             // Fallback to old method if no token available
                             console.warn(`[Webhook] No token available for ${instance}, trying cleanupInstanceByName...`);
                             await cleanupInstanceByName(instance);
                        }
                    } catch (e) {
                        console.error(`[Webhook] Failed to cleanup instance ${instance} with token, falling back to force delete:`, e);
                        try {
                             await forceDeleteInstance(instance);
                             console.log(`[Webhook] Instance ${instance} force delete requested.`);
                        } catch (forceError) {
                             console.error(`[Webhook] Force delete also failed for ${instance}:`, forceError);
                        }
                    }

                    // 2. Update DB status (persist connected=false)
                    // Also clear token so user can re-connect properly
                    await userDoc.ref.update({
                        'uazapi.connected': false,
                        'uazapi.status': 'disconnected',
                        'uazapi.qrCode': admin.firestore.FieldValue.delete(),
                        'uazapi.token': admin.firestore.FieldValue.delete(),
                        'uazapi.updatedAt': new Date().toISOString()
                    });
                } else if (status === 'open' || status === 'connected' || connection === 'open') {
                     console.log(`[Webhook] Instance ${instance} connected.`);
                     await userDoc.ref.update({
                        'uazapi.status': 'connected',
                        'uazapi.connected': true,
                        'uazapi.qrCode': admin.firestore.FieldValue.delete() // Clear QR code on connection
                     });
                } else if (qrCode) {
                    console.log(`[Webhook] QR Code received for ${instance}`);
                    await userDoc.ref.update({
                        'uazapi.qrCode': qrCode,
                        'uazapi.status': 'connecting',
                        'uazapi.connected': false
                    });
                }
            }
        }

        // 1.1 Handle QR Code Updates (specific event)
        if (event === 'QRCODE_UPDATED') {
            const qrCode = safeData.qrcode || safeData.qrCode || safeData.base64;
            
            if (userDoc) {
                 console.log(`[Webhook] QR Code updated for ${instance}`);
                 await userDoc.ref.update({
                     'uazapi.qrCode': qrCode,
                     'uazapi.status': 'connecting'
                 });
            }
        }

        // 1.2 Handle Message Status Updates (Delivery, Read, etc.)
        if (event === 'messages_update' || event === 'message-status-update') {
            // console.log(`[Webhook] Processing message status update for instance ${instance}`);
            const messages = safeData.messages || [];
            
            if (messages.length > 0 && userDoc) {
                const contactsRef = userDoc.ref.collection('contacts');

                for (const msg of messages) {
                    try {
                        const key = msg.key;
                        const update = msg.update;
                        const status = update?.status || msg.status;
                        
                        if (!key?.remoteJid || !status) continue;
                        
                        const phone = String(key.remoteJid).replace('@s.whatsapp.net', '');
                        
                        // Find contact
                        const contactSnapshot = await contactsRef.where('phone', '==', phone).limit(1).get();
                        
                        if (!contactSnapshot.empty) {
                            const contactDoc = contactSnapshot.docs[0];
                            const contactData = contactDoc.data();
                            
                            const updateData: any = {
                                lastMessageStatus: status,
                            };
                            
                            // Optimization: Only update timestamp if it changed significantly or status is important
                            // But status updates are important for UI, so we keep them.
                            // We can throttle 'lastMessageAt' if needed, but it's useful for sorting.
                            updateData.lastMessageAt = new Date().toISOString();
                            
                            if (status === 'read' || status === 'READ') {
                                updateData.lastReadAt = new Date().toISOString();
                            }
                            
                            await contactDoc.ref.update(updateData);
                            // console.log(`[Webhook] Updated contact ${phone} status to ${status}`);

                            // --- Update Campaign Stats ---
                            // Find any ACTIVE or SENDING campaigns that include this phone
                            // We check 'Sending', 'Scheduled', 'sent', 'Completed' (to catch late receipts)
                            const campaignsRef = userDoc.ref.collection('campaigns');
                            const activeCampaignsSnapshot = await campaignsRef
                                .where('status', 'in', ['Sending', 'Scheduled', 'sent', 'Completed']) 
                                .get();

                            if (!activeCampaignsSnapshot.empty) {
                                for (const campDoc of activeCampaignsSnapshot.docs) {
                                    const campData = campDoc.data();
                                    const phones = campData.phones || [];
                                    const batchIds = campData.batchIds || [];
                                    
                                    // Check if phone is in this campaign
                                    // Optimized: Check main phones array first
                                    let inCampaign = phones.includes(phone);
                                    
                                    // If not found in main array (maybe large campaign?), check batches
                                    if (!inCampaign && campData.batches) {
                                        for (const bid of batchIds) {
                                            const batch = campData.batches[bid];
                                            if (batch?.phones?.includes(phone)) {
                                                inCampaign = true;
                                                break;
                                            }
                                        }
                                    }

                                    if (inCampaign) {
                                        // console.log(`[Webhook] Updating stats for campaign ${campDoc.id} (Phone: ${phone}, Status: ${status})`);
                                        
                                        // Update Dispatch Record (Detailed Tracking)
                                        try {
                                            const dispatchesRef = campDoc.ref.collection('dispatches');
                                            // Try matching by messageId first (Precision)
                                            let dispatchQuery = await dispatchesRef.where('messageId', '==', key.id).limit(1).get();
                                            
                                            // Fallback to phone if not found by ID
                                            if (dispatchQuery.empty) {
                                                dispatchQuery = await dispatchesRef.where('phone', '==', phone).limit(1).get();
                                            }
                                            
                                            if (!dispatchQuery.empty) {
                                                const dispatchDoc = dispatchQuery.docs[0];
                                                const dispatchUpdate: any = {
                                                    status: status,
                                                    updatedAt: new Date().toISOString()
                                                };

                                                if (status === 'delivered') {
                                                    dispatchUpdate.deliveredAt = new Date().toISOString();
                                                } else if (status === 'read' || status === 'READ') {
                                                    dispatchUpdate.readAt = new Date().toISOString();
                                                }

                                                await dispatchDoc.ref.update(dispatchUpdate);
                                                // console.log(`[Webhook] Updated dispatch status for ${phone} in campaign ${campDoc.id} to ${status}`);
                                            }
                                        } catch (err) {
                                            console.error(`[Webhook] Failed to update dispatch for ${phone} in campaign ${campDoc.id}`, err);
                                        }

                                        // Map status to stats field
                                        const statField = 
                                            status === 'sent' ? 'stats.sent' :
                                            status === 'delivered' ? 'stats.delivered' :
                                            status === 'read' || status === 'READ' ? 'stats.read' :
                                            status === 'failed' ? 'stats.failed' : null;

                                        if (statField) {
                                            await campDoc.ref.update({
                                                [statField]: admin.firestore.FieldValue.increment(1)
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[Webhook] Error processing message status update:', e);
                    }
                }
            }
        }

        // 2. Handle New Messages (Auto-create Contacts)
        if (event === 'MESSAGES_UPSERT' || event === 'messages' || event === 'sender') {
            const messages = safeData.messages || (safeData.message ? [safeData.message] : []);

            for (const msg of messages) {
                try {
                    // Normalize message data to handle different payload formats (Baileys vs Simple)
                    const remoteJid = msg.key?.remoteJid || msg.chatid || msg.sender_pn;
                    const fromMe = msg.key?.fromMe ?? msg.fromMe;
                    const isGroup = msg.key?.remoteJid?.endsWith('@g.us') || msg.isGroup || msg.chatid?.endsWith('@g.us');
                    const pushName = msg.pushName || (msg as any).notifyName || msg.senderName || msg.wa_name;
                    
                    // Filter out invalid, API sent, or Group messages
                    if (!remoteJid) {
                        // console.warn('[Webhook] Message without remoteJid/chatid skipped:', msg);
                        continue;
                    }
                    
                    // Allow processing 'fromMe' messages as requested by user ("tanto os que eu falar")
                    // if (fromMe) continue; 
                    
                    const wasSentByApi = safeData?.wasSentByApi || msg.wasSentByApi;
                    // if (safeData?.wasSentByApi || msg.wasSentByApi) continue; // Exclude messages sent by API (Removed by user request)
                    
                    if (isGroup || safeData?.isGroup || safeData?.isGroupYes) continue; // Exclude groups
                    
                    if (remoteJid === 'status@broadcast') continue;

                    const phone = String(remoteJid).replace('@s.whatsapp.net', '');
                    
                    // Determine Name
                    let contactName = msg.pushName || (msg as any).notifyName || msg.senderName || msg.wa_name;
                    
                    // If from me, or if name is missing, try to get from chat object (if available in payload)
                    if (fromMe || !contactName) {
                        if (safeData.chat) {
                            contactName = safeData.chat.name || safeData.chat.wa_name || safeData.chat.contactName || safeData.chat.wa_contactName;
                        }
                    }
                    
                    // Fallback to phone if still no name
                    if (!contactName) contactName = phone;

                    // Skip processing if it's an API message, but maybe log it?
                    // User wants to track "who it was sent to".
                    if ((wasSentByApi || fromMe) && userDoc) {
                         // console.log(`[Webhook] Message sent (API/Manual) to ${phone}. Updating lastContactedAt...`);
                         
                         // Update contact's lastContactedAt
                         try {
                                 const userId = userDoc.id; // Need userId for interactions
                                 const contactsRef = userDoc.ref.collection('contacts');
                                 const contactSnapshot = await contactsRef.where('phone', '==', phone).limit(1).get();
                                 
                                 if (!contactSnapshot.empty) {
                                    const contactDoc = contactSnapshot.docs[0];
                                    const contactData = contactDoc.data();

                                    // OPTIMIZATION: Throttle writes for lastContactedAt
                                    // Don't update if updated in the last hour
                                    const lastContactedAt = contactData.lastContactedAt ? new Date(contactData.lastContactedAt).getTime() : 0;
                                    const now = Date.now();
                                    const oneHour = 60 * 60 * 1000;
                                    
                                    if (now - lastContactedAt > oneHour) {
                                        await contactDoc.ref.update({
                                            lastContactedAt: new Date().toISOString()
                                        });
                                        // console.log(`[Webhook] Marked ${phone} as contacted.`);
                                    }

                                    // --- Update Campaign Dispatch to SENT ---
                                    try {
                                        const campaignsRef = userDoc.ref.collection('campaigns');
                                        const activeCampaignsSnapshot = await campaignsRef
                                            .where('status', 'in', ['Sending', 'Scheduled', 'sent', 'Completed']) 
                                            .get();

                                        if (!activeCampaignsSnapshot.empty) {
                                            for (const campDoc of activeCampaignsSnapshot.docs) {
                                                const campData = campDoc.data();
                                                const phones = campData.phones || [];
                                                const batchIds = campData.batchIds || [];
                                                
                                                // Check if phone is in this campaign
                                                // Optimized: Check main phones array first
                                                let inCampaign = phones.includes(phone);
                                                
                                                // If not found in main array (maybe large campaign?), check batches
                                                if (!inCampaign && campData.batches) {
                                                    for (const bid of batchIds) {
                                                        const batch = campData.batches[bid];
                                                        if (batch?.phones?.includes(phone)) {
                                                            inCampaign = true;
                                                            break;
                                                        }
                                                    }
                                                }

                                                if (inCampaign) {
                                                    // console.log(`[Webhook] Found campaign ${campDoc.id} for sent message to ${phone}`);
                                                    
                                                    // Find Dispatch
                                                    const dispatchesRef = campDoc.ref.collection('dispatches');
                                                    const dispatchQuery = await dispatchesRef.where('phone', '==', phone).limit(1).get();
                                                    
                                                    if (!dispatchQuery.empty) {
                                                        const dispatchDoc = dispatchQuery.docs[0];
                                                        const dispatchData = dispatchDoc.data();
                                                        
                                                        // Update dispatch with messageId (Self-Healing)
                                                        if (msg.key?.id && dispatchData.messageId !== msg.key.id) {
                                                            await dispatchDoc.ref.update({
                                                                messageId: msg.key.id,
                                                                status: 'sent',
                                                                updatedAt: new Date().toISOString()
                                                            });
                                                            // console.log(`[Webhook] Linked messageId ${msg.key.id} to dispatch for ${phone}`);
                                                        }
                                                    } else {
                                                        // Optional: Create dispatch if missing? (Smart Backfill)
                                                        // Maybe overkill here, kept simple.
                                                    }
                                                }
                                            }
                                        }
                                    } catch (campError) {
                                        console.error("Error updating campaign stats for sent message", campError);
                                    }
                                 }
                         } catch (e) {
                             console.error(`[Webhook] Failed to process reply for ${phone}`, e);
                         }
                    }
                    
                    // Check for Block Action
                    let isBlockAction = false;
                    const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId || msg.buttonOrListid;
                    const listId = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || msg.buttonOrListid;
                    const textBody = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content || msg.text;
                    
                    if (buttonId === 'BLOCK_CONTACT_ACTION' || buttonId === 'block_contact') isBlockAction = true;
                    if (listId === 'BLOCK_CONTACT_ACTION' || listId === 'block_contact') isBlockAction = true;
                    if (textBody === 'Bloquear Contato' || textBody === 'bloquear') isBlockAction = true;

                    if (isBlockAction && userDoc) {
                        console.log(`[Webhook] Block action received from ${phone}`);
                        const userId = userDoc.id;
                        const contactsRef = userDoc.ref.collection('contacts');
                        const contactSnapshot = await contactsRef.where('phone', '==', phone).limit(1).get();
                        
                        if (!contactSnapshot.empty) {
                            const contactDoc = contactSnapshot.docs[0];
                            await contactDoc.ref.update({
                                segment: 'Blocked',
                                blockedAt: new Date().toISOString(),
                                notes: 'Bloqueado via botão de campanha'
                            });
                            console.log(`[Webhook] Contact ${phone} blocked for user ${userId}`);
                        }

                        // Update Campaign Stats (Blocked)
                        try {
                            const campaignsRef = userDoc.ref.collection('campaigns');
                            const campaignSnap = await campaignsRef.orderBy('sentDate', 'desc').limit(1).get();
                            if (!campaignSnap.empty) {
                                const campaignDoc = campaignSnap.docs[0];
                                await campaignDoc.ref.update({
                                    'stats.blocked': admin.firestore.FieldValue.increment(1)
                                });
                                
                                // Record Interaction
                                await campaignDoc.ref.collection('interactions').add({
                                    type: 'block',
                                    phone: phone,
                                    name: contactName || phone,
                                    createdAt: new Date().toISOString()
                                });
                            }
                        } catch (e) {
                            console.error("Failed to update campaign stats (blocked)", e);
                        }
                        
                        continue; 
                    }

                    // Check if contact already exists
                    if (userDoc) {
                        const userId = userDoc.id;
                        
                        // Access subcollection users/{uid}/contacts
                        const contactsRef = userDoc.ref.collection('contacts');
                        const contactSnapshot = await contactsRef.where('phone', '==', phone).limit(1).get();

                        if (contactSnapshot.empty) {
                            await contactsRef.add({
                                name: contactName,
                                phone: phone,
                                email: '',
                                segment: 'Active',
                                userId: userId,
                                tags: ['auto-created', 'whatsapp'],
                                createdAt: new Date().toISOString(),
                                lastReplyAt: new Date().toISOString()
                            });
                            console.log(`[Webhook] Created new contact ${phone} (${contactName}) for user ${userId}`);
                        } else {
                            // Update lastReplyAt for existing contact
                            const contactDoc = contactSnapshot.docs[0];
                            const contactData = contactDoc.data();
                            
                            // OPTIMIZATION: Throttle writes for lastReplyAt
                            const lastReplyAt = contactData.lastReplyAt ? new Date(contactData.lastReplyAt).getTime() : 0;
                            const now = Date.now();
                            const oneHour = 60 * 60 * 1000;
                            
                            if (now - lastReplyAt > oneHour) {
                                await contactDoc.ref.update({
                                    lastReplyAt: new Date().toISOString()
                                });
                                // console.log(`[Webhook] Updated lastReplyAt for existing contact ${phone}`);
                            }
                        }

                        // Update Campaign Stats (Replied)
                        // Only if NOT fromMe (engagement is when THEY reply)
                        // Also exclude API sent messages from "Replied" stats
                        if (!fromMe && !wasSentByApi) {
                            try {
                                const campaignsRef = userDoc.ref.collection('campaigns');
                                const campaignSnap = await campaignsRef.orderBy('sentDate', 'desc').limit(1).get();
                                if (!campaignSnap.empty) {
                                    const campaignDoc = campaignSnap.docs[0];
                                    const campaignData = campaignDoc.data();
                                    
                                    // Optimization: Only attribute reply to campaign if sent recently (e.g. 72 hours)
                                    // This prevents organic chats from polluting old campaign stats and saves writes
                                    const sentDate = campaignData.sentDate ? new Date(campaignData.sentDate).getTime() : 0;
                                    const now = Date.now();
                                    const threeDays = 72 * 60 * 60 * 1000;
                                    
                                    if (now - sentDate < threeDays) {
                                        await campaignDoc.ref.update({
                                            'stats.replied': admin.firestore.FieldValue.increment(1),
                                            'engagement': admin.firestore.FieldValue.increment(1) // Simple engagement score
                                        });

                                        // Record Interaction
                                        // Extract text content
                                        const textContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content || msg.text || '';
                                        
                                        await campaignDoc.ref.collection('interactions').add({
                                            type: 'reply',
                                            phone: phone,
                                            name: contactName || phone,
                                            content: textContent,
                                            createdAt: new Date().toISOString()
                                        });
                                    }
                                }
                            } catch (e) {
                                console.error("Failed to update campaign stats (replied)", e);
                            }
                        } else if (wasSentByApi) {
                             // console.log(`[Webhook] API Message confirmed for ${phone}`);
                        }
                    } else {
                        console.log(`[Webhook] No user found for instance ${instance} when processing message from ${phone}`);
                    }
                } catch (msgError) {
                    console.error('[Webhook] Error processing message:', msgError);
                }
            }
        }

        if (event === 'sender' && userDoc) {
            const campaignsRef = userDoc.ref.collection('campaigns');
            const folderId = String(safeData.folder_id || safeData.folderId || safeData.folderID);
            const status = safeData.status || 'updated';
            const count = typeof safeData.count === 'number' ? safeData.count : safeData.messageCount;
            
            // Helper to extract stats
            const extractStats = () => {
                    const stats: any = {};
                    if (safeData.info && typeof safeData.info === 'object') {
                    if (typeof safeData.info.sent === 'number') stats.sent = safeData.info.sent;
                    if (typeof safeData.info.failed === 'number') stats.failed = safeData.info.failed;
                    if (typeof safeData.info.delivered === 'number') stats.delivered = safeData.info.delivered;
                    } else if (count !== undefined) {
                    if (['completed', 'sent', 'done'].includes(status.toLowerCase())) {
                        stats.sent = count;
                    }
                    }
                    return stats;
            };
            
            const newStats = extractStats();

            if (folderId) {
                // Strategy:
                // 1. Check if direct doc exists (Legacy/Single Campaign)
                // 2. Check if it's a batch in a larger campaign
                
                const directDocRef = campaignsRef.doc(folderId);
                const directDocSnap = await directDocRef.get();

                if (directDocSnap.exists) {
                        // Legacy Update
                        const payload: any = {
                            status,
                            updatedAt: new Date().toISOString(),
                        };
                        if (count !== undefined) payload.count = count;
                        // Flatten stats for legacy root update
                        Object.entries(newStats).forEach(([k, v]) => {
                            payload[`stats.${k}`] = v;
                        });
                        if (status.toLowerCase() === 'sending' && count !== undefined) {
                            payload['recipients'] = count;
                        }
                        await directDocRef.update(payload);
                        console.log(`[Webhook] Updated legacy campaign ${folderId}`);
                } else {
                    // Check for Batch
                    const batchQuery = await campaignsRef.where('batchIds', 'array-contains', folderId).get();
                    
                    if (!batchQuery.empty) {
                        const campaignDoc = batchQuery.docs[0];
                        const campaignData = campaignDoc.data();
                        
                        // Prepare batch update
                        const batchUpdateKey = `batches.${folderId}`;
                        const updatePayload: any = {
                            [`${batchUpdateKey}.status`]: status,
                            [`${batchUpdateKey}.updatedAt`]: new Date().toISOString()
                        };
                        
                        // Update Batch Stats
                        Object.entries(newStats).forEach(([k, v]) => {
                            updatePayload[`${batchUpdateKey}.stats.${k}`] = v;
                        });
                        
                        // Calculate Global Stats
                        // We need to fetch current batches, overlay our new data, and sum up.
                        const currentBatches = campaignData.batches || {};
                        const currentBatch = currentBatches[folderId] || {};
                        const updatedBatch = {
                            ...currentBatch,
                            stats: { ...(currentBatch.stats || {}), ...newStats },
                            status: status
                        };
                        
                        // Re-aggregate
                        const allBatches = { ...currentBatches, [folderId]: updatedBatch };
                        const globalStats = {
                            sent: 0,
                            delivered: 0,
                            failed: 0,
                            read: (campaignData.stats?.read || 0), // Read/Replied come from different events, keep existing
                            replied: (campaignData.stats?.replied || 0),
                            blocked: (campaignData.stats?.blocked || 0)
                        };

                        let allCompleted = true;
                        let anySending = false;

                        Object.values(allBatches).forEach((b: any) => {
                            globalStats.sent += (b.stats?.sent || 0);
                            globalStats.delivered += (b.stats?.delivered || 0);
                            globalStats.failed += (b.stats?.failed || 0);
                            
                            if (!['completed', 'sent', 'done', 'failed'].includes(b.status?.toLowerCase())) {
                                allCompleted = false;
                            }
                            if (b.status?.toLowerCase() === 'sending') {
                                anySending = true;
                            }
                        });
                        
                        updatePayload['stats.sent'] = globalStats.sent;
                        updatePayload['stats.delivered'] = globalStats.delivered;
                        updatePayload['stats.failed'] = globalStats.failed;
                        
                        // Update Global Status
                        if (allCompleted) updatePayload['status'] = 'Completed';
                        else if (anySending) updatePayload['status'] = 'Sending';
                        
                        await campaignDoc.ref.update(updatePayload);
                        console.log(`[Webhook] Updated batch ${folderId} in campaign ${campaignDoc.id}`);

                    } else {
                        console.log(`[Webhook] No campaign found for folderId ${folderId}. Creating new legacy doc.`);
                        // Fallback to creating new doc if not found (Legacy behavior)
                            const payload: any = {
                            status,
                            updatedAt: new Date().toISOString(),
                            uazapiId: folderId // Ensure we save the ID
                        };
                        if (count !== undefined) payload.count = count;
                        Object.entries(newStats).forEach(([k, v]) => {
                            payload[`stats.${k}`] = v;
                        });
                        await campaignsRef.doc(folderId).set(payload);
                    }
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Webhook] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
