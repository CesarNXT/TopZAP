
import { addDays, format, parse, isSameDay, isAfter, isBefore, set } from 'date-fns';

export interface WorkingHours {
    start: string; // "08:00"
    end: string;   // "19:00"
}

export interface ScheduleRule {
    date: string; // "YYYY-MM-DD"
    start?: string;
    end?: string;
    active: boolean; // If false, skip this day
}

export interface BatchPreview {
    id: string; // Unique ID for UI keys
    date: Date;
    startTime: Date;
    endTime: Date;
    count: number;
    isCustom: boolean; // If this specific day has a manual rule
}

export interface SpeedConfig {
    minDelay: number;
    maxDelay: number;
}

/**
 * Calculates the campaign schedule based on contacts, speed, and rules.
 */
export function calculateCampaignSchedule(
    totalContacts: number,
    speedConfig: SpeedConfig,
    startDate: Date,
    defaultWorkingHours: WorkingHours | undefined,
    rules: ScheduleRule[]
): BatchPreview[] {
    const batches: BatchPreview[] = [];
    const avgDelaySeconds = (speedConfig.minDelay + speedConfig.maxDelay) / 2;
    
    let contactsRemaining = totalContacts;
    let currentPointer = new Date(startDate);
    
    // Safety break to prevent infinite loops
    let loops = 0;
    const MAX_LOOPS = 365; // Max 1 year projection

    while (contactsRemaining > 0 && loops < MAX_LOOPS) {
        loops++;
        
        const dateStr = format(currentPointer, 'yyyy-MM-dd');
        const rule = rules.find(r => r.date === dateStr);
        
        // Determine window for this day
        let startStr = defaultWorkingHours?.start || "00:00";
        let endStr = defaultWorkingHours?.end || "23:59";
        let isActive = true;

        if (rule) {
            isActive = rule.active;
            if (rule.start) startStr = rule.start;
            if (rule.end) endStr = rule.end;
        }

        if (!isActive) {
            // Skip this day completely
            currentPointer = addDays(currentPointer, 1);
            currentPointer.setHours(0, 0, 0, 0);
            continue;
        }

        // Parse window boundaries for this specific date
        const windowStart = parse(`${dateStr} ${startStr}`, 'yyyy-MM-dd HH:mm', new Date());
        const windowEnd = parse(`${dateStr} ${endStr}`, 'yyyy-MM-dd HH:mm', new Date());

        // Adjust currentPointer if it's before the window start
        if (isBefore(currentPointer, windowStart)) {
            currentPointer = windowStart;
        }

        // If currentPointer is already past window end, move to next day
        if (isAfter(currentPointer, windowEnd)) {
            currentPointer = addDays(currentPointer, 1);
            currentPointer.setHours(0, 0, 0, 0); // Will be adjusted in next iteration
            continue;
        }

        // Calculate available time in this window
        // Available seconds = (WindowEnd - CurrentPointer) / 1000
        const availableSeconds = (windowEnd.getTime() - currentPointer.getTime()) / 1000;
        
        if (availableSeconds <= 0) {
             currentPointer = addDays(currentPointer, 1);
             currentPointer.setHours(0, 0, 0, 0);
             continue;
        }

        // Calculate how many contacts fit
        // Each contact takes avgDelaySeconds
        const capacity = Math.floor(availableSeconds / avgDelaySeconds);
        
        // Take the minimum of capacity or remaining
        const countForBatch = Math.min(capacity, contactsRemaining);
        
        // If count is 0 (e.g. less than one message time remaining), move to next day? 
        // Or if it fits at least one?
        if (countForBatch <= 0) {
             currentPointer = addDays(currentPointer, 1);
             currentPointer.setHours(0, 0, 0, 0);
             continue;
        }

        // Calculate actual end time for this batch
        const batchDurationSeconds = countForBatch * avgDelaySeconds;
        const batchEndTime = new Date(currentPointer.getTime() + (batchDurationSeconds * 1000));

        batches.push({
            id: dateStr,
            date: currentPointer, // This is the start time of the batch
            startTime: currentPointer,
            endTime: batchEndTime,
            count: countForBatch,
            isCustom: !!rule
        });

        contactsRemaining -= countForBatch;
        
        // Prepare for next loop:
        // If we exhausted the contacts, we are done.
        // If not, it means we hit the window limit.
        // So start next batch at start of next day (which will be handled by logic at top of loop)
        currentPointer = addDays(currentPointer, 1);
        currentPointer.setHours(0, 0, 0, 0);
    }

    return batches;
}

/**
 * Helper to find the next valid execution time given the rules.
 * Used by the backend worker to schedule individual messages.
 */
export function getNextValidTime(
    proposedTime: Date,
    defaultWorkingHours: WorkingHours | undefined,
    rules: ScheduleRule[]
): Date {
    let pointer = new Date(proposedTime);
    let loops = 0;
    const MAX_LOOPS = 365;

    while (loops < MAX_LOOPS) {
        loops++;
        const dateStr = format(pointer, 'yyyy-MM-dd');
        const rule = rules.find(r => r.date === dateStr);

        let startStr = defaultWorkingHours?.start || "00:00";
        let endStr = defaultWorkingHours?.end || "23:59";
        let isActive = true;

        if (rule) {
            isActive = rule.active;
            if (rule.start) startStr = rule.start;
            if (rule.end) endStr = rule.end;
        }

        if (!isActive) {
            // Day is skipped, move to next day 00:00
            pointer = addDays(pointer, 1);
            pointer.setHours(0, 0, 0, 0);
            continue;
        }

        const windowStart = parse(`${dateStr} ${startStr}`, 'yyyy-MM-dd HH:mm', new Date());
        const windowEnd = parse(`${dateStr} ${endStr}`, 'yyyy-MM-dd HH:mm', new Date());

        // Case 1: Before window
        if (isBefore(pointer, windowStart)) {
            return windowStart;
        }

        // Case 2: Inside window
        if (pointer.getTime() <= windowEnd.getTime()) {
            return pointer;
        }

        // Case 3: After window
        // Move to next day
        pointer = addDays(pointer, 1);
        pointer.setHours(0, 0, 0, 0);
    }
    
    return pointer; // Should not reach here typically
}
