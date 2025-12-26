'use server';

export async function uploadToCatbox(formData: FormData) {
  try {
    const file = formData.get('fileToUpload') as File;
    if (!file) throw new Error('No file provided');

    // Re-construct FormData for the fetch call
    // Since we are in a server action receiving FormData, we can process it or forward it.
    // However, node-fetch or native fetch in Node environment with FormData might need 'form-data' package or careful handling.
    // Next.js App Router uses native fetch which supports FormData.
    
    // We need to ensure 'reqtype' is set.
    if (!formData.get('reqtype')) {
        formData.append('reqtype', 'fileupload');
    }

    const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Catbox upload failed: ${response.status} ${text}`);
    }

    const url = await response.text();
    return { url };
  } catch (error: any) {
    console.error('Catbox upload error:', error);
    return { error: error.message };
  }
}
