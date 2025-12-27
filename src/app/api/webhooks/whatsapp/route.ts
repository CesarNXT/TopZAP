import { NextResponse } from 'next/server';
import { db, admin } from '@/lib/firebase-admin';
import { cleanupInstanceByName, forceDeleteInstance } from '@/app/actions/whatsapp-actions';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('[Webhook] Received payload:', JSON.stringify(body, null, 2));

        let { instance, event, data, EventType, instanceName, type } = body;

        // Unified Parsing Logic
        // 1. Resolve Event Name
        // Priority: type (more specific like 'LoggedOut') > EventType > event
        if (type === 'LoggedOut') event = 'LoggedOut';
        else if (!event && EventType) event = EventType;
        else if (!event && type) event = type;

        console.log(`[Webhook] Resolved event: ${event}`);

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

        console.log(`[Webhook] Resolved instance: ${instance}`);

        // 3. Resolve Data
        const safeData = data || body || {};

        if (!instance || !event) {
            console.error('[Webhook] Missing instance or event', { instance, event, bodyKeys: Object.keys(body) });
            return NextResponse.json({ error: 'Invalid payload', received: body }, { status: 400 });
        }

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
            
            // Find the user who owns this instance
            // Using Admin SDK syntax
            const usersRef = db.collection('users');
            const querySnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();

            console.log(`[Webhook] Found ${querySnapshot.size} user(s) for instance ${instance}`);

            if (!querySnapshot.empty) {
                const userDoc = querySnapshot.docs[0];
                
                if (status === 'disconnected' || connection === 'close') {
                    console.log(`[Webhook] Instance ${instance} disconnected. Cleaning up...`);
                    
                    // 1. Delete from Provider (UAZAPI)
                    try {
                        console.log(`[Webhook] Deleting instance ${instance} from provider...`);
                        // Use robust cleanup that finds the token first
                        await cleanupInstanceByName(instance);
                        console.log(`[Webhook] Instance ${instance} cleanup requested.`);
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
                    await userDoc.ref.update({
                        'uazapi.connected': false,
                        'uazapi.status': 'disconnected',
                        'uazapi.qrCode': admin.firestore.FieldValue.delete(),
                        'uazapi.token': admin.firestore.FieldValue.delete()
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
            } else {
                console.warn(`[Webhook] No user found for instance ${instance}`);
            }
        }

        // 1.1 Handle QR Code Updates (specific event)
        if (event === 'QRCODE_UPDATED') {
            const qrCode = safeData.qrcode || safeData.qrCode || safeData.base64;
            const usersRef = db.collection('users');
            const querySnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();

            if (!querySnapshot.empty) {
                 const userDoc = querySnapshot.docs[0];
                 console.log(`[Webhook] QR Code updated for ${instance}`);
                 await userDoc.ref.update({
                     'uazapi.qrCode': qrCode,
                     'uazapi.status': 'connecting'
                 });
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
                        console.warn('[Webhook] Message without remoteJid/chatid skipped:', msg);
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
                    if (wasSentByApi || fromMe) {
                         console.log(`[Webhook] Message sent (API/Manual) to ${phone}. Updating lastContactedAt...`);
                         
                         // Update contact's lastContactedAt
                         try {
                             const usersRef = db.collection('users');
                             // Optimization: We could cache this lookup if instance is same, but for safety inside loop:
                             const userSnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();
                             
                             if (!userSnapshot.empty) {
                                 const userDoc = userSnapshot.docs[0];
                                 const contactsRef = userDoc.ref.collection('contacts');
                                 const contactSnapshot = await contactsRef.where('phone', '==', phone).get();
                                 
                                 if (!contactSnapshot.empty) {
                                     await contactSnapshot.docs[0].ref.update({
                                         lastContactedAt: new Date().toISOString()
                                     });
                                     console.log(`[Webhook] Marked ${phone} as contacted.`);
                                 } else if (fromMe && !wasSentByApi) {
                                     // Optional: Create contact if manually sent and doesn't exist?
                                     // Let's stick to updating existing for now to avoid clutter.
                                 }
                             }
                         } catch (e) {
                             console.error(`[Webhook] Failed to update lastContactedAt for ${phone}`, e);
                         }
                    }
                    
                    // Check for Block Action
                    let isBlockAction = false;
                    const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId || msg.buttonOrListid;
                    const listId = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || msg.buttonOrListid;
                    const textBody = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content || msg.text;
                    
                    if (buttonId === 'BLOCK_CONTACT_ACTION') isBlockAction = true;
                    if (listId === 'BLOCK_CONTACT_ACTION') isBlockAction = true;
                    if (textBody === 'Bloquear Contato') isBlockAction = true;

                    if (isBlockAction) {
                        console.log(`[Webhook] Block action received from ${phone}`);
                        const usersRef = db.collection('users');
                        const userSnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();
                        
                        if (!userSnapshot.empty) {
                            const userDoc = userSnapshot.docs[0];
                            const userId = userDoc.id;
                            const contactsRef = db.collection('users').doc(userId).collection('contacts');
                            const contactSnapshot = await contactsRef.where('phone', '==', phone).get();
                            
                            if (!contactSnapshot.empty) {
                                const contactDoc = contactSnapshot.docs[0];
                                await contactDoc.ref.update({
                                    segment: 'Inactive',
                                    blockedAt: new Date().toISOString(),
                                    notes: 'Bloqueado via botão de campanha'
                                });
                                console.log(`[Webhook] Contact ${phone} blocked for user ${userId}`);
                            }

                            // Update Campaign Stats (Blocked)
                            try {
                                const campaignsRef = db.collection('users').doc(userId).collection('campaigns');
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
                        }
                        continue; 
                    }

                    // Check if contact already exists
                    const usersRef = db.collection('users');
                    const userSnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();

                    if (userSnapshot.empty) {
                        console.log(`[Webhook] No user found for instance ${instance} when processing message from ${phone}`);
                    } else {
                        const userDoc = userSnapshot.docs[0];
                        const userId = userDoc.id;
                        
                        // Access subcollection users/{uid}/contacts
                        const contactsRef = db.collection('users').doc(userId).collection('contacts');
                        const contactSnapshot = await contactsRef.where('phone', '==', phone).get();

                        if (contactSnapshot.empty) {
                            await contactsRef.add({
                                name: contactName,
                                phone: phone,
                                email: '',
                                segment: 'New',
                                userId: userId,
                                tags: ['auto-created', 'whatsapp'],
                                createdAt: new Date().toISOString(),
                                lastReplyAt: new Date().toISOString()
                            });
                            console.log(`[Webhook] Created new contact ${phone} (${contactName}) for user ${userId}`);
                        } else {
                            // Update lastReplyAt for existing contact
                            const contactDoc = contactSnapshot.docs[0];
                            await contactDoc.ref.update({
                                lastReplyAt: new Date().toISOString()
                            });
                            console.log(`[Webhook] Updated lastReplyAt for existing contact ${phone}`);
                        }

                        // Update Campaign Stats (Replied)
                        // Only if NOT fromMe (engagement is when THEY reply)
                        // Also exclude API sent messages from "Replied" stats
                        if (!fromMe && !wasSentByApi) {
                            try {
                                const campaignsRef = db.collection('users').doc(userId).collection('campaigns');
                                const campaignSnap = await campaignsRef.orderBy('sentDate', 'desc').limit(1).get();
                                if (!campaignSnap.empty) {
                                    const campaignDoc = campaignSnap.docs[0];
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
                            } catch (e) {
                                console.error("Failed to update campaign stats (replied)", e);
                            }
                        } else if (wasSentByApi) {
                             // Logic for API sent messages (optional logging)
                             // Maybe we want to mark them as 'delivered' if not already?
                             // But 'sender' event handles mass status updates.
                             // This is individual message confirmation.
                             console.log(`[Webhook] API Message confirmed for ${phone}`);
                        }
                    }
                } catch (msgError) {
                    console.error('[Webhook] Error processing message:', msgError);
                }
            }
        }

        if (event === 'sender') {
            const usersRef = db.collection('users');
            const querySnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();
            if (!querySnapshot.empty) {
                const userDoc = querySnapshot.docs[0];
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
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Webhook] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
