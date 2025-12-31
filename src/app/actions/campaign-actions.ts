'use server';

import { db } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';
import { deleteCampaignFromProvider } from './whatsapp-actions';
import { FieldValue } from 'firebase-admin/firestore';
import { format, addDays, differenceInCalendarDays } from 'date-fns';
import { deleteCampaignMedia } from '@/lib/storage-cleanup';

import { getNextValidTime, ScheduleRule, calculateCampaignSchedule } from '@/lib/campaign-schedule';

// --- MANAGED CAMPAIGN ACTIONS ---

interface CreateManagedCampaignInput {
  userId: string;
  name: string;
  messageTemplate: any[]; // The array of message objects (text, image, buttons, etc.)
  recipients: { name: string; phone: string; [key: string]: any }[];
  speedConfig: {
    mode: 'slow' | 'normal' | 'fast';
    minDelay: number; // seconds
    maxDelay: number; // seconds
  };
  scheduledAt?: string; // ISO string
  startNow?: boolean; // Force first batch to start immediately
  workingHours?: {
      start: string; // "08:00"
      end: string;   // "19:00"
  };
  scheduleRules?: ScheduleRule[];
}

export async function createManagedCampaign(input: CreateManagedCampaignInput) {
  const { userId, name, messageTemplate, recipients, speedConfig, scheduledAt, startNow, workingHours, scheduleRules } = input;
  
  console.log(`[ManagedCampaign] Creating campaign '${name}' for user ${userId}. Recipients: ${recipients.length}, StartNow: ${startNow}`);

  if (!userId || !name || !messageTemplate || !recipients || recipients.length === 0) {
    console.error("[ManagedCampaign] Invalid input data:", { userId, name, recipientsLen: recipients?.length });
    return { success: false, error: 'Dados inválidos para criação da campanha.' };
  }

  try {
    const campaignsRef = db.collection('users').doc(userId).collection('campaigns');

    // --- SCHEDULE ADJUSTMENT (Start Now Logic) ---
    const activeScheduleRules = scheduleRules ? [...scheduleRules] : [];
    let effectiveStartDate = scheduledAt ? new Date(scheduledAt) : new Date();

    if (startNow) {
        effectiveStartDate = new Date(); // Start Immediately

        // Allow TODAY fully (00:00 to 23:59) to ensure immediate start regardless of working hours
        const todayStr = format(effectiveStartDate, 'yyyy-MM-dd');
        
        // Remove existing rule for today if any
        const existingTodayIndex = activeScheduleRules.findIndex(r => r.date === todayStr);
        if (existingTodayIndex >= 0) {
            activeScheduleRules.splice(existingTodayIndex, 1);
        }
        
        activeScheduleRules.push({
            date: todayStr,
            start: '00:00',
            end: '23:59',
            active: true
        });

        // If there was a scheduledAt in the future, block days in between
        if (scheduledAt) {
            const originalScheduledDate = new Date(scheduledAt);
            // Only if scheduled date is strictly after today
            if (differenceInCalendarDays(originalScheduledDate, effectiveStartDate) > 0) {
                // Block from Tomorrow until ScheduledDate (exclusive)
                let blockPointer = addDays(effectiveStartDate, 1);
                while (differenceInCalendarDays(originalScheduledDate, blockPointer) > 0) {
                    const blockDateStr = format(blockPointer, 'yyyy-MM-dd');
                    // Check if there is already a rule, if so, override or skip? Override to block.
                    const existingIdx = activeScheduleRules.findIndex(r => r.date === blockDateStr);
                    if (existingIdx >= 0) activeScheduleRules.splice(existingIdx, 1);

                    activeScheduleRules.push({
                        date: blockDateStr,
                        active: false // Block this day
                    });
                    blockPointer = addDays(blockPointer, 1);
                }
            }
        }
    }

    // --- VALIDATION: Check for Overlapping Campaigns ---
    // User Requirement: "Only 1 message per minute per user".
    // We strictly prevent creating a campaign that overlaps with an existing active campaign.
    
    // 1. Calculate Expected Duration of NEW campaign
    const simulatedBatches = calculateCampaignSchedule(
        recipients.length,
        speedConfig,
        effectiveStartDate,
        workingHours,
        activeScheduleRules
    );

    if (simulatedBatches.length > 0) {
        const newStart = simulatedBatches[0].startTime.getTime();
        const newEnd = simulatedBatches[simulatedBatches.length - 1].endTime.getTime();

        // 2. Query Active Campaigns
        const activeCampaignsSnapshot = await campaignsRef
            .where('status', 'in', ['Scheduled', 'Sending'])
            .get();

        for (const doc of activeCampaignsSnapshot.docs) {
            const data = doc.data();
            // Determine existing campaign range
            const existingStart = data.scheduledAt ? new Date(data.scheduledAt).getTime() : 0;
            let existingEnd = existingStart;

            if (data.batches) {
                // Find max endTime in batches
                const batchKeys = Object.keys(data.batches);
                if (batchKeys.length > 0) {
                     for (const key of batchKeys) {
                         const b = data.batches[key];
                         if (b.endTime) {
                             const t = new Date(b.endTime).getTime();
                             if (t > existingEnd) existingEnd = t;
                         }
                     }
                } else {
                    // Batches object exists but empty? Fallback.
                     existingEnd = existingStart + (1000 * 60 * 60); 
                }
            } else {
                // Legacy or missing batches: Fallback to 1 hour or 'forever' if really paranoid.
                // Assuming 1 hour to avoid permanent blockage if data is bad.
                existingEnd = existingStart + (1000 * 60 * 60); 
            }

            // Check Overlap: (StartA < EndB) and (EndA > StartB)
            // Use a small buffer (e.g. 1 min) if needed, but strict timestamp comparison is usually fine.
            if (newStart < existingEnd && newEnd > existingStart) {
                const existingName = data.name || 'Sem nome';
                const startStr = new Date(existingStart).toLocaleString('pt-BR');
                const endStr = new Date(existingEnd).toLocaleString('pt-BR');
                return { 
                    success: false, 
                    error: `Conflito de agendamento! A campanha "${existingName}" está ativa de ${startStr} até ${endStr}. Aguarde o término para iniciar outra.` 
                };
            }
        }
    }
    // ---------------------------------------------------
    
    // Create Campaign Document
    const campaignDoc = {
      userId, // IMPORTANT: Required for security rules (ownership)
      name,
      status: 'Scheduled', // Initial status
      type: 'managed', // Distinguish from 'provider' campaigns
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sentDate: new Date().toISOString(), // Required for Firestore Query ordering (legacy field)
      scheduledAt: effectiveStartDate.toISOString(),
      messageTemplate, // Store the content structure here
      speedConfig,
      workingHours: workingHours || null, // Store preference
      scheduleRules: activeScheduleRules, // Store manual overrides (including startNow blocks)
      stats: {
        total: recipients.length,
        sent: 0,
        failed: 0,
        pending: recipients.length,
      },
      nextRunAt: effectiveStartDate.getTime(), // Timestamp for next execution
    };

    // Create a ref with auto-id, then set().
    const newCampaignRef = campaignsRef.doc();
    const campaignId = newCampaignRef.id;

    // --- INJECT CAMPAIGN ID & ENSURE BLOCK BUTTON ---
    // This ensures we can track exactly which campaign a button click came from.
    // User Requirement: "Block Contact" button MUST be present on ALL messages (Text, Image, Video).
    // For Audio (which doesn't support buttons), we append a separate options message.

    const processedTemplate: any[] = [];

    messageTemplate.forEach((msg: any) => {
        const newMsg = { ...msg };
        const type = newMsg.type || (newMsg.text ? 'text' : 'unknown');
        
        // Check if this message type supports attached buttons (Interactive Message)
        // Note: 'image' and 'video' can become 'media menu'. 'text' becomes 'text menu'.
        // 'audio'/'ptt' cannot have buttons attached directly.
        const supportsButtons = ['text', 'image', 'video'].includes(type);

        if (supportsButtons) {
            // Ensure choices array exists
            if (!newMsg.choices || !Array.isArray(newMsg.choices)) {
                newMsg.choices = [];
            }

            // 1. Process existing choices (Inject Campaign ID)
            newMsg.choices = newMsg.choices.map((choice: string) => {
                // Ignore section headers
                if (choice.trim().startsWith('[')) return choice;

                let text = choice;
                let id = choice;
                let suffix = '';

                if (choice.includes('|')) {
                    const parts = choice.split('|');
                    text = parts[0];
                    id = parts[1];
                    if (parts.length > 2) suffix = '|' + parts.slice(2).join('|');
                }

                const isSpecial = id.startsWith('call:') || id.startsWith('copy:') || id.startsWith('url:') || id.startsWith('http');
                
                if (!isSpecial && !id.includes(`_camp_${campaignId}`)) {
                     id = `${id}_camp_${campaignId}`;
                }

                return `${text}|${id}${suffix}`;
            });

            // 2. Add "Bloquear Contato" button if missing
            const hasBlockButton = newMsg.choices.some((c: string) => {
                 const id = c.split('|')[1] || '';
                 return id.toLowerCase().includes('block') || id.toLowerCase().includes('bloquear');
            });

            if (!hasBlockButton && newMsg.choices.length < 3) {
                 const blockBtnId = `block_contact_camp_${campaignId}`;
                 newMsg.choices.push(`Bloquear Contato|${blockBtnId}`);
            }

            processedTemplate.push(newMsg);

        } else {
            // Message types that DO NOT support buttons (Audio, Sticker, etc.)
            processedTemplate.push(newMsg);

            // Force append a text message with Block button
            // This satisfies "obrigatorio em todas as mensagens" for Audio/Sticker
            const blockBtnId = `block_contact_camp_${campaignId}`;
            processedTemplate.push({
                type: 'text',
                text: 'Opções:',
                choices: [`Bloquear Contato|${blockBtnId}`]
            });
        }
    });

    // Create Campaign Document with processed template
    const finalCampaignDoc = {
      ...campaignDoc,
      messageTemplate: processedTemplate
    };

    await newCampaignRef.set(finalCampaignDoc);
    
    console.log(`[ManagedCampaign] Created campaign ${campaignId} with ${recipients.length} recipients.`);

    // Create Queue (Batch Write)
    // Firestore batch limit is 500. We need to chunk.
    const queueRef = newCampaignRef.collection('queue');
    
    const chunks = [];
    const chunkSize = 450; // Safe margin
    for (let i = 0; i < recipients.length; i += chunkSize) {
      chunks.push(recipients.slice(i, i + chunkSize));
    }

    let loadedCount = 0;
    
    // Scheduling Logic with Working Hours Support
    // Use AVERAGE delay for scheduling visualization
    const avgDelay = Math.floor((speedConfig.minDelay + speedConfig.maxDelay) / 2) * 1000;
    
    // Initialize current schedule pointer
    let currentSchedulePointer = new Date(effectiveStartDate);
    
    // Apply initial adjustment using the shared logic
    currentSchedulePointer = getNextValidTime(
        currentSchedulePointer, 
        workingHours, 
        activeScheduleRules
    );

    // Track batches for summary
    const batches: Record<string, any> = {};

    // Parallelize batch commits for speed
    const batchPromises = [];

    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach(recipient => {
        
        // 1. Assign time
        const itemScheduledTime = new Date(currentSchedulePointer);
        
        // Batch Aggregation
        const dateKey = itemScheduledTime.toISOString().split('T')[0]; // YYYY-MM-DD
        if (!batches[dateKey]) {
            batches[dateKey] = {
                id: dateKey,
                name: `Lote ${Object.keys(batches).length + 1}`, // "Lote 1", "Lote 2"...
                scheduledAt: itemScheduledTime.toISOString(), // Use start time of the batch
                endTime: itemScheduledTime.toISOString(),
                count: 0,
                status: 'pending',
                stats: { sent: 0, delivered: 0, failed: 0 }
            };
        }
        batches[dateKey].count++;
        batches[dateKey].endTime = itemScheduledTime.toISOString();

        // 2. Add to batch
        const docRef = queueRef.doc(); 
        batch.set(docRef, {
          ...recipient,
          status: 'pending',
          createdAt: new Date().toISOString(),
          scheduledAt: itemScheduledTime.toISOString(),
        });

        // 3. Advance pointer for next item
        currentSchedulePointer = new Date(currentSchedulePointer.getTime() + avgDelay);
        
        // 4. Re-check/Adjust for Working Hours using shared logic
        currentSchedulePointer = getNextValidTime(
            currentSchedulePointer, 
            workingHours, 
            activeScheduleRules
        );
      });
      
      // Push promise to array instead of awaiting immediately
      batchPromises.push(batch.commit());
      loadedCount += chunk.length;
    }

    // Wait for all batches to complete
    await Promise.all(batchPromises);
    console.log(`[ManagedCampaign] Loaded ${loadedCount}/${recipients.length} recipients into queue.`);

    // Save batches summary to campaign
    await newCampaignRef.update({
        batches: batches
    });

    revalidatePath('/campaigns');
    return { success: true, campaignId };

  } catch (error: any) {
    console.error('[ManagedCampaign] Error creating campaign:', error);
    return { success: false, error: error.message || 'Erro ao criar campanha gerenciada.' };
  }
}

