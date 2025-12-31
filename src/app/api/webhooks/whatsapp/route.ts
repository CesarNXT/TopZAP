import { NextResponse } from 'next/server';
import { db, admin } from '@/lib/firebase-admin';
import { cleanupInstanceByName, forceDeleteInstance, deleteInstanceByToken } from '@/app/actions/whatsapp-actions';

export async function POST(request: Request) {
    try {
        let body;
        try {
             body = await request.json();
             console.log('[Webhook] Full Payload:', JSON.stringify(body, null, 2));
        } catch (jsonError) {
             console.error('[Webhook] Error parsing JSON body:', jsonError);
             const rawBody = await request.text();
             console.log('[Webhook] Raw Body:', rawBody);
             return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        let { instance, event, data, EventType, instanceName, type, token } = body;
        
        // Check Headers for Token if not in body
        if (!token) {
            token = request.headers.get('token') || request.headers.get('Token');
        }

        // Unified Parsing Logic
        if (type === 'LoggedOut') event = 'LoggedOut';
        else if (!event && EventType) event = EventType;
        else if (!event && type) event = type;

        console.log(`[Webhook] Processing event: ${event} for instance: ${instance}`);

        // Resolve Instance Name
        let instanceStatusFromObject = undefined;
        if (typeof instance === 'object' && instance !== null) {
            instanceStatusFromObject = instance.status;
            instance = instance.name || instance.instanceName || instanceName;
        }
        if (!instance && instanceName) instance = instanceName;
        if (!instance && data?.instance) instance = data.instance;
        if (!instance && data?.instanceKey) instance = data.instanceKey;
        // UAZAPI Update Fix: Sometimes instance name is at root level 'instanceName' (handled)
        // But the log showed "instance: undefined" while "instanceName": "aUi5O8" was present in payload.
        // The issue is likely variable shadowing or order.
        if (!instance && body.instanceName) instance = body.instanceName;
        
        console.log(`[Webhook] Final Instance Identifier: ${instance}`);

        // Find User
        let userDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
        let userId: string | null = null;

        // PRIORITY 1: Look up by Token (Most reliable as per user input)
        if (token) {
             const usersRef = db.collection('users');
             const querySnapshot = await usersRef.where('uazapi.token', '==', token).limit(1).get();
             if (!querySnapshot.empty) {
                 userDoc = querySnapshot.docs[0];
                 userId = userDoc.id;
                 
                 // Update instance name in DB if it changed
                 if (instance && userDoc.data().uazapi?.instanceName !== instance) {
                     console.log(`[Webhook] Updating instance name for user ${userId} to ${instance}`);
                     await userDoc.ref.update({ 'uazapi.instanceName': instance });
                 }
                 
                 console.log(`[Webhook] User found via TOKEN: ${userId} (Token: ${token})`);
             } else {
                 console.warn(`[Webhook] Token provided (${token}) but NO USER found with this token. Check 'uazapi.token' in users collection.`);
             }
        }

        // PRIORITY 2: Look up by Instance Name (Fallback)
        if (!userDoc && instance) {
             const usersRef = db.collection('users');
             let querySnapshot = await usersRef.where('uazapi.instanceName', '==', instance).limit(1).get();
             
             if (querySnapshot.empty) {
                 querySnapshot = await usersRef.where('uazapi.instanceId', '==', instance).limit(1).get();
             }

             if (!querySnapshot.empty) {
                 userDoc = querySnapshot.docs[0];
                 userId = userDoc.id;
                 console.log(`[Webhook] User found via INSTANCE: ${userId} (Instance: ${instance})`);
             }
        }
        
        if (!userDoc) {
             console.log(`[Webhook] No user found for instance '${instance}' or token. Skipping processing.`);
             return NextResponse.json({ success: true, message: 'No user found' });
        }

        const safeData = data || body || {};

        // --- CORE: Connection Status Handling (KEEPING ONLY THIS) ---
        if (event === 'CONNECTION_UPDATE' || event === 'connection' || event === 'LoggedOut') {
            const status = safeData.status || 
                           instanceStatusFromObject || 
                           (event === 'LoggedOut' ? 'disconnected' : undefined);
            
            const connection = safeData.connection;
            const qrCode = safeData.qrCode || safeData.qrcode || safeData.base64;
            
            console.log(`[Webhook] Connection Update: ${status} | ${connection}`);

            const userData = userDoc.data();
            const instanceToken = token || userData.uazapi?.token;
            
            if (status === 'disconnected' || connection === 'close') {
                console.log(`[Webhook] Instance ${instance} disconnected.`);
                
                // Cleanup Provider
                try {
                    if (instanceToken) {
                        await deleteInstanceByToken(instanceToken);
                    } else {
                        await cleanupInstanceByName(instance);
                    }
                } catch (e) {
                    console.error(`[Webhook] Cleanup failed, forcing delete:`, e);
                    await forceDeleteInstance(instance).catch(console.error);
                }

                // Update DB
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
                    'uazapi.qrCode': admin.firestore.FieldValue.delete()
                 });
            } else if (qrCode) {
                console.log(`[Webhook] QR Code received.`);
                await userDoc.ref.update({
                    'uazapi.qrCode': qrCode,
                    'uazapi.status': 'connecting',
                    'uazapi.connected': false
                });
            }
        }

        // QR Code specific event
        if (event === 'QRCODE_UPDATED') {
            const qrCode = safeData.qrcode || safeData.qrCode || safeData.base64;
            if (qrCode) {
                 console.log(`[Webhook] QR Code updated.`);
                 await userDoc.ref.update({
                     'uazapi.qrCode': qrCode,
                     'uazapi.status': 'connecting'
                 });
            }
        }

        // --- ALL OTHER LOGIC (Contacts, Campaigns, Mass Messages) REMOVED AS REQUESTED ---

        // --- NEW: Simple Contact Creation Logic (User Request: "todo contato que falar com o meu numero seja cadastrado") ---
        if (event === 'MESSAGES_UPSERT' || event === 'messages') {
            let messages: any[] = [];
            
            // Robust Message Extraction
            if (Array.isArray(safeData.messages)) {
                messages = safeData.messages;
            } else if (safeData.message) {
                messages = [safeData.message];
            } else if (safeData.key || safeData.chatid || safeData.id || safeData.remoteJid || safeData.conversation || safeData.text) {
                messages = [safeData];
            } else if (Array.isArray(body.messages)) {
                messages = body.messages;
            }

            console.log(`[Webhook] Processing ${messages.length} messages for contact creation.`);

            for (const msg of messages) {
                try {
                    const remoteJid = msg.key?.remoteJid || msg.chatid || msg.sender_pn || msg.remoteJid || msg.id;
                    const fromMe = msg.key?.fromMe ?? msg.fromMe;
                    const isGroup = msg.key?.remoteJid?.endsWith('@g.us') || msg.isGroup || msg.chatid?.endsWith('@g.us') || String(remoteJid).endsWith('@g.us');
                    
                    if (!remoteJid || isGroup || remoteJid === 'status@broadcast') continue;

                    const phone = String(remoteJid).replace('@s.whatsapp.net', '');
                    
                    // Determine Name
                    let contactName = null;

                    // If message is FROM ME, we can't use pushName (it would be MY name)
                    // We must rely on Chat metadata or default to Phone
                    if (fromMe) {
                        console.log(`[Webhook] Message is FROM ME. Ignoring pushName to avoid naming contact as self.`);
                    } else {
                        // If from contact, use their pushName
                        contactName = msg.pushName || (msg as any).notifyName || msg.senderName || msg.wa_name;
                    }

                    // Try to get name from Chat object (works for both directions if provided by API)
                    if (!contactName && safeData.chat) {
                        contactName = safeData.chat.name || safeData.chat.wa_name || safeData.chat.contactName;
                    }
                    
                    // Final fallback
                    if (!contactName) contactName = phone;

                    // Database Operations
                    const contactsRef = userDoc.ref.collection('contacts');
                    
                    // --- CAMPAIGN TRACKING (Update Queue Status) ---
                    const trackId = msg.track_id || msg.trackId;
                    if (trackId && typeof trackId === 'string' && trackId.startsWith('camp_')) {
                         console.log(`[Webhook] Tracking ID found: ${trackId}. Updating campaign status...`);
                         const parts = trackId.split('_');
                         if (parts.length === 3) {
                             const campaignId = parts[1];
                             const queueId = parts[2];
                             
                             // Update Queue Item
                             const queueRef = userDoc.ref.collection('campaigns').doc(campaignId).collection('queue').doc(queueId);
                             
                             // We update to 'delivered' or 'sent' based on webhook
                             // Since this is UPSERT, it usually means "Sent" or "Delivered" to server
                             await queueRef.update({
                                 status: 'sent', // Confirmed by webhook
                                 sentAt: new Date().toISOString(),
                                 webhookReceivedAt: new Date().toISOString()
                             }).catch(err => console.warn(`[Webhook] Queue update failed (might be already deleted): ${err.message}`));

                             // Note: We don't increment 'stats.sent' here because 'process-campaigns' already did it optimistically.
                             // But if we want to be strict, we could have 'process-campaigns' set it to 'sending' and here set to 'sent'.
                             // For now, let's just log the confirmation timestamp.
                         }
                    }

                    const contactSnapshot = await contactsRef.where('phone', '==', phone).limit(1).get();

                    let contactDocRef;

                    if (contactSnapshot.empty) {
                        const direction = fromMe ? "OUTGOING (I spoke)" : "INCOMING (They spoke)";
                        console.log(`[Webhook] New contact detected [${direction}]: ${phone}. Creating for UserID: ${userId}...`);
                        
                        contactDocRef = await contactsRef.add({
                            name: contactName,
                            phone: phone,
                            chatId: remoteJid,
                            segment: 'Active',
                            userId: userId,
                            tags: ['auto-created', 'whatsapp'],
                            createdAt: new Date().toISOString(),
                            lastMessageAt: new Date().toISOString(),
                            lastReplyAt: (!fromMe) ? new Date().toISOString() : null,
                            lastContactedAt: (fromMe) ? new Date().toISOString() : null
                        });
                        console.log(`[Webhook] SUCCESS: Contact ${phone} created successfully for UserID: ${userId}`);
                    } else {
                        // Contact Exists - Update Activity AND Name if better name found
                        const contactDoc = contactSnapshot.docs[0];
                        contactDocRef = contactDoc.ref;
                        const contactData = contactDoc.data();
                        
                        const updateData: any = { lastMessageAt: new Date().toISOString() };
                        
                        if (!fromMe) updateData.lastReplyAt = new Date().toISOString();
                        else updateData.lastContactedAt = new Date().toISOString();

                        // If the existing name is just the phone number, and we found a real name, update it!
                        if (contactName && contactName !== phone && contactData.name === phone) {
                            updateData.name = contactName;
                            console.log(`[Webhook] Enhancing contact name: '${contactData.name}' -> '${contactName}'`);
                        }

                        await contactDoc.ref.update(updateData);
                        console.log(`[Webhook] Contact ${phone} ALREADY EXISTS. Updated activity (and name if better) for UserID: ${userId}`);
                    }

                    // --- NEW: Campaign Interaction Tracking ---
                    // If the message is from the contact (not me), check if it's a reply to a recent campaign
                    if (!fromMe && userId) {
                        try {
                            // Extract message content safely first
                            console.log('[Webhook] Raw Message Object:', JSON.stringify(msg.message, null, 2));

                            let msgContent = '';
                            let buttonId = '';
                            let buttonText = '';
                            
                            // 1. Buttons (High Priority)
                            if (msg.message?.buttonsResponseMessage) {
                                buttonId = msg.message.buttonsResponseMessage.selectedButtonId || '';
                                buttonText = msg.message.buttonsResponseMessage.selectedDisplayText || '';
                                msgContent = buttonId || buttonText;
                            } else if (msg.message?.templateButtonReplyMessage) {
                                buttonId = msg.message.templateButtonReplyMessage.selectedId || '';
                                buttonText = msg.message.templateButtonReplyMessage.selectedDisplayText || '';
                                msgContent = buttonId || buttonText;
                            } else if (msg.message?.listResponseMessage) {
                                buttonId = msg.message.listResponseMessage.singleSelectReply?.selectedRowId || '';
                                buttonText = msg.message.listResponseMessage.title || '';
                                msgContent = buttonId || buttonText;
                            } 
                            
                            // 2. Text (Fallback)
                            if (!msgContent) {
                                    msgContent = msg.message?.conversation || 
                                                msg.message?.extendedTextMessage?.text || 
                                                (typeof msg.content === 'string' ? msg.content : '') || 
                                                (msg.text?.body || msg.text || '');
                            }

                            console.log(`[Webhook] Interaction Content: "${msgContent}" (ID: ${buttonId}, Text: ${buttonText}) from ${phone}`);

                            // Determine Interaction Type EARLY (for robust blocking)
                            const contentLower = (typeof msgContent === 'string' ? msgContent.toLowerCase() : '');
                            const buttonTextLower = buttonText.toLowerCase();
                            
                            // STRICT BLOCK LOGIC: Only trigger if explicitly the Block Button (ID or Text)
                            const isBlock = contentLower === 'block_contact' || 
                                            contentLower.includes('block_contact') || // ID might have suffixes
                                            buttonTextLower === 'bloquear contato' ||
                                            buttonTextLower === 'bloquear'; // Allow 'bloquear' if it's a BUTTON text

                            // --- NEW: Global Contact Blocking Logic (Execute IMMEDIATELY) ---
                            // We block even if we can't link to a campaign, or if they already replied.
                            if (isBlock && contactDocRef) {
                                try {
                                    await contactDocRef.update({
                                        segment: 'Blocked',
                                        blockedAt: new Date().toISOString(),
                                        notes: `Blocked via Campaign Interaction (Msg: ${msgContent})`
                                    });
                                    console.log(`[Webhook] Contact ${phone} BLOCKED globally due to user request.`);
                                } catch (blockError) {
                                    console.error(`[Webhook] Failed to block contact ${phone}:`, blockError);
                                }
                            }

                            // PRECISE TRACKING: Check for Campaign ID in button payload (ID preferred)
                            let targetCampaignId = null;
                            const searchSource = buttonId || (typeof msgContent === 'string' ? msgContent : '');
                            
                            if (searchSource && searchSource.includes('_camp_')) {
                                // Use split to safely get the LAST part, handling cases where the original ID might contain '_camp_'
                                const parts = searchSource.split('_camp_');
                                if (parts.length > 1) {
                                    // The last part is the campaign ID
                                    targetCampaignId = parts[parts.length - 1];
                                    console.log(`[Webhook] PRECISE TRACKING: Found Campaign ID ${targetCampaignId} in button payload.`);
                                }
                            }

                            // If precise tracking found, use it. Otherwise, use time window.
                            let campaignDocToUpdate = null;
                            let queueDocToUpdate = null;

                            if (targetCampaignId) {
                                // Direct Lookup via Button ID (Most Reliable)
                                const campRef = userDoc.ref.collection('campaigns').doc(targetCampaignId);
                                const campSnap = await campRef.get();
                                if (campSnap.exists) {
                                    // User confirmed format is always 55... in DB and Webhook.
                                    // We'll trust 'phone' first, but keep a simple fallback just in case.
                                    const possiblePhones = [phone, phone.replace(/^55/, ''), `55${phone}`];
                                    const uniquePhones = [...new Set(possiblePhones)];

                                    for (const p of uniquePhones) {
                                        const snap = await campRef.collection('queue')
                                            .where('phone', '==', p)
                                            .limit(1)
                                            .get();
                                        
                                        if (!snap.empty) {
                                            campaignDocToUpdate = campSnap;
                                            queueDocToUpdate = snap.docs[0];
                                            break; 
                                        }
                                    }
                                }
                            } else {
                                // Fallback: Text Response or Button without ID -> Check Recent Campaigns (Last 24h)
                                // User Rule: "se ele me responder com texto ou com botão apos a campanha vamos tratar como iteração"
                                const yesterday = new Date();
                                yesterday.setDate(yesterday.getDate() - 1);
                                const yesterdayIso = yesterday.toISOString();

                                const campaignsRef = userDoc.ref.collection('campaigns');
                                const recentCampaignsSnapshot = await campaignsRef
                                    .where('updatedAt', '>=', yesterdayIso)
                                    .orderBy('updatedAt', 'desc') // Get most recent first
                                    .get();

                                if (!recentCampaignsSnapshot.empty) {
                                    for (const campDoc of recentCampaignsSnapshot.docs) {
                                        // Check if this phone was in this campaign's queue
                                        const queueSnapshot = await campDoc.ref.collection('queue')
                                            .where('phone', '==', phone)
                                            .where('status', '==', 'sent')
                                            .where('sentAt', '>=', yesterdayIso)
                                            .limit(1)
                                            .get();

                                        if (!queueSnapshot.empty) {
                                            campaignDocToUpdate = campDoc;
                                            queueDocToUpdate = queueSnapshot.docs[0];
                                            console.log(`[Webhook] Text/Generic Interaction linked to recent campaign: ${campDoc.id}`);
                                            break; // Stop at the most recent campaign found
                                        }
                                    }
                                }
                            }

                            if (campaignDocToUpdate && queueDocToUpdate) {
                                const queueData = queueDocToUpdate.data();

                                // Only count if not already replied (unless we want to track all, but stats usually count unique replies)
                                // EXCEPTION: If it is a BLOCK action, we allow overwriting 'replied' status to 'blocked', unless already blocked.
                                    if (!queueData.repliedAt || (isBlock && queueData.status !== 'blocked')) {
                                        console.log(`[Webhook] INTERACTION RECORDED! Campaign: ${campaignDocToUpdate.id}, Phone: ${phone}`);

                                        const timestamp = new Date().toISOString();
                                        
                                        // 'isBlock' is already determined above.
                                        const interactionType = isBlock ? 'block' : 'reply';
                                        const statusUpdate = isBlock ? 'blocked' : 'replied';
                                        
                                        // Global blocking logic is already executed above.

                                        // 1. Update Queue Item
                                        await queueDocToUpdate.ref.update({
                                            status: statusUpdate,
                                            repliedAt: timestamp,
                                            replyMessage: msgContent
                                        });

                                        // 2. Add to Interactions Subcollection
                                        await campaignDocToUpdate.ref.collection('interactions').add({
                                            type: interactionType,
                                            phone: phone,
                                            name: queueData.name || contactName || phone,
                                            timestamp: timestamp,
                                            message: msgContent,
                                            queueId: queueDocToUpdate.id
                                        });

                                        // 3. Update Campaign Stats
                                        await campaignDocToUpdate.ref.update({
                                            [`stats.${isBlock ? 'blocked' : 'replied'}`]: admin.firestore.FieldValue.increment(1)
                                        });
                                    }
                            }

                        } catch (interactionError) {
                            console.error('[Webhook] Error tracking interaction:', interactionError);
                        }
                    }

                } catch (msgError) {
                    console.error('[Webhook] Error processing message for contact:', msgError);
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Webhook] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
