'use server';

import { db } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';
import { deleteCampaignFromProvider } from './whatsapp-actions';

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

    // Delete interactions subcollection
    const interactionsSnapshot = await campaignRef.collection('interactions').get();
    if (!interactionsSnapshot.empty) {
        console.log(`[CampaignAction] Deleting ${interactionsSnapshot.size} interactions...`);
        const batch = db.batch();
        // Simple batch delete (assuming < 500 interactions for now or we'd need chunking)
        // If > 500, we should chunk. Let's do simple chunking just in case.
        const chunks = [];
        let currentChunk = db.batch();
        let count = 0;
        
        interactionsSnapshot.docs.forEach((doc) => {
            currentChunk.delete(doc.ref);
            count++;
            if (count >= 499) {
                chunks.push(currentChunk);
                currentChunk = db.batch();
                count = 0;
            }
        });
        if (count > 0) chunks.push(currentChunk);
        
        await Promise.all(chunks.map(c => c.commit()));
    }

    // Delete batches from UAZAPI
    const campaignData = docSnap.data();
    if (campaignData?.batchIds && Array.isArray(campaignData.batchIds) && campaignData.batchIds.length > 0) {
        console.log(`[CampaignAction] Found ${campaignData.batchIds.length} batches to delete from provider.`);
        
        // Delete all batches in parallel
        await Promise.all(campaignData.batchIds.map(async (batchId: string) => {
            try {
                console.log(`[CampaignAction] Deleting batch ${batchId} from provider...`);
                await deleteCampaignFromProvider(userId, batchId);
            } catch (e) {
                console.warn(`[CampaignAction] Failed to delete batch ${batchId}:`, e);
            }
        }));
    }

    // Try to delete main campaign ID from UAZAPI (legacy or single campaign)
    // We assume campaignId might be the UAZAPI folderId/campaignId in legacy cases
    console.log(`[CampaignAction] Deleting campaign ${campaignId} from provider...`);
    const providerResult = await deleteCampaignFromProvider(userId, campaignId);
    
    if (providerResult.error) {
        console.warn(`[CampaignAction] Failed to delete from provider: ${providerResult.error}`);
        // We continue to delete from DB anyway, as the user wants it gone
    }
    
    // Ensure document is deleted (controlCampaign might have done it, but we double check)
    await campaignRef.delete();
    
    revalidatePath('/campaigns');
    return { success: true };
  } catch (error: any) {
    console.error('Erro ao excluir campanha:', error);
    return { success: false, error: 'Erro interno ao excluir campanha.' };
  }
}

export async function getCampaignInteractionsAction(userId: string, campaignId: string) {
  try {
    const snapshot = await db.collection('users').doc(userId).collection('campaigns').doc(campaignId).collection('interactions').orderBy('createdAt', 'desc').get();
    
    const interactions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return { success: true, data: interactions };
  } catch (error: any) {
    console.error('Error fetching interactions:', error);
    return { success: false, error: error.message };
  }
}