// --- EXISTING ACTIONS ---

export async function deleteCampaignAction(userId: string, campaignId: string) {
  if (!userId || !campaignId) {
    return { success: false, error: 'Parâmetros inválidos.' };
  }

  try {
    const campaignRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId);
    const docSnap = await campaignRef.get();

    if (!docSnap.exists) {
      return { success: false, error: 'Campanha não encontrada.' };
    }

    const campaignData = docSnap.data();

    // 0. Immediate Kill Switch: Mark as Paused/Deleted to stop Cron immediately
    await campaignRef.update({ status: 'Paused' });

    // 1. Delete interactions subcollection
    const interactionsRef = campaignRef.collection('interactions');
    while (true) {
        const snapshot = await interactionsRef.limit(400).get();
        if (snapshot.empty) break;
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    // 2. Delete Queue (for managed campaigns)
    if (campaignData?.type === 'managed') {
        const queueRef = campaignRef.collection('queue');
        while (true) {
            const snapshot = await queueRef.limit(400).get();
            if (snapshot.empty) break;
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
    }

    // 3. Delete from Provider (if linked)
    // Only if it has a UAZAPI ID (legacy or linked)
    // Managed campaigns don't exist on provider as a "campaign", but maybe we want to stop messages?
    // We already do that by deleting the doc (cron checks existence).
    
    // If it was a legacy campaign, call provider delete
    if (campaignData?.uazapiId) {
        await deleteCampaignFromProvider(userId, campaignData.uazapiId);
    }

    // 4. Delete the campaign document
    await campaignRef.delete();

    revalidatePath('/campaigns');
    return { success: true };

  } catch (error: any) {
    console.error('Error deleting campaign:', error);
    return { success: false, error: error.message };
  }
}

export async function getCampaignInteractionsAction(userId: string, campaignId: string) {
  try {
    const interactionsRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId).collection('interactions');
    const snapshot = await interactionsRef.orderBy('timestamp', 'desc').limit(100).get();
    
    const interactions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    return { success: true, data: interactions };
  } catch (error: any) {
    console.error('Error fetching interactions:', error);
    return { success: false, error: error.message };
  }
}

