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

    // Try to delete from UAZAPI
    // We assume campaignId is the UAZAPI folderId/campaignId as per our storage strategy
    console.log(`[CampaignAction] Deleting campaign ${campaignId} from provider...`);
    const providerResult = await deleteCampaignFromProvider(userId, campaignId);
    
    if (providerResult.error) {
        console.warn(`[CampaignAction] Failed to delete from provider: ${providerResult.error}`);
        // We continue to delete from DB anyway, as the user wants it gone
    }
    
    await campaignRef.delete();
    
    revalidatePath('/campaigns');
    return { success: true };
  } catch (error: any) {
    console.error('Erro ao excluir campanha:', error);
    return { success: false, error: 'Erro interno ao excluir campanha.' };
  }
}
