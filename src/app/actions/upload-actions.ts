'use server';

export async function uploadToCatbox(formData: FormData) {
  const file = formData.get('fileToUpload') as File;
  if (!file) {
      return { error: 'No file provided' };
  }

  // 1. Try Catbox (Primary)
  try {
    // Clone FormData for Catbox
    const catboxData = new FormData();
    catboxData.append('reqtype', 'fileupload');
    catboxData.append('fileToUpload', file);

    const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: catboxData,
    });

    if (response.ok) {
        const url = await response.text();
        return { url };
    }
    console.warn(`Catbox upload failed: ${response.status}`);
  } catch (error: any) {
    console.warn('Catbox upload error:', error);
  }

  // 2. Fallback: Tmpfiles.org
  try {
      console.log("Attempting fallback to tmpfiles.org...");
      const tmpData = new FormData();
      tmpData.append('file', file);

      const response = await fetch('https://tmpfiles.org/api/v1/upload', {
          method: 'POST',
          body: tmpData,
      });

      if (response.ok) {
          const json = await response.json();
          if (json.status === 'success' && json.data.url) {
              // Convert to direct link: https://tmpfiles.org/123/file.jpg -> https://tmpfiles.org/dl/123/file.jpg
              const originalUrl = json.data.url;
              const directUrl = originalUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
              return { url: directUrl };
          }
      }
      console.warn(`Tmpfiles upload failed: ${response.status}`);
  } catch (error: any) {
      console.error('Tmpfiles upload error:', error);
  }

  // 3. Last Resort Fallback (if any other service exists, or just fail)
  return { error: 'Falha no upload em todos os servidores (Catbox e Tmpfiles). Tente novamente.' };
}