export async function getCampaignDispatchesAction(userId: string, campaignId: string, pageSize = 50, startAfterPhone?: string) {
  try {
    const campaignRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    const campaignData = campaignDoc.data();
    
    // If managed, use 'queue' collection. If provider (legacy), we might not have detailed dispatches stored locally 
    // unless we synced them. But usually we don't store dispatches for legacy.
    // However, if we do, they might be in 'dispatches'?
    // Let's assume 'queue' for managed.
    
    const collectionName = (campaignData?.type === 'managed') ? 'queue' : 'dispatches';

    let ref = campaignRef
      .collection(collectionName)
      .orderBy('scheduledAt') // Use scheduledAt instead of phone
      .limit(pageSize);

    // If startAfterPhone is provided (legacy name), we assume it's actually the scheduledAt string from the last item
    if (startAfterPhone) {
      ref = ref.startAfter(startAfterPhone);
    }

    const snapshot = await ref.get();
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // We return 'lastPhone' but it will now be the 'scheduledAt' value of the last item
    const lastPhone = snapshot.docs.length > 0 ? String(snapshot.docs[snapshot.docs.length - 1].get('scheduledAt')) : undefined;

    return { success: true, data: items, lastPhone, hasMore: snapshot.size === pageSize };
  } catch (error: any) {
    console.error('Error fetching dispatches:', error);
    return { success: false, error: error.message };
  }
}

