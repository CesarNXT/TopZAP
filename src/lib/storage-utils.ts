import { FirebaseStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

/**
 * Uploads a file to Firebase Storage and returns the download URL.
 * @param storage FirebaseStorage instance
 * @param file File to upload
 * @param path Storage path (e.g., 'campaigns/user123/image.png')
 * @returns Promise resolving to the download URL
 */
export async function uploadFileToStorage(
    storage: FirebaseStorage, 
    file: File, 
    path: string
): Promise<string> {
    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file);
    
    return new Promise((resolve, reject) => {
        uploadTask.on('state_changed',
            (snapshot) => {
                // You can add progress tracking here if needed
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                // Only log every ~10% to avoid spamming console
                if (progress % 10 < 1 || progress === 100) {
                     console.log('Upload is ' + Math.floor(progress) + '% done');
                }
            }, 
            (error) => {
                // Handle unsuccessful uploads
                console.error("Firebase Storage Upload Error:", error);
                reject(error);
            }, 
            () => {
                // Handle successful uploads on complete
                getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
                    resolve(downloadURL);
                });
            }
        );
    });
}