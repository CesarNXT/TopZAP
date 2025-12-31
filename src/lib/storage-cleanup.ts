import { admin } from '@/lib/firebase-admin';

/**
 * Deletes media files associated with a campaign from Firebase Storage.
 * @param campaignData The campaign document data containing messageTemplate
 */
export async function deleteCampaignMedia(campaignData: any) {
  if (!campaignData || !campaignData.messageTemplate) return;

  const messages = campaignData.messageTemplate;
  
  // Use default bucket
  let bucket;
  try {
      bucket = admin.storage().bucket();
  } catch (e) {
      console.warn("[StorageCleanup] Firebase Admin Storage not initialized or configured.", e);
      return;
  }

  for (const msg of messages) {
    let fileUrl = '';
    // UAZAPI format uses 'file' for media URL
    if (msg.file) fileUrl = msg.file;
    
    // Also check for 'image', 'video', 'audio', 'document' keys just in case legacy structure
    if (!fileUrl && msg.image) fileUrl = msg.image;
    if (!fileUrl && msg.video) fileUrl = msg.video;
    if (!fileUrl && msg.audio) fileUrl = msg.audio;
    if (!fileUrl && msg.document) fileUrl = msg.document;

    if (fileUrl && typeof fileUrl === 'string' && fileUrl.includes('firebasestorage')) {
        try {
            // Extract path from URL
            // Format: https://firebasestorage.googleapis.com/v0/b/[bucket]/o/[path]?alt=...
            // Path is encoded.
            // Example: .../o/campaigns%2Fuser123%2Ffile.jpg
            
            const urlObj = new URL(fileUrl);
            // pathname is like /v0/b/my-app.appspot.com/o/campaigns%2Fuser123%2Ffile.jpg
            const segments = urlObj.pathname.split('/o/');
            if (segments.length === 2) {
                const encodedPath = segments[1];
                const decodedPath = decodeURIComponent(encodedPath);
                
                console.log(`[StorageCleanup] Deleting file: ${decodedPath}`);
                const file = bucket.file(decodedPath);
                
                const [exists] = await file.exists();
                if (exists) {
                    await file.delete();
                    console.log(`[StorageCleanup] Successfully deleted ${decodedPath}`);
                } else {
                    console.log(`[StorageCleanup] File not found (already deleted?): ${decodedPath}`);
                }
            }
        } catch (error) {
            console.warn(`[StorageCleanup] Failed to delete file ${fileUrl}:`, error);
        }
    }
  }
}
