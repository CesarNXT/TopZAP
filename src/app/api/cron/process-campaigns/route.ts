import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Helper to get API URL
const getApiUrl = () => process.env.UAZAPI_URL || 'https://atendimento.uazapi.com';

function getRandomDelay(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const key = searchParams.get('key');
        
        // Simple API Key protection for CronJob.org (or similar services)
        // If CRON_SECRET is set in env, we require it. If not, we allow public (not recommended but user asked "sem burocracia")
        // But better to at least check for a key if provided.
        // Let's assume user will provide ?key=...
        // For now, if they provide a key and it matches env, good.
        // If env is not set, we skip check (careful!).
        
        // BETTER: Check if it's Vercel Cron (Auth header) OR Valid Key
        const authHeader = request.headers.get('authorization');
        const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
        
        // If user provided a custom key in URL, we can validate it against an env var or hardcoded value?
        // User asked for "sem burocracia". 
        // Let's just allow if no secret is configured, OR if key matches.
        // If CRON_SECRET is configured, we require it either in header or query param.
        
        if (process.env.CRON_SECRET) {
            if (!isVercelCron && key !== process.env.CRON_SECRET) {
                 return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
            }
        }
        
        const now = Date.now();
        console.log('[Cron] Starting campaign processing...');

        // 1. Query Active Campaigns (Scheduled or Sending) - SCALABLE APPROACH
        // We use collectionGroup to find ONLY active campaigns across all users.
        // This avoids reading "all users" and scales to millions of users.
        
        let activeCampaignDocs: any[] = [];
        try {
            const campaignsSnapshot = await db.collectionGroup('campaigns')
                .where('status', 'in', ['Scheduled', 'Sending'])
                .get();
            
            if (!campaignsSnapshot.empty) {
                activeCampaignDocs = campaignsSnapshot.docs;
            }
        } catch (error: any) {
            console.error('[Cron] CollectionGroup Error (likely missing index):', error.message);
            // Fallback for dev environment if index is missing
            if (error.message.includes('requires an index') || error.code === 9) {
                 console.log('[Cron] Falling back to user scan (Dev Mode)...');
                 const usersSnapshot = await db.collection('users').get();
                 await Promise.all(usersSnapshot.docs.map(async (userDoc) => {
                      const campaignsSnap = await userDoc.ref.collection('campaigns')
                         .where('status', 'in', ['Scheduled', 'Sending'])
                         .get();
                      if (!campaignsSnap.empty) activeCampaignDocs.push(...campaignsSnap.docs);
                 }));
            } else {
                throw error;
            }
        }

        if (activeCampaignDocs.length === 0) {
            console.log('[Cron] No active campaigns found.');
            return NextResponse.json({ success: true, processed: 0 });
        }

        // --- GLOBAL SAFETY THROTTLE ---
        // Group campaigns by user to strictly enforce per-user limits.
        const campaignsByUser: Record<string, any[]> = {};
        for (const doc of activeCampaignDocs) {
            const uid = doc.data().userId;
            if (uid) {
                if (!campaignsByUser[uid]) campaignsByUser[uid] = [];
                campaignsByUser[uid].push(doc);
            }
        }
        // ------------------------------

        let processedCount = 0;

        // PARALLEL PROCESSING BY USER
        // We process each USER in parallel.
        // Inside each user, we strictly enforce the limit (1 msg/min).
        
        const userIds = Object.keys(campaignsByUser);
        
        // SCALABILITY: Process users in chunks to avoid resource exhaustion
        // 1000 users -> 20 chunks of 50. Each chunk takes ~1-2s. Total ~40s. Safe for Vercel.
        const CHUNK_SIZE = 50; 
        const userChunks = [];
        for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
            userChunks.push(userIds.slice(i, i + CHUNK_SIZE));
        }

        let totalProcessed = 0;

        for (const chunk of userChunks) {
            const chunkResults = await Promise.all(chunk.map(async (userId) => {
                const userCampaigns = campaignsByUser[userId];
                
                // STRICT LIMIT: 1 Message Per Minute Per User
                // If user has multiple campaigns (e.g. unpaused manually), we force a rotation.
                // "Rodízio Inteligente": Pick one based on minute.
                const currentMinute = new Date().getMinutes();
                const selectedIndex = currentMinute % userCampaigns.length;
                const campaignToRun = userCampaigns[selectedIndex];

                // The others are skipped for this minute to strictly enforce 1 msg/min/user.
                
                try {
                const campaignDoc = campaignToRun;
                // REFRESH CHECK: Ensure campaign still exists and is active (Prevent Zombie Sends)
                const freshSnap = await campaignDoc.ref.get();
                if (!freshSnap.exists) {
                    console.log(`[Cron] Campaign ${campaignDoc.id} deleted during processing. Skipping.`);
                    return 0;
                }
                const campaignData = freshSnap.data();
                if (campaignData.status !== 'Scheduled' && campaignData.status !== 'Sending') {
                    console.log(`[Cron] Campaign ${campaignDoc.id} status is ${campaignData.status}. Skipping.`);
                    return 0;
                }
                
                const campaignId = campaignDoc.id;
                
                // Check Schedule / Delay
                const nextRunAt = campaignData.nextRunAt || 0;
                
                // TIMEZONE CHECK (Safety):
                // Server is UTC. stored nextRunAt is UTC timestamp.
                // Comparison is correct: UTC vs UTC.
                if (now < nextRunAt) {
                    return 0; // Not time yet
                }

                // ... (Continue with processing for this single campaign)
                
                // Get User Token (We need to fetch user doc to get token)
                const userDocRef = db.collection('users').doc(userId);
                const userSnap = await userDocRef.get();
                const userData = userSnap.data();
                const token = userData?.uazapi?.token;

                if (!token) {
                    console.error(`[Cron] User ${userId} has no token. Pausing campaign ${campaignId}.`);
                    await campaignDoc.ref.update({ status: 'Paused', error: 'Missing API Token' });
                    return 0;
                }

                const BATCH_SIZE = 1; // Strict 1 msg/min
                
                // Get batch of pending items
                const queueSnapshot = await campaignDoc.ref.collection('queue')
                    .where('status', '==', 'pending')
                    .orderBy('scheduledAt', 'asc')
                    .limit(BATCH_SIZE)
                    .get();

                if (queueSnapshot.empty) {
                    console.log(`[Cron] Campaign ${campaignId} queue is empty. Marking as Completed.`);
                    await campaignDoc.ref.update({ status: 'Completed', completedAt: new Date().toISOString() });
                    return 0;
                }

                // Process Batch
                let processedInBatch = 0;
                for (const queueDoc of queueSnapshot.docs) {
                    const queueData = queueDoc.data();
                    
                    // Double check individual schedule (UTC vs UTC)
                    if (queueData.scheduledAt && new Date(queueData.scheduledAt).getTime() > now) {
                        continue; 
                    }

                    const contactPhone = queueData.phone;
                    const contactName = queueData.name || contactPhone;

                    // Prepare Messages
                    const messages = campaignData.messageTemplate || [];
                    const speedConfig = campaignData.speedConfig || { minDelay: 110, maxDelay: 130 };
                    const trackId = `camp_${campaignId}_${queueDoc.id}`;

                    let success = true;
                    let errorDetails = '';

                    // Send Loop
                    for (const msg of messages) {
                        const payload: any = {
                            number: contactPhone,
                            ...msg,
                            track_id: trackId,
                            track_source: 'TopZAP'
                        };

                        if (payload.text) {
                            payload.text = payload.text.replace('{{name}}', contactName);
                        }

                        if (payload.choices && Array.isArray(payload.choices)) {
                             payload.choices = payload.choices.map((choice: string) => {
                                 if (choice.includes('|')) {
                                     const parts = choice.split('|');
                                     const label = parts[0];
                                     const id = parts.slice(1).join('|');
                                     if (id.includes(`_camp_${campaignId}`)) return choice;
                                     return `${label}|${id}_camp_${campaignId}`;
                                 } else {
                                     const slug = choice.toLowerCase().replace(/[^a-z0-9]/g, '_');
                                     return `${choice}|${slug}_camp_${campaignId}`;
                                 }
                             });
                        }

                        if (['image', 'video', 'audio', 'document', 'sticker'].includes(payload.type)) {
                             if (!payload.file && payload.image) payload.file = payload.image;
                             if (!payload.file && payload.video) payload.file = payload.video;
                             if (!payload.file && payload.audio) payload.file = payload.audio;
                             if (!payload.file && payload.document) payload.file = payload.document;
                             if (!payload.file && payload.url) payload.file = payload.url;
                        }

                        // Determine Endpoint
                        let endpoint = '/send/text';
                        if (payload.type === 'button' || payload.choices || payload.imageButton) {
                            endpoint = '/send/menu';
                        } else if (['image', 'video', 'document', 'audio', 'ptt', 'sticker'].includes(payload.type)) {
                            endpoint = '/send/media';
                        }

                        try {
                            const res = await fetch(`${getApiUrl()}${endpoint}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'token': token, 
                                    'User-Agent': 'TopZAP-Cron/1.0'
                                },
                                body: JSON.stringify(payload)
                            });

                            if (!res.ok) {
                                const err = await res.json();
                                if (err.error && err.error.includes('pode enviar uma mensagem por minuto')) {
                                     // RATE LIMIT HIT
                                     // Back off
                                     console.warn(`[Cron] Rate Limit Hit for User ${userId}. Backing off.`);
                                     await campaignDoc.ref.update({ nextRunAt: Date.now() + 65000 }); // Wait > 1 min
                                     return processedInBatch; 
                                }
                                success = false;
                                errorDetails = err.error || 'Unknown API Error';
                                console.error(`[Cron] Send Failed for ${contactPhone}: ${errorDetails}`);
                                break;
                            }
                        } catch (e: any) {
                            success = false;
                            errorDetails = e.message;
                            console.error(`[Cron] Network Error for ${contactPhone}:`, e);
                            break;
                        }

                        if (messages.length > 1) await new Promise(r => setTimeout(r, 1500));
                    }

                    // Update Queue & Campaign
                    const batchKey = queueData.scheduledAt ? new Date(queueData.scheduledAt).toISOString().split('T')[0] : null;
                    const batchUpdate = (batchKey && campaignData.batches && campaignData.batches[batchKey]) ? {
                        [`batches.${batchKey}.stats.sent`]: FieldValue.increment(1)
                    } : {};

                    if (success) {
                        await queueDoc.ref.update({
                            status: 'sent', 
                            sentAt: new Date().toISOString(),
                            trackId: trackId
                        });

                        await campaignDoc.ref.update({
                            'stats.sent': FieldValue.increment(1),
                            'stats.pending': FieldValue.increment(-1),
                            status: 'Sending',
                            lastMessageAt: new Date().toISOString(),
                            ...batchUpdate
                        });
                    } else {
                        const batchFailUpdate = (batchKey && campaignData.batches && campaignData.batches[batchKey]) ? {
                            [`batches.${batchKey}.stats.failed`]: FieldValue.increment(1)
                        } : {};

                        await queueDoc.ref.update({
                            status: 'failed',
                            error: errorDetails,
                            failedAt: new Date().toISOString()
                        });

                        await campaignDoc.ref.update({
                            'stats.failed': FieldValue.increment(1),
                            'stats.pending': FieldValue.increment(-1),
                            ...batchFailUpdate
                        });
                    }
                    
                    processedInBatch++;
                } // End Batch Loop

                // Update next run time
                // Add delay (min 60s to ensure <1 msg/min avg if continuous, but we rely on cron 1 min interval)
                // We add a small delay to avoid double execution if cron overlaps
                const delay = getRandomDelay(speedConfig.minDelay, speedConfig.maxDelay);
                if (queueSnapshot.size > 0) {
                     await campaignDoc.ref.update({ nextRunAt: Date.now() + delay });
                }
                
                return processedInBatch;
            } catch (err: any) {
                console.error(`[Cron] Error processing campaign ${campaignToRun.id}:`, err);
                return 0;
            }
        }));

        totalProcessed += chunkResults.reduce((a, b) => a + b, 0);
        } // End Chunk Loop

        return NextResponse.json({ success: true, processed: totalProcessed });
    } catch (error: any) {
        console.error('[Cron] Critical Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
