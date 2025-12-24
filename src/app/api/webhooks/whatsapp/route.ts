import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-server';
import { collection, query, where, getDocs, updateDoc, deleteField, addDoc } from 'firebase/firestore';
import { forceDeleteInstance } from '@/app/actions/whatsapp-actions';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { instance, event, data } = body;

        if (!instance || !event) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // 1. Handle Connection Updates
        if (event === 'CONNECTION_UPDATE') {
            const { status, connection } = data;
            const qrCode = data.qrCode || data.qrcode || data.base64;
            
            // Find the user who owns this instance
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('uazapi.instanceName', '==', instance));
            const querySnapshot = await getDocs(q);

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

                    // 2. Remove from DB
                    await updateDoc(userDoc.ref, {
                        uazapi: deleteField()
                    });
                } else if (status === 'open' || status === 'connected' || connection === 'open') {
                     console.log(`[Webhook] Instance ${instance} connected.`);
                     await updateDoc(userDoc.ref, {
                        'uazapi.status': 'connected',
                        'uazapi.qrCode': deleteField() // Clear QR code on connection
                     });
                } else if (qrCode) {
                    console.log(`[Webhook] QR Code received for ${instance}`);
                    await updateDoc(userDoc.ref, {
                        'uazapi.qrCode': qrCode,
                        'uazapi.status': 'qrcode'
                    });
                }
            } else {
                console.warn(`[Webhook] No user found for instance ${instance}`);
            }
        }

        // 1.1 Handle QR Code Updates (specific event)
        if (event === 'QRCODE_UPDATED') {
            const qrCode = data.qrcode || data.qrCode || data.base64;
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('uazapi.instanceName', '==', instance));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                 const userDoc = querySnapshot.docs[0];
                 console.log(`[Webhook] QR Code updated for ${instance}`);
                 await updateDoc(userDoc.ref, {
                     'uazapi.qrCode': qrCode,
                     'uazapi.status': 'qrcode'
                 });
            }
        }

        // 2. Handle New Messages (Auto-create Contacts)
        if (event === 'MESSAGES_UPSERT') {
            const messages = data.messages || [];

            for (const msg of messages) {
                // Filter out API sent messages (fromMe) and Group messages
                if (msg.key.fromMe) continue; // "excluir wasSentByAPi"
                if (msg.key.remoteJid.endsWith('@g.us')) continue; // "excluir isGroupYes"
                if (msg.key.remoteJid === 'status@broadcast') continue;

                const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '');
                const pushName = msg.pushName || phone;

                // Check if contact already exists
                // Note: Ideally we should scope this by user/organization if possible,
                // but without multi-tenancy context in the webhook (other than instance),
                // we'll assume a global contacts list or we need to find the user first.
                // Since `contacts` is likely a top-level collection in this codebase (based on contacts/page.tsx),
                // we'll check there. 
                // Wait, contacts/page.tsx uses `useCollection('contacts')`. 
                // If the app is multi-user, contacts should probably be sub-collection `users/{uid}/contacts`.
                // Let's check `contacts/page.tsx` again to be sure about the path.
                // It imports `useCollection` but `useFirestore` implies standard firestore.
                // Let's verify the collection path.
                
                // Assuming `contacts` is the collection for now.
                // To support "com o dominio que ele tiver" and "cadastro no nosso sistema",
                // we need to know WHICH user this contact belongs to.
                // We can find the user by instance name (like in disconnection logic).
                
                const usersRef = collection(db, 'users');
                const qUser = query(usersRef, where('uazapi.instanceName', '==', instance));
                const userSnapshot = await getDocs(qUser);

                if (!userSnapshot.empty) {
                    const userDoc = userSnapshot.docs[0];
                    const userId = userDoc.id;
                    
                    // Now check/add contact for this user
                    // Checking `contacts` collection. If it's global, we might need an `ownerId` field.
                    // If it's subcollection `users/{uid}/contacts`, we use that.
                    // I will check contacts/page.tsx to see how it saves contacts.
                    
                    // Re-reading contacts/page.tsx via tool logic is expensive, 
                    // but I recall `useCollection` often defaults to top level or context based.
                    // Let's assume `users/{uid}/contacts` is the best practice, 
                    // OR `contacts` with `userId` field.
                    
                    // Let's assume a global `contacts` collection with `userId` for now, 
                    // or check how `contacts/page.tsx` does it.
                    // I'll do a quick read of `contacts/page.tsx` snippet if needed, 
                    // but better yet, I'll search for `addDoc` in `contacts/page.tsx` from previous output.
                    
                    // From previous `read` of `contacts/page.tsx`:
                    // `addDoc(collection(firestore, 'users', user.uid, 'contacts'), ...)`
                    // Ah! It uses subcollections: `users/{uid}/contacts`.
                    
                    const contactsRef = collection(db, 'users', userId, 'contacts');
                    const qContact = query(contactsRef, where('phone', '==', phone));
                    const contactSnapshot = await getDocs(qContact);

                    if (contactSnapshot.empty) {
                        await addDoc(contactsRef, {
                            name: pushName,
                            phone: phone,
                            email: '',
                            tags: ['auto-created', 'whatsapp'],
                            createdAt: new Date().toISOString()
                        });
                        console.log(`[Webhook] Created new contact ${phone} for user ${userId}`);
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
