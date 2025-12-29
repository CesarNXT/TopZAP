'use server';

import { db, admin } from '@/lib/firebase-admin';
import { Tag } from '@/lib/types';
import { revalidatePath } from 'next/cache';

export async function createTag(userId: string, name: string, color: string) {
  try {
    const tagRef = db.collection('users').doc(userId).collection('tags').doc();
    const newTag: Tag = {
      id: tagRef.id,
      userId,
      name,
      color,
      createdAt: new Date().toISOString()
    };
    
    await tagRef.set(newTag);
    revalidatePath('/contacts');
    return { success: true, data: newTag };
  } catch (error: any) {
    console.error('Error creating tag:', error);
    return { success: false, error: error.message };
  }
}

export async function getTags(userId: string) {
  try {
    const snapshot = await db.collection('users').doc(userId).collection('tags').get();
    const tags = snapshot.docs.map(doc => doc.data() as Tag);
    return { success: true, data: tags };
  } catch (error: any) {
    console.error('Error fetching tags:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteTag(userId: string, tagId: string) {
  try {
    await db.collection('users').doc(userId).collection('tags').doc(tagId).delete();
    revalidatePath('/contacts');
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting tag:', error);
    return { success: false, error: error.message };
  }
}

export async function updateContactTags(userId: string, contactId: string, tags: string[]) {
  try {
    await db.collection('users').doc(userId).collection('contacts').doc(contactId).update({
      tags
    });
    revalidatePath('/contacts');
    return { success: true };
  } catch (error: any) {
    console.error('Error updating contact tags:', error);
    return { success: false, error: error.message };
  }
}

export async function batchAssignTagToContacts(userId: string, tagId: string, contactIds: string[]) {
  try {
    const batchSize = 500;
    const chunks = [];
    for (let i = 0; i < contactIds.length; i += batchSize) {
      chunks.push(contactIds.slice(i, i + batchSize));
    }

    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach(contactId => {
        const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);
        batch.update(contactRef, {
            tags: admin.firestore.FieldValue.arrayUnion(tagId)
        });
      });
      await batch.commit();
    }
    revalidatePath('/contacts');
    return { success: true };
  } catch (error: any) {
    console.error('Error batch assigning tags:', error);
    return { success: false, error: error.message };
  }
}
