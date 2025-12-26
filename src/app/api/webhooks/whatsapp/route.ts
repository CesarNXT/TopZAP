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
        if (event === 'MESSAGES_UPSERT' || event === 'messages') {
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
                    // If it was sent by API, it's not a reply, so we shouldn't count it as engagement.
                    if (wasSentByApi) {
                         console.log(`[Webhook] Message sent by API to ${phone}. Logging interaction...`);
                         // We can log this as a 'sent' interaction to the latest campaign or just generic log
                         // Ideally we would match it to a specific campaign if we had context, but we don't always have it here.
                         // For now, let's just NOT continue, but treat it as a "system sent" message below.
                         // However, be careful NOT to trigger auto-replies or "New Contact" creation loops if not desired.
                         // Actually, creating a contact if we send a message to them via API is good behavior (they are now a contact).
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
                const folderId = safeData.folder_id || safeData.folderId || safeData.folderID;
                const status = safeData.status || 'updated';
                const count = typeof safeData.count === 'number' ? safeData.count : safeData.messageCount;
                
                const payload: any = {
                    status,
                    updatedAt: new Date().toISOString(),
                };
                
                if (count !== undefined) payload.count = count;
                if (safeData.info && typeof safeData.info === 'object') {
                    payload.info = safeData.info;
                    // Map info to stats
                    if (typeof safeData.info.sent === 'number') payload['stats.sent'] = safeData.info.sent;
                    if (typeof safeData.info.failed === 'number') payload['stats.failed'] = safeData.info.failed;
                    if (typeof safeData.info.delivered === 'number') payload['stats.delivered'] = safeData.info.delivered;
                } else if (count !== undefined) {
                    // Fallback if no info object
                    // Only mark as sent if status confirms completion
                    if (['completed', 'sent', 'done'].includes(status.toLowerCase())) {
                        payload['stats.sent'] = count;
                    }
                    // If sending, count represents total recipients
                    if (status.toLowerCase() === 'sending') {
                        payload['recipients'] = count;
                    }
                }

                if (folderId) {
                    await campaignsRef.doc(String(folderId)).set(payload, { merge: true });
                } else {
                    // If no folderId, we might want to log it or ignore. 
                    // Usually sender event comes with folderId (campaignId).
                    // If not, we can't link to a specific campaign easily without context.
                    // But we'll add it as a new doc just in case to not lose data.
                     await campaignsRef.add(payload);
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Webhook] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