export async function ensureCampaignOwnership(userId: string, campaignId: string) {
  try {
    const campaignRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId);
    const doc = await campaignRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      if (!data?.userId) {
        console.log(`[Fix] Campaign ${campaignId} missing userId. Fixing...`);
        await campaignRef.update({ userId: userId });
        return { success: true, fixed: true };
      }
    }
    return { success: true, fixed: false };
  } catch (error: any) {
    console.error('Error ensuring campaign ownership:', error);
    return { success: false, error: error.message };
  }
}

export async function generateCampaignBatchesAction(userId: string, campaignId: string) {
    try {
        const campaignRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId);
        const campaignDoc = await campaignRef.get();
        
        if (!campaignDoc.exists) return { success: false, error: "Campaign not found" };
        const campaignData = campaignDoc.data();
        
        if (campaignData?.type !== 'managed') return { success: false, error: "Only managed campaigns support batches" };

        const queueSnapshot = await campaignRef.collection('queue').get();
        if (queueSnapshot.empty) return { success: false, error: "Queue is empty" };

        const batches: Record<string, any> = {};

        queueSnapshot.docs.forEach(doc => {
            const item = doc.data();
            if (item.scheduledAt) {
                const dateKey = new Date(item.scheduledAt).toISOString().split('T')[0];
                const itemTime = new Date(item.scheduledAt).getTime();

                if (!batches[dateKey]) {
                    batches[dateKey] = {
                        id: dateKey,
                        name: `Lote ${Object.keys(batches).length + 1}`,
                        scheduledAt: item.scheduledAt, // Init start
                        endTime: item.scheduledAt,     // Init end
                        count: 0,
                        status: 'pending',
                        stats: { sent: 0, delivered: 0, failed: 0 }
                    };
                }

                // Update start/end times
                const currentStart = new Date(batches[dateKey].scheduledAt).getTime();
                const currentEnd = batches[dateKey].endTime ? new Date(batches[dateKey].endTime).getTime() : currentStart;
                
                if (itemTime < currentStart) {
                    batches[dateKey].scheduledAt = item.scheduledAt;
                }
                if (itemTime > currentEnd) {
                    batches[dateKey].endTime = item.scheduledAt;
                }

                batches[dateKey].count++;
                
                // Update stats if item is already processed
                if (item.status === 'sent') batches[dateKey].stats.sent++;
                if (item.status === 'delivered') batches[dateKey].stats.delivered++;
                if (item.status === 'failed') batches[dateKey].stats.failed++;
            }
        });

        await campaignRef.update({ batches });
        revalidatePath(`/campaigns/${campaignId}`);
        
        return { success: true, count: Object.keys(batches).length };
    } catch (error: any) {
        console.error('Error generating batches:', error);
        return { success: false, error: error.message };
    }
}
