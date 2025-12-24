import { NextResponse } from 'next/server';
import { db, admin } from '@/lib/firebase-admin';
import { forceDeleteInstance } from '@/app/actions/whatsapp-actions';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('[Webhook] Received payload:', JSON.stringify(body, null, 2));

        let { instance, event, data } = body;

        // Fallback: Try to find instance in data if not at root
        if (!instance && data?.instance) instance = data.instance;
        if (!instance && data?.instanceKey) instance = data.instanceKey;
        
        // Fallback: Try to find event in data or type
        if (!event && body.type) event = body.type;

        if (!instance || !event) {
            console.error('[Webhook] Missing instance or event', { instance, event, bodyKeys: Object.keys(body) });
            return NextResponse.json({ error: 'Invalid payload', received: body }, { status: 400 });
        }

        const safeData = data || {};

        // 1. Handle Connection Updates
        if (event === 'CONNECTION_UPDATE' || event === 'connection') {
            const { status, connection } = safeData;
            const qrCode = safeData.qrCode || safeData.qrcode || safeData.base64;
            
            // Find the user who owns this instance
            // Using Admin SDK syntax
            const usersRef = db.collection('users');
            const querySnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();

            if (!querySnapshot.empty) {
                const userDoc = querySnapshot.docs[0];
                
                if (status === 'disconnected' || connection === 'close') {
                    console.log(`[Webhook] Instance ${instance} disconnected. Cleaning up...`);
                    
                    // 1. Delete from Provider (UAZAPI)
                    try {
                        console.log(`[Webhook] Deleting instance ${instance} from provider...`);
                        await forceDeleteInstance(instance);
                        console.log(`[Webhook] Instance ${instance} deleted from provider.`);
                    } catch (e) {
                        console.error(`[Webhook] Failed to delete instance ${instance} from provider:`, e);
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
                // Filter out API sent messages (fromMe), Group messages, and specific flags requested
                if (msg?.key?.fromMe) continue; // Exclude own messages
                if (safeData?.wasSentByApi) continue; // Exclude messages sent by API (if flag present)
                
                if (msg?.key?.remoteJid?.endsWith('@g.us')) continue; // Exclude groups
                if (safeData?.isGroup || safeData?.isGroupYes) continue; // Exclude groups (explicit flags)
                
                if (msg?.key?.remoteJid === 'status@broadcast') continue;

                const phone = String(msg.key.remoteJid).replace('@s.whatsapp.net', '');
                const pushName = msg.pushName || phone;

                // Check for Block Action
                let isBlockAction = false;
                const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId;
                const listId = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
                const textBody = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                
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
                                await campaignSnap.docs[0].ref.update({
                                    'stats.blocked': admin.firestore.FieldValue.increment(1)
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

                if (!userSnapshot.empty) {
                    const userDoc = userSnapshot.docs[0];
                    const userId = userDoc.id;
                    
                    // Access subcollection users/{uid}/contacts
                    const contactsRef = db.collection('users').doc(userId).collection('contacts');
                    const contactSnapshot = await contactsRef.where('phone', '==', phone).get();

                    if (contactSnapshot.empty) {
                        await contactsRef.add({
                            name: pushName,
                            phone: phone,
                            email: '',
                            tags: ['auto-created', 'whatsapp'],
                            createdAt: new Date().toISOString(),
                            lastReplyAt: new Date().toISOString()
                        });
                        console.log(`[Webhook] Created new contact ${phone} for user ${userId}`);
                    } else {
                        // Update lastReplyAt for existing contact
                        const contactDoc = contactSnapshot.docs[0];
                        await contactDoc.ref.update({
                            lastReplyAt: new Date().toISOString()
                        });
                    }

                    // Update Campaign Stats (Replied)
                    // Assuming any message that is NOT a block is a reply/engagement
                    try {
                        const campaignsRef = db.collection('users').doc(userId).collection('campaigns');
                        const campaignSnap = await campaignsRef.orderBy('sentDate', 'desc').limit(1).get();
                        if (!campaignSnap.empty) {
                            await campaignSnap.docs[0].ref.update({
                                'stats.replied': admin.firestore.FieldValue.increment(1),
                                'engagement': admin.firestore.FieldValue.increment(1) // Simple engagement score
                            });
                        }
                     } catch (e) {
                         console.error("Failed to update campaign stats (replied)", e);
                     }
                }
            }
        }

        if (event === 'sender') {
            const usersRef = db.collection('users');
            const querySnapshot = await usersRef.where('uazapi.instanceName', '==', instance).get();
            if (!querySnapshot.empty) {
                const userDoc = querySnapshot.docs[0];
                const campaignsRef = userDoc.ref.collection('campaigns');
                const folderId = safeData.folder_id || safeData.folderId;
                const status = safeData.status || 'updated';
                const count = typeof safeData.count === 'number' ? safeData.count : undefined;
                
                const payload: any = {
                    status,
                    updatedAt: new Date().toISOString(),
                };
                
                if (count !== undefined) payload.count = count;
                if (safeData.info) {
                    payload.info = safeData.info;
                    // Map info to stats
                    if (safeData.info.sent) payload['stats.sent'] = safeData.info.sent;
                    if (safeData.info.failed) payload['stats.failed'] = safeData.info.failed;
                    if (safeData.info.delivered) payload['stats.delivered'] = safeData.info.delivered;
                } else if (count !== undefined) {
                    // Fallback if no info object
                    payload['stats.sent'] = count;
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
