'use server';

import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import crypto from 'crypto';
import { createManagedCampaign } from './campaign-actions';
import { format } from 'date-fns';
import { getNextValidTime, ScheduleRule } from '@/lib/campaign-schedule';

// Helper to get API URL
const getApiUrl = () => process.env.UAZAPI_URL || 'https://atendimento.uazapi.com';

export async function verifyInstanceConnection(token: string) {
    if (!token) return { success: false, error: 'Token is required' };

    try {
        const response = await fetch(`${getApiUrl()}/instance/status`, {
            method: 'GET',
            headers: {
                'token': token,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('UAZAPI Connection Error:', errorText);
            return { success: false, error: 'Failed to connect to provider. Check your token.' };
        }

        const data = await response.json();
        
        // Return success with available data
        return { 
            success: true, 
            data: {
                id: data.id || 'default',
                name: data.instanceName || 'WhatsApp Instance',
                profilePicUrl: data.profilePictureUrl || '',
                status: 'connected'
            }
        };
    } catch (error: any) {
        console.error('Error verifying connection:', error);
        return { success: false, error: error.message };
    }
}

export async function setWebhook(instanceName: string, token: string, webhookUrl: string) {
    try {
        const response = await fetch(`${getApiUrl()}/webhook`, {
            method: 'POST',
            headers: {
                'token': token,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                enabled: true,
                url: webhookUrl,
                events: [
                    "messages",
                    "sender",
                    "connection"
                ],
                excludeMessages: [
                    "wasSentByApi",
                    "isGroupYes"
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('UAZAPI Webhook Error:', errorText);
            return { success: false, error: `Failed to set webhook: ${response.statusText}` };
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error: any) {
        console.error('Error setting webhook:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteInstanceByToken(token: string) {
    try {
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function cleanupInstanceByName(instanceName: string) {
    console.log(`[Actions] Cleanup instance ${instanceName} requested`);
    return { success: true };
}

export async function forceDeleteInstance(instanceName: string) {
    console.log(`[Actions] Force delete instance ${instanceName} requested`);
    return { success: true };
}

// --- HELPER: Transform Message to Include Mandatory Buttons ---
function transformMessageForButtons(message: any): any[] {
    const mandatoryButton = "Bloquear Contato|block_contact";
    
    // If it's already a list of messages, process each
    if (Array.isArray(message)) {
        return message.flatMap(m => transformMessageForButtons(m));
    }

    const transformed = { ...message };

    // Handle Text Messages -> Button Message
    if (transformed.type === 'text' || !transformed.type) {
        const existingChoices = transformed.choices || [];
        if (!existingChoices.some((c: string) => c.includes('block_contact'))) {
            existingChoices.push(mandatoryButton);
        }

        return [{
            type: 'button',
            text: transformed.text,
            choices: existingChoices,
            footerText: transformed.footerText || ' '
        }];
    }

    // Handle Image Messages -> Button Message with Image
    if (transformed.type === 'image') {
        const existingChoices = transformed.choices || [];
        if (!existingChoices.some((c: string) => c.includes('block_contact'))) {
            existingChoices.push(mandatoryButton);
        }

        return [{
            type: 'button',
            text: transformed.text || ' ', // Use space if no text provided
            imageButton: transformed.file || transformed.url,
            choices: existingChoices,
            footerText: transformed.footerText || ' '
        }];
    }

    // Handle Other Media (Video, Document, Audio) -> Media + Button Message
    if (['video', 'document', 'audio', 'ptt', 'sticker'].includes(transformed.type)) {
        const buttonMsg = {
            type: 'button',
            text: ' ',
            choices: [mandatoryButton],
            footerText: ' '
        };
        return [transformed, buttonMsg];
    }

    // Handle Existing Button/Menu Messages
    if (transformed.type === 'button' || transformed.type === 'menu') {
        const choices = transformed.choices || [];
        if (!choices.some((c: string) => c.includes('block_contact'))) {
            choices.push(mandatoryButton);
        }
        transformed.choices = choices;
        return [transformed];
    }

    // Default fallback
    return [transformed];
}

export async function createSimpleCampaignProviderOnly(
    userId: string,
    campaignName: string,
    message: string,
    phones: string[],
    scheduledAt: number | Date,
    speed: string
) {
    try {
        let delayMin = 100;
        let delayMax = 120;
        if (speed === 'normal') { delayMin = 80; delayMax = 100; }
        else if (speed === 'fast') { delayMin = 60; delayMax = 80; }

        const recipients = phones.map(p => ({
            name: p,
            phone: p.replace(/\D/g, '')
        }));

        const baseMessage = { type: 'text', text: message };
        const messageTemplate = transformMessageForButtons(baseMessage);

        const result = await createManagedCampaign({
            userId,
            name: campaignName,
            messageTemplate,
            recipients,
            speedConfig: {
                mode: speed as any,
                minDelay: delayMin,
                maxDelay: delayMax
            },
            scheduledAt: new Date(scheduledAt).toISOString()
        });

        if (!result.success) throw new Error(result.error);

        return { success: true, id: result.campaignId, trackId: result.campaignId };
    } catch (error: any) {
        console.error('Error creating managed simple campaign:', error);
        return { success: false, error: error.message };
    }
}

export async function createAdvancedCampaignProviderOnly(
    userId: string,
    campaignName: string,
    messages: any[],
    phones: string[],
    scheduledAt: number | Date,
    speed: string
) {
    try {
        let delayMin = 100;
        let delayMax = 120;
        if (speed === 'normal') { delayMin = 80; delayMax = 100; }
        else if (speed === 'fast') { delayMin = 60; delayMax = 80; }

        const recipients = phones.map(p => ({
            name: p,
            phone: p.replace(/\D/g, '')
        }));

        const transformedMessages: any[] = [];
        messages.forEach(msg => {
            const result = transformMessageForButtons(msg);
            transformedMessages.push(...result);
        });

        const result = await createManagedCampaign({
            userId,
            name: campaignName,
            messageTemplate: transformedMessages,
            recipients,
            speedConfig: {
                mode: speed as any,
                minDelay: delayMin,
                maxDelay: delayMax
            },
            scheduledAt: new Date(scheduledAt).toISOString()
        });

        if (!result.success) throw new Error(result.error);

        return { success: true, id: result.campaignId, trackId: result.campaignId };
    } catch (error: any) {
        console.error('Error creating managed advanced campaign:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteCampaignFromProvider(userId: string, folderId: string) {
    // Managed campaigns are deleted via deleteCampaignAction in campaign-actions.ts
    // This is for legacy provider campaigns
    return { success: true };
}

// Legacy Control Function - Kept for compatibility but redirected or stubbed where possible
export async function controlCampaign(userId: string, campaignId: string, action: 'stop' | 'continue') {
    // For managed campaigns, we just update the status in Firestore
    try {
        const campaignRef = db.collection('users').doc(userId).collection('campaigns').doc(campaignId);
        const doc = await campaignRef.get();
        if (!doc.exists) return { success: false, error: 'Campaign not found' };
        
        const data = doc.data();
        if (data?.type === 'managed') {
            const updateData: any = {
                status: action === 'stop' ? 'Paused' : 'Sending', // 'Paused' prevents Cron from picking it up
                updatedAt: new Date().toISOString()
            };

            // If resuming, reset nextRunAt to now so it gets picked up by next Cron tick
            if (action === 'continue') {
                const now = new Date();
                updateData.nextRunAt = now.getTime();
                updateData.scheduledAt = now.toISOString();

                // --- RESCHEDULE LOGIC ---
                // 1. Allow Today (Force "Start Now" behavior)
                const scheduleRules = (data.scheduleRules || []) as ScheduleRule[];
                const todayStr = format(now, 'yyyy-MM-dd');
                
                // Remove existing rule for today if any
                const existingTodayIndex = scheduleRules.findIndex(r => r.date === todayStr);
                if (existingTodayIndex >= 0) {
                    scheduleRules.splice(existingTodayIndex, 1);
                }
                
                // Add "Allow All Day" rule for today
                scheduleRules.push({
                    date: todayStr,
                    start: '00:00',
                    end: '23:59',
                    active: true
                });
                updateData.scheduleRules = scheduleRules;

                // 2. Reschedule Pending Items
                const queueRef = campaignRef.collection('queue');
                const pendingSnapshot = await queueRef.where('status', '==', 'pending').orderBy('scheduledAt').get();
                
                if (!pendingSnapshot.empty) {
                    const speedConfig = data.speedConfig || { mode: 'slow', minDelay: 120, maxDelay: 300 };
                    const avgDelay = ((speedConfig.minDelay + speedConfig.maxDelay) / 2) * 1000;
                    const workingHours = data.workingHours || { start: "08:00", end: "18:00" };

                    let currentPointer = now;
                    let batch = db.batch();
                    let opCount = 0;
                    const batches: Record<string, any> = {}; 

                    // Initialize with existing batches to preserve history
                    const existingBatches = data.batches || {};
                    Object.assign(batches, existingBatches);

                    for (const doc of pendingSnapshot.docs) {
                        // Calculate next valid time
                        currentPointer = getNextValidTime(currentPointer, workingHours, scheduleRules);
                        
                        const newScheduledAt = currentPointer.toISOString();
                        
                        // Update Queue Item
                        batch.update(doc.ref, { scheduledAt: newScheduledAt });
                        opCount++;

                        // Update Batches Metadata
                        const dateKey = newScheduledAt.split('T')[0];
                        if (!batches[dateKey]) {
                            batches[dateKey] = {
                                id: dateKey,
                                name: `Lote ${Object.keys(batches).length + 1}`,
                                scheduledAt: newScheduledAt,
                                endTime: newScheduledAt,
                                count: 0,
                                status: 'pending',
                                stats: { sent: 0, delivered: 0, failed: 0 }
                            };
                        }
                        
                        // Update batch end time to reflect the latest item
                        batches[dateKey].endTime = newScheduledAt;
                        
                        // Prepare next time
                        currentPointer = new Date(currentPointer.getTime() + avgDelay);

                        if (opCount >= 450) { // Firestore batch limit safety
                            await batch.commit();
                            opCount = 0;
                            batch = db.batch();
                        }
                    }

                    if (opCount > 0) {
                        await batch.commit();
                    }
                    
                    updateData.batches = batches;
                }
            }

            await campaignRef.update(updateData);
            return { success: true, status: action === 'stop' ? 'Paused' : 'Sending' };
        }
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getCampaignsFromProvider(userId: string) {
   return { success: true, data: [] };
}

export async function getCampaignMessagesFromProvider(userId: string, campaignId: string, uazapiId?: string, page = 1, pageSize = 50) {
    return { success: true, messages: [], total: 0 };
}
