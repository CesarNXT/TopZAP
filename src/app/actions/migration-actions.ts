'use server';

import { db } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';

export async function standardizeContactStatuses(userId: string) {
  try {
    const contactsRef = db.collection('users').doc(userId).collection('contacts');
    const snapshot = await contactsRef.get();
    
    if (snapshot.empty) {
        return { success: true, count: 0 };
    }

    const batchSize = 500;
    const batches = [];
    let batch = db.batch();
    let operationCount = 0;
    let updatedCount = 0;

    snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const currentSegment = data.segment;
        let newSegment = null;

        // Map legacy statuses to new binary system
        if (currentSegment === 'New' || currentSegment === 'Regular') {
            newSegment = 'Active';
        } else if (currentSegment === 'Inactive') {
            newSegment = 'Blocked';
        } else if (currentSegment !== 'Active' && currentSegment !== 'Blocked') {
            // Default fallback for any unknown status
             newSegment = 'Active';
        }

        // Only update if change is needed
        const updates: any = {};
        if (newSegment && newSegment !== currentSegment) {
            updates.segment = newSegment;
        }

        // Backfill lastMessageAt if missing (ensure sortability)
        if (!data.lastMessageAt) {
            updates.lastMessageAt = data.createdAt || new Date(0).toISOString();
        }

        if (Object.keys(updates).length > 0) {
            batch.update(doc.ref, updates);
            operationCount++;
            updatedCount++;
        }

        // Commit batch if full
        if (operationCount >= batchSize) {
            batches.push(batch.commit());
            batch = db.batch();
            operationCount = 0;
        }
    });

    // Commit remaining operations
    if (operationCount > 0) {
        batches.push(batch.commit());
    }

    await Promise.all(batches);
    
    revalidatePath('/contacts');
    revalidatePath('/campaigns/new');
    
    return { success: true, count: updatedCount };
  } catch (error: any) {
    console.error('Error standardizing contacts:', error);
    return { success: false, error: error.message };
  }
}
