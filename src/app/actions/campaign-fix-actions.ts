'use server';

import { db } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';
import { getBrasiliaComponents } from '@/lib/campaign-schedule';

export async function fixCampaignTimezoneAction(userId: string, campaignId: string) {
    if (!userId || !campaignId) {
        return { success: false, error: 'Parâmetros inválidos.' };
    }

    try {
        console.log(`[FixTimezone] Starting fix for campaign ${campaignId}...`);
        const campaignRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId);
        const campaignSnap = await campaignRef.get();

        if (!campaignSnap.exists) {
            return { success: false, error: 'Campanha não encontrada.' };
        }

        const data = campaignSnap.data();
        const workingHours = data?.workingHours || { start: '08:00', end: '19:00' };
        const startHour = parseInt(workingHours.start.split(':')[0]);

        // Get Pending Queue Items
        const queueRef = campaignRef.collection('queue');
        const pendingSnap = await queueRef.where('status', '==', 'pending').get();

        if (pendingSnap.empty) {
            return { success: true, message: 'Nenhum item pendente para corrigir.' };
        }

        const batchLimit = 400;
        let batch = db.batch();
        let count = 0;
        let fixedCount = 0;
        let batchesCommitted = 0;

        for (const doc of pendingSnap.docs) {
            const item = doc.data();
            if (!item.scheduledAt) continue;

            const date = new Date(item.scheduledAt);
            const brt = getBrasiliaComponents(date);

            // HEURISTIC: If the scheduled time (in BRT) is strictly BEFORE the start hour,
            // it indicates the timezone shift error (UTC stored as Local).
            // Example: Stored 08:00 UTC -> 05:00 BRT. StartHour is 08.
            // 5 < 8. So we fix it.
            // We also fix if it's way off (e.g. 06:00).
            // But we don't fix if it's 08:00 (which is correct).
            
            // We also need to be careful about "Next Day" wrap.
            // If it was 23:00 UTC (20:00 BRT) and should be 23:00 BRT...
            // But usually the error is constant offset.

            if (brt.hour < startHour) {
                // Fix: Add 3 hours (10800000 ms)
                // This assumes the error is exactly the missing -3h offset.
                const newTime = new Date(date.getTime() + (3 * 60 * 60 * 1000));
                
                batch.update(doc.ref, {
                    scheduledAt: newTime.toISOString(),
                    fixedAt: new Date().toISOString() // Audit trail
                });
                
                fixedCount++;
                count++;
            }

            if (count >= batchLimit) {
                await batch.commit();
                batch = db.batch();
                count = 0;
                batchesCommitted++;
            }
        }

        if (count > 0) {
            await batch.commit();
        }

        console.log(`[FixTimezone] Fixed ${fixedCount} items for campaign ${campaignId}.`);

        // Also fix the 'nextRunAt' on the campaign doc if it exists and looks wrong
        if (data?.nextRunAt) {
             const nextRun = new Date(data.nextRunAt);
             const nextBrt = getBrasiliaComponents(nextRun);
             if (nextBrt.hour < startHour) {
                 await campaignRef.update({
                     nextRunAt: nextRun.getTime() + (3 * 60 * 60 * 1000)
                 });
             }
        }

        revalidatePath(`/campaigns/${campaignId}`);
        return { success: true, count: fixedCount };

    } catch (error: any) {
        console.error('[FixTimezone] Error:', error);
        return { success: false, error: error.message };
    }
}
